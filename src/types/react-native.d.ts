/** Structural subset of `react-native-webview`'s ref, so the package has no hard dependency on it. */
export interface WebViewRef {
  current: {
    postMessage(message: string): void;
  } | null;
}

/** Structural subset of `react-native-webview`'s `WebViewMessageEvent`. */
export interface WebViewMessageEvent {
  nativeEvent: {
    data: string;
    /** URL of the page that sent the message. */
    url?: string;
  };
}
