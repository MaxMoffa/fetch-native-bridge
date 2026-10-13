import { useCallback, useEffect, useRef } from 'react';
import type { WebViewMessageEvent, WebViewRef } from '../types/react-native';
import { createFetchHandler, type FetchHandler, type SetupFetchHandlerOptions } from './handler';

/**
 * React hook wrapping `setupFetchHandler`. Creates one handler per WebView, tears it down on
 * unmount (StrictMode-safe) and always uses the latest `options` without re-creating it.
 *
 * @returns The `onMessage` callback to pass to `<WebView onMessage={…} />`. It returns `true`
 * when the message belonged to the bridge.
 */
export function useFetchHandler(
  webViewRef: WebViewRef,
  options: SetupFetchHandlerOptions = {}
): (event: WebViewMessageEvent) => boolean {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const handlerRef = useRef<FetchHandler | null>(null);

  useEffect(() => {
    const handler = createFetchHandler(webViewRef, () => optionsRef.current);
    handlerRef.current = handler;
    return () => {
      handler.teardown();
      if (handlerRef.current === handler) handlerRef.current = null;
    };
  }, [webViewRef]);

  return useCallback((event: WebViewMessageEvent) => handlerRef.current?.onMessage(event) ?? false, []);
}
