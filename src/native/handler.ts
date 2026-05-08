import { isFetchRequestMessage, type FetchRequestMessage, type SetupFetchHandlerOptions } from '../shared/protocol';
import type { WebViewMessageEvent, WebViewRef } from '../types/react-native';
import { serializeResponse } from './response';

const DEFAULT_TIMEOUT = 30_000;

export function setupFetchHandler(
  webViewRef: WebViewRef,
  options?: SetupFetchHandlerOptions
): {
  onMessage: (event: WebViewMessageEvent) => void;
  teardown: () => void;
} {
  const controllers = new Map<string, AbortController>();
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;

  async function handleRequest(req: FetchRequestMessage): Promise<void> {
    const controller = new AbortController();
    controllers.set(req.id, controller);

    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await globalThis.fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body ?? undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);
      controllers.delete(req.id);

      if (options?.onFetch) {
        const shouldSend = await options.onFetch(req, response.clone());
        if (!shouldSend) return;
      }

      const msg = await serializeResponse(req.id, response);
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
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
  }

  return { onMessage, teardown };
}
