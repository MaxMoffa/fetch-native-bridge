import { generateUUID } from '../shared/uuid';
import {
  PROTOCOL_VERSION,
  type FetchCancelMessage,
  type FetchRequestMessage,
  type FetchResponseMessage,
  isFetchResponseMessage,
  parseMessage,
} from '../shared/protocol';
import {
  FetchBridgeBlockedError,
  FetchBridgeNetworkError,
  FetchBridgeTimeoutError,
  createAbortError,
} from '../shared/errors';
import { isReactNativeWebView } from './detect';
import { PendingRequestMap } from './pending';
import { prepareRequest, serializeBody } from './request';
import { buildResponse } from './response';

const DEFAULT_TIMEOUT = 30_000;

export interface FetchBridgeOptions extends RequestInit {
  /**
   * Request timeout in ms, enforced on both sides of the bridge. `0` disables it.
   * @default 30000
   */
  timeout?: number;
}

const _pending = new PendingRequestMap();
let _listenerInstalled = false;

function _post(message: FetchRequestMessage | FetchCancelMessage): void {
  (window as any).ReactNativeWebView?.postMessage(JSON.stringify(message));
}

function _cancel(id: string): void {
  _post({ type: 'FETCH_CANCEL', v: PROTOCOL_VERSION, id });
}

function _onNativeMessage(event: Event): void {
  const data = parseMessage((event as MessageEvent).data);
  if (isFetchResponseMessage(data)) _pending.resolve(data.id, data);
}

function _ensureListener(): void {
  if (_listenerInstalled) return;
  _listenerInstalled = true;
  window.addEventListener('message', _onNativeMessage);
  // Older Android react-native-webview versions dispatch on `document`.
  document.addEventListener('message', _onNativeMessage);
}

function _abortReason(signal: AbortSignal): unknown {
  return signal.reason !== undefined ? signal.reason : createAbortError();
}

function _toError(msg: FetchResponseMessage, timeoutMs: number): Error {
  const message = msg.error || 'Network request failed';
  switch (msg.errorName) {
    case 'TimeoutError':
      return new FetchBridgeTimeoutError(msg.id, timeoutMs);
    case 'AbortError':
      return createAbortError(message);
    case 'BlockedError':
      return new FetchBridgeBlockedError(message);
    default:
      return new FetchBridgeNetworkError(message);
  }
}

/** Browser fallback: applies an explicit `timeout` so the option behaves the same everywhere. */
async function _fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const outer = init.signal ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : null);
  if (outer?.aborted) throw _abortReason(outer);

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forward = () => controller.abort(outer!.reason);
  outer?.addEventListener('abort', forward, { once: true });

  try {
    return await globalThis.fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) throw new FetchBridgeTimeoutError('browser', timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', forward);
  }
}

/**
 * Drop-in replacement for `fetch`. Inside a React Native WebView the request is executed by
 * the native app; everywhere else it delegates to `globalThis.fetch`.
 */
export async function fetchBridge(input: RequestInfo | URL, init?: FetchBridgeOptions): Promise<Response> {
  const { timeout, ...requestInit } = init ?? {};

  if (!isReactNativeWebView()) {
    return timeout !== undefined && timeout > 0
      ? _fetchWithTimeout(input, requestInit, timeout)
      : globalThis.fetch(input, requestInit);
  }

  const prepared = await prepareRequest(input, requestInit);
  const { signal } = prepared;
  if (signal?.aborted) throw _abortReason(signal);

  const serialized = await serializeBody(prepared.rawBody, prepared.headers);
  // Serializing a large body is async: honour an abort that happened meanwhile.
  if (signal?.aborted) throw _abortReason(signal);

  const timeoutMs = timeout ?? DEFAULT_TIMEOUT;
  const id = generateUUID();
  const message: FetchRequestMessage = {
    type: 'FETCH_REQUEST',
    v: PROTOCOL_VERSION,
    id,
    url: prepared.url,
    method: prepared.method,
    headers: prepared.headers,
    ...serialized,
    timeout: timeoutMs,
  };

  _ensureListener();

  return new Promise<Response>((resolve, reject) => {
    const onAbort = () => {
      if (!_pending.has(id)) return;
      _pending.reject(id, _abortReason(signal!) as Error);
      _cancel(id);
    };
    const cleanup = () => signal?.removeEventListener('abort', onAbort);

    _pending.add(
      id,
      (msg) => {
        cleanup();
        if (msg.error !== undefined || msg.errorName !== undefined) {
          reject(_toError(msg, timeoutMs));
          return;
        }
        try {
          resolve(buildResponse(msg));
        } catch (e) {
          reject(e instanceof Error ? e : new FetchBridgeNetworkError(String(e)));
        }
      },
      (err) => {
        cleanup();
        reject(err);
      },
      timeoutMs,
      () => _cancel(id)
    );

    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      _post(message);
    } catch (e) {
      // postMessage throws for payloads the bridge cannot carry (e.g. out of memory).
      _pending.reject(id, new FetchBridgeNetworkError(`fetchBridge: postMessage failed: ${String(e)}`));
    }
  });
}

/**
 * Rejects every pending request, asks native to cancel them and removes the message listener.
 * Call it on logout or when the web app is torn down. `fetchBridge` keeps working afterwards.
 */
export function teardownFetchBridge(): void {
  const ids = _pending.clear();
  if (typeof window === 'undefined') return;
  for (const id of ids) _cancel(id);
  window.removeEventListener('message', _onNativeMessage);
  document.removeEventListener('message', _onNativeMessage);
  _listenerInstalled = false;
}
