export function isReactNativeWebView(): boolean {
  return (
    typeof window !== 'undefined' &&
    (typeof (window as any).ReactNativeWebView !== 'undefined' ||
      (window as any).__isReactNativeWebView === true)
  );
}
