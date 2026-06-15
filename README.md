# fetch-native-bridge

[![npm](https://img.shields.io/npm/v/fetch-native-bridge)](https://www.npmjs.com/package/fetch-native-bridge)
[![license](https://img.shields.io/npm/l/fetch-native-bridge)](LICENSE)

Bridge `fetch` calls from a React Native WebView to the native app — enabling auth-gated requests, file downloads, and CORS bypass that are impossible inside a WebView.

---

## Why this exists

React Native WebViews run in an isolated browser context. They cannot:

- Access native HTTP cookies or auth credentials set by the native app
- Save files directly to device storage
- Bypass CORS restrictions on the WebView's origin

`fetch-native-bridge` solves this by routing WebView `fetch` calls through the native app, which has full access to auth context, filesystem, and system networking.

---

## How it works

```
WebView (web app)                      React Native (native app)
─────────────────                      ──────────────────────────
fetchBridge(url, init)
  │
  ├─ postMessage ──── FETCH_REQUEST ──────────────────────────────────► onMessage()
  │                   { id, url, method, headers, body }                │
  │                                                                      ├─ real fetch(url) ──► server
  │                                                                      │
  │                                                    ◄── FETCH_RESPONSE ┤
  │         { id, status, headers, body?, error? }                       │  serializeResponse()
  │
  ◄─ window "message" event
  │
  └─ PendingRequestMap resolves
     Promise<Response>
```

In a standard browser (no `ReactNativeWebView`), `fetchBridge` delegates directly to `globalThis.fetch` — no behavioural change.

---

## Installation

```sh
npm install fetch-native-bridge
```

---

## Quick Start

### 1 — Web app (inside WebView)

```ts
import { fetchBridge } from 'fetch-native-bridge';

// Use exactly like fetch — works in browser too
const response = await fetchBridge('https://api.example.com/data', {
  method: 'GET',
  headers: { Authorization: 'Bearer ...' },
});
const json = await response.json();
```

### 2 — Native app (React Native)

```tsx
import { useRef, useEffect } from 'react';
import WebView from 'react-native-webview';
import { setupFetchHandler } from 'fetch-native-bridge/native';

export function MyWebView() {
  const webViewRef = useRef(null);
  const { onMessage, teardown } = setupFetchHandler(webViewRef);

  useEffect(() => () => teardown(), []);

  return (
    <WebView
      ref={webViewRef}
      source={{ uri: 'https://my-app.com' }}
      onMessage={onMessage}
    />
  );
}
```

---

## Detailed Usage

### Web side

#### `fetchBridge(input, init?)`

Drop-in replacement for `fetch`. Accepts all standard `RequestInit` fields plus:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `timeout` | `number` | `30000` | Request timeout in ms. Rejects with an error if native does not respond in time. |

```ts
import { fetchBridge } from 'fetch-native-bridge';

// JSON API
const res = await fetchBridge('/api/profile', {
  headers: { Authorization: `Bearer ${token}` },
});
const profile = await res.json();

// File download — native saves to disk, web gets status only
const res = await fetchBridge('https://cdn.example.com/report.pdf', {
  timeout: 60_000,
});
// res.status === 200, res.ok === true; body is empty (native handled it)

// AbortController works the same as with fetch
const controller = new AbortController();
const res = await fetchBridge('/api/data', { signal: controller.signal });
```

All body types are supported: `string`, `URLSearchParams`, `ArrayBuffer`, `TypedArray`, `Blob`, `FormData` (including file entries).

#### `isReactNativeWebView()`

Returns `true` if running inside a React Native WebView.

```ts
import { isReactNativeWebView } from 'fetch-native-bridge';

if (isReactNativeWebView()) {
  // native-specific behaviour
}
```

Detected via `window.ReactNativeWebView` or `window.__isReactNativeWebView === true`.

#### `teardownFetchBridge()`

Cancels all pending bridge requests (rejects their promises). Call on app unmount or logout.

```ts
import { teardownFetchBridge } from 'fetch-native-bridge';

// React Native WebView unmount
useEffect(() => () => teardownFetchBridge(), []);
```

---

### Native side

#### `setupFetchHandler(webViewRef, options?)`

Sets up the native message handler. Returns `{ onMessage, teardown }`.

```ts
import { setupFetchHandler } from 'fetch-native-bridge/native';

const { onMessage, teardown } = setupFetchHandler(webViewRef, {
  timeout: 30_000,
  credentials: 'include',
  sendBinaryBody: false,
  onFetch: async (req, res) => {
    if (req.url.endsWith('.pdf')) {
      // save file to disk, suppress body in response
      const blob = await res.blob();
      await FileSystem.writeAsStringAsync(localPath, blobToBase64(blob));
      return false; // don't send response body back to WebView
    }
    return true; // pass response back normally
  },
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `timeout` | `number` | `30000` | Per-request timeout in ms. |
| `credentials` | `RequestCredentials` | — | `credentials` passed to native `fetch`. |
| `sendBinaryBody` | `boolean` | `false` | When `false`, binary response bodies (images, PDFs, audio, video, octet-stream) are stripped before sending back to the WebView. Status and headers are always sent. Set to `true` only if the WebView needs to consume binary content inline. |
| `onFetch` | `(req, res) => boolean \| Promise<boolean>` | — | Called after each fetch completes. Return `false` to suppress sending the response back (e.g., after saving a file). |

Call `teardown()` to abort all in-flight requests — wire it to component unmount.

---

## Common Patterns

### File download (save to device, notify WebView)

```tsx
// Native side
const { onMessage } = setupFetchHandler(webViewRef, {
  onFetch: async (req, res) => {
    if (req.url.match(/\.(pdf|zip|csv)$/)) {
      const blob = await res.blob();
      // save blob via expo-file-system or react-native-fs
      return false; // WebView gets status 200 with empty body
    }
    return true;
  },
});
```

```ts
// Web side
const res = await fetchBridge('https://api.example.com/export.pdf');
if (res.ok) showToast('File saved to Downloads');
```

### Auth-gated API call

Cookies or tokens managed by the native app are automatically included because the request is performed by the native runtime — not the WebView.

```ts
// Web side — no manual auth header needed if native handles auth
const res = await fetchBridge('/api/user/me');
const user = await res.json();
```

### Large binary response — inline display

Set `sendBinaryBody: true` only when the WebView needs the bytes (e.g., rendering an image from a private endpoint).

```tsx
const { onMessage } = setupFetchHandler(webViewRef, {
  sendBinaryBody: true,
});
```

```ts
// Web side
const res = await fetchBridge('https://private.example.com/avatar.png');
const blob = await res.blob();
const url = URL.createObjectURL(blob);
```

---

## Protocol Reference

For third-party implementors or custom native handlers.

### `FETCH_REQUEST` (WebView → Native)

```ts
{
  type: 'FETCH_REQUEST';
  id: string;           // UUID, correlates with FETCH_RESPONSE
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;  // text or base64-encoded binary
  bodyType?: 'text' | 'base64' | 'formdata';
  formDataEntries?: Array<
    | { name: string; value: string }
    | { name: string; filename: string; data: string; contentType: string }
  >;
}
```

### `FETCH_RESPONSE` (Native → WebView)

```ts
{
  type: 'FETCH_RESPONSE';
  id: string;           // matches FETCH_REQUEST.id
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;         // text or base64; empty string for stripped binary
  bodyEncoding: 'text' | 'base64';
  ok: boolean;
  error?: string;       // set on network/timeout errors; status will be 0
}
```

---

## TypeScript

Types are bundled. No `@types/fetch-native-bridge` needed.

```ts
import type { FetchBridgeOptions } from 'fetch-native-bridge';
import type { SetupFetchHandlerOptions } from 'fetch-native-bridge/native';
```

---

## Peer Dependencies

```json
{
  "react-native": ">=0.70.0",      // optional
  "react-native-webview": ">=11.0.0"  // optional
}
```

Both are optional — the web bundle has zero native dependencies.

---

## Publishing

1. Bump version in `package.json`
2. Commit and push
3. Create a GitHub Release with tag `v0.x.x`
4. CI publishes to npm automatically (requires `NPM_TOKEN` secret)

---

## Contributing

Issues and PRs welcome at [github.com/MaxMoffa/fetch-native-bridge](https://github.com/MaxMoffa/fetch-native-bridge).

---

## License

MIT
