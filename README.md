# fetch-native-bridge

Bridge `fetch` calls from a React Native WebView to the native app. Useful for file downloads and other requests that can't be handled inside a WebView.

## How it works

- **Web/WebView side**: call `fetchBridge()` instead of `fetch()`. In a normal browser it behaves identically to `fetch`. Inside a React Native WebView it posts a message to the native app with all request parameters.
- **Native side**: call `setupFetchHandler()` with a ref to the WebView. It intercepts incoming messages, performs the real fetch from the RN app, and posts the response back.

The auth context (cookies, tokens) must be available on the native side — the library does not transfer credentials from the WebView.

## Installation

```sh
npm install fetch-native-bridge
```

## Usage

### WebView side (web app)

```ts
import { fetchBridge } from 'fetch-native-bridge';

const response = await fetchBridge('https://api.example.com/file.pdf', {
  method: 'GET',
  headers: { Authorization: 'Bearer ...' },
  timeout: 60_000, // optional, default 30s
});

const blob = await response.blob();
```

### Native side (React Native app)

```tsx
import { useRef } from 'react';
import WebView from 'react-native-webview';
import { setupFetchHandler } from 'fetch-native-bridge/native';
import * as FileSystem from 'expo-file-system'; // or react-native-fs

export function MyWebView() {
  const webViewRef = useRef(null);

  const { onMessage } = setupFetchHandler(webViewRef, {
    // Return false to handle the response yourself (e.g. save a file)
    onFetch: async (req, res) => {
      if (req.url.endsWith('.pdf')) {
        const blob = await res.blob();
        // save blob to disk...
        return false; // suppress sending response back to WebView
      }
      return true; // send response back normally
    },
  });

  return (
    <WebView
      ref={webViewRef}
      source={{ uri: 'https://my-app.com' }}
      onMessage={onMessage}
    />
  );
}
```

## API

### `fetchBridge(input, init?)`

Drop-in replacement for `fetch`. Accepts an optional `timeout` (ms) in `init`.

### `isReactNativeWebView()`

Returns `true` if running inside a React Native WebView. Detected via `window.ReactNativeWebView` or `window.__isReactNativeWebView`.

### `setupFetchHandler(webViewRef, options?)`

Sets up the native message handler. Returns `{ onMessage, teardown }`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `timeout` | `number` | `30000` | Request timeout in ms |
| `onFetch` | `(req, res) => boolean \| Promise<boolean>` | — | Called after fetch completes. Return `false` to skip posting the response back to the WebView. |

Call `teardown()` to abort in-flight requests (e.g. on component unmount).

## Publishing

1. Bump version in `package.json`
2. Commit and push
3. Create a GitHub Release with tag `v0.x.x`
4. CI publishes to npm automatically (requires `NPM_TOKEN` secret)
