import {
  PROTOCOL_VERSION,
  type FetchErrorName,
  type FetchRequestMessage,
  type FetchResponseMessage,
  isFetchCancelMessage,
  isFetchRequestMessage,
  parseMessage,
} from '../shared/protocol';
import type { WebViewMessageEvent, WebViewRef } from '../types/react-native';
import { isDev } from './env';
import { buildNativeBody } from './request';
import { serializeResponse } from './response';
import { isHttpUrl, matchesUrl, parseUrl, type UrlMatcher } from './url';

const DEFAULT_TIMEOUT = 30_000;

export interface SetupFetchHandlerOptions {
  /**
   * URLs the WebView may request. Strings match by origin + path prefix
   * (`'https://api.example.com/v1'`), RegExps are tested against the full URL, or pass a
   * predicate. When omitted, any `http(s)` URL is allowed — set it in production.
   */
  allowedUrls?: UrlMatcher;
  /**
   * Origins of the pages allowed to use the bridge, checked against the URL of the page that
   * sent the message (`event.nativeEvent.url`). Same matching rules as `allowedUrls`.
   */
  allowedOrigins?: UrlMatcher;
  /**
   * Default timeout in ms, used when the request does not specify one. `0` disables it.
   * @default 30000
   */
  timeout?: number;
  /** Upper bound for the per-request timeout chosen by the web side. */
  maxTimeout?: number;
  credentials?: RequestCredentials;
  /**
   * Send binary response bodies (images, PDFs, archives…) to the WebView as base64.
   * When `false`, only status and headers are sent and `isBodyOmitted(res)` is `true` on the web side.
   * @default false
   */
  sendBinaryBody?: boolean;
  /**
   * Extra content-type prefixes to treat as binary. Types that are not recognisably text are
   * already treated as binary; use this to force it for e.g. `'text/csv'`.
   */
  additionalBinaryTypes?: string[];
  /**
   * Called with a clone of every successful response before it is forwarded. Return `false`
   * when native consumed the body (e.g. saved a file): the WebView then receives status and
   * headers with an empty body.
   */
  onFetch?: (req: FetchRequestMessage, res: Response) => boolean | void | Promise<boolean | void>;
  /** Custom fetch implementation, e.g. to inject auth headers or use a different HTTP client. */
  fetch?: typeof globalThis.fetch;
}

export interface FetchHandler {
  /**
   * Pass as the WebView's `onMessage`. Returns `true` when the message belonged to the bridge,
   * so it can be composed with your own handler.
   */
  onMessage: (event: WebViewMessageEvent) => boolean;
  /** Aborts every in-flight request and ignores further messages. */
  teardown: () => void;
}

interface InFlight {
  controller: AbortController;
  /** Why the request was aborted; `undefined` while it is still running. */
  reason?: 'timeout' | 'cancel' | 'teardown';
}

let _warnedNoAllowlist = false;

function errorMessage(id: string, error: string, errorName: FetchErrorName): FetchResponseMessage {
  return {
    type: 'FETCH_RESPONSE',
    v: PROTOCOL_VERSION,
    id,
    status: 0,
    statusText: '',
    headers: {},
    body: '',
    bodyEncoding: 'text',
    ok: false,
    error,
    errorName,
  };
}

function resolveTimeout(requested: number | undefined, options: SetupFetchHandlerOptions): number {
  const fallback = options.timeout ?? DEFAULT_TIMEOUT;
  let timeout = requested ?? fallback;
  const max = options.maxTimeout;
  if (max !== undefined && max > 0 && (timeout <= 0 || timeout > max)) timeout = max;
  return timeout;
}

