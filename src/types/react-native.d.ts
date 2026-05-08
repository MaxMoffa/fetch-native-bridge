export interface WebViewRef {
  current: {
    postMessage(message: string): void;
    injectJavaScript(script: string): void;
  } | null;
}

export interface WebViewMessageEvent {
  nativeEvent: {
    data: string;
  };
}
