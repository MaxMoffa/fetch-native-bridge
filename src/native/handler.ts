import { isFetchRequestMessage, type FetchRequestMessage, type SetupFetchHandlerOptions } from '../shared/protocol';
import { base64ToUint8Array } from '../shared/base64';
import type { WebViewMessageEvent, WebViewRef } from '../types/react-native';
import { serializeResponse } from './response';

const DEFAULT_TIMEOUT = 30_000;

function buildNativeBody(req: FetchRequestMessage): { body: BodyInit | undefined; headers: Record<string, string> } {
  const headers = { ...req.headers };

  if (req.bodyType === 'formdata' && req.formDataEntries) {
    const fd = new FormData();
    for (const entry of req.formDataEntries) {
      if ('filename' in entry) {
        const bytes = base64ToUint8Array(entry.data);
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: entry.contentType });
        fd.append(entry.name, blob, entry.filename);
      } else {
        fd.append(entry.name, entry.value);
      }
    }
    delete headers['content-type'];
    delete headers['Content-Type'];
    return { body: fd, headers };
  }

  if (req.bodyType === 'base64' && req.body) {
    return { body: base64ToUint8Array(req.body).buffer as ArrayBuffer, headers };
  }

  return { body: req.body ?? undefined, headers };
}

export function setupFetchHandler(
  webViewRef: WebViewRef,
  options?: SetupFetchHandlerOptions
): {
  onMessage: (event: WebViewMessageEvent) => void;
  teardown: () => void;
} {
  const controllers = new Map<string, AbortController>();
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  let isDestroyed = false;

  async function handleRequest(req: FetchRequestMessage): Promise<void> {
    const controller = new AbortController();
    controllers.set(req.id, controller);

    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const { body, headers } = buildNativeBody(req);
      const response = await globalThis.fetch(req.url, {
        method: req.method,
        headers,
        body,
        signal: controller.signal,
        ...(options?.credentials !== undefined && { credentials: options.credentials }),
      });

      clearTimeout(timer);
      controllers.delete(req.id);

      if (options?.onFetch) {
        const shouldSend = await options.onFetch(req, response.clone());
        if (!shouldSend) return;
      }

      const msg = await serializeResponse(req.id, response, { sendBinaryBody: options?.sendBinaryBody });
      webViewRef.current?.postMessage(JSON.stringify(msg));
    } catch (err) {
      clearTimeout(timer);
      controllers.delete(req.id);

      const errorMsg = err instanceof Error ? err.message : String(err);
      const msg = {
        type: 'FETCH_RESPONSE' as const,
        id: req.id,
        status: 0,
        statusText: '',
        headers: {},
        body: '',
        bodyEncoding: 'text' as const,
        ok: false,
        error: errorMsg,
      };
      webViewRef.current?.postMessage(JSON.stringify(msg));
    }
  }

  function onMessage(event: WebViewMessageEvent): void {
    if (isDestroyed) return;
    let data: unknown;
    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (!isFetchRequestMessage(data)) return;
    void handleRequest(data);
  }

  function teardown(): void {
    isDestroyed = true;
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
  }

  return { onMessage, teardown };
}