/** @internal Shared by `setupFetchHandler` and `useFetchHandler`; options are read lazily. */
export function createFetchHandler(webViewRef: WebViewRef, getOptions: () => SetupFetchHandlerOptions): FetchHandler {
  const inFlight = new Map<string, InFlight>();
  let isDestroyed = false;

  if (isDev() && !_warnedNoAllowlist && !getOptions().allowedUrls && !getOptions().allowedOrigins) {
    _warnedNoAllowlist = true;
    console.warn(
      '[fetch-native-bridge] No `allowedUrls`/`allowedOrigins` configured: any page loaded in the ' +
        'WebView can make requests with the app\'s credentials. Configure an allow-list for production.'
    );
  }

  function post(message: FetchResponseMessage): void {
    if (isDestroyed) return;
    webViewRef.current?.postMessage(JSON.stringify(message));
  }

  function check(req: FetchRequestMessage, pageUrl: string | undefined, options: SetupFetchHandlerOptions): string | null {
    if (options.allowedOrigins) {
      const origin = pageUrl ? parseUrl(pageUrl)?.origin : undefined;
      if (!origin || !matchesUrl(origin, options.allowedOrigins)) {
        return `fetchBridge: page origin ${origin ?? '(unknown)'} is not allowed`;
      }
    }
    const allowed = options.allowedUrls ? matchesUrl(req.url, options.allowedUrls) : isHttpUrl(req.url);
    return allowed ? null : `fetchBridge: URL not allowed: ${req.url}`;
  }

  async function handleRequest(req: FetchRequestMessage, pageUrl: string | undefined): Promise<void> {
    const options = getOptions();
    const blocked = check(req, pageUrl, options);
    if (blocked) {
      post(errorMessage(req.id, blocked, 'BlockedError'));
      return;
    }

    const entry: InFlight = { controller: new AbortController() };
    inFlight.set(req.id, entry);

    const timeout = resolveTimeout(req.timeout, options);
    const timer =
      timeout > 0 && Number.isFinite(timeout)
        ? setTimeout(() => {
            entry.reason = 'timeout';
            entry.controller.abort();
          }, timeout)
        : undefined;

    try {
      const { body, headers } = buildNativeBody(req);
      const doFetch = options.fetch ?? globalThis.fetch;
      const response = await doFetch(req.url, {
        method: req.method || 'GET',
        headers,
        body,
        signal: entry.controller.signal,
        ...(options.credentials !== undefined && { credentials: options.credentials }),
      });

      let omitBody = false;
      if (options.onFetch) {
        omitBody = (await options.onFetch(req, response.clone())) === false;
      }
      const message = await serializeResponse(req.id, response, {
        sendBinaryBody: options.sendBinaryBody,
        additionalBinaryTypes: options.additionalBinaryTypes,
        omitBody,
      });
      // Aborting does not interrupt every body reader: re-check before posting.
      if (entry.reason) throw new Error('aborted');
      post(message);
    } catch (err) {
      if (entry.reason === 'cancel' || entry.reason === 'teardown') return; // nobody is waiting
      if (entry.reason === 'timeout') {
        post(errorMessage(req.id, `fetchBridge: request timed out after ${timeout}ms`, 'TimeoutError'));
      } else {
        const name = (err as { name?: unknown } | null)?.name;
        const message = err instanceof Error ? err.message : String(err);
        post(errorMessage(req.id, message || 'Network request failed', name === 'AbortError' ? 'AbortError' : 'NetworkError'));
      }
    } finally {
      clearTimeout(timer);
      if (inFlight.get(req.id) === entry) inFlight.delete(req.id);
    }
  }

  function onMessage(event: WebViewMessageEvent): boolean {
    const data = parseMessage(event?.nativeEvent?.data);
    if (isFetchRequestMessage(data)) {
      if (isDestroyed || inFlight.has(data.id)) return true;
      void handleRequest(data, event.nativeEvent.url);
      return true;
    }
    if (isFetchCancelMessage(data)) {
      const entry = inFlight.get(data.id);
      if (entry && !entry.reason) {
        entry.reason = 'cancel';
        entry.controller.abort();
      }
      return true;
    }
    return false;
  }

  function teardown(): void {
    isDestroyed = true;
    for (const entry of inFlight.values()) {
      entry.reason = 'teardown';
      entry.controller.abort();
    }
    inFlight.clear();
  }

  return { onMessage, teardown };
}

/**
 * Creates the native side of the bridge. Call it once per WebView (outside of render, or use
 * the `useFetchHandler` hook) and pass `onMessage` to the WebView.
 */
export function setupFetchHandler(webViewRef: WebViewRef, options: SetupFetchHandlerOptions = {}): FetchHandler {
  return createFetchHandler(webViewRef, () => options);
}
