# fetch-native-bridge

[![npm version](https://img.shields.io/npm/v/fetch-native-bridge.svg)](https://www.npmjs.com/package/fetch-native-bridge)
[![CI](https://github.com/MaxMoffa/fetch-native-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/MaxMoffa/fetch-native-bridge/actions/workflows/ci.yml)
[![types](https://img.shields.io/npm/types/fetch-native-bridge.svg)](https://www.npmjs.com/package/fetch-native-bridge)
[![license](https://img.shields.io/npm/l/fetch-native-bridge.svg)](LICENSE)

**A drop-in `fetch` for web apps running inside a [React Native WebView](https://github.com/react-native-webview/react-native-webview).**
Requests are executed by the native app, so they use its cookies and credentials, they are not subject to CORS, and native code can handle the responses (for example, saving a downloaded file to disk).

```ts
import { fetchBridge } from 'fetch-native-bridge';

const res = await fetchBridge('/api/me'); // same signature and return value as fetch
const user = await res.json();
```

---

## Table of contents

- [Why](#why)
- [Features](#features)
- [Installation](#installation)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Security](#security)
- [API reference](#api-reference)
  - [Web](#web-api)
  - [Native](#native-api)
  - [Errors](#errors)
- [Recipes](#recipes)
- [Behaviour and limitations](#behaviour-and-limitations)
- [Protocol](#protocol)
- [Migrating from 0.1.x](#migrating-from-01x)
- [Contributing](#contributing)
- [License](#license)

---

## Why

A page loaded in a React Native WebView runs in a sandboxed browser context. It cannot:

- use the HTTP cookies, tokens or client certificates held by the native app;
- call APIs that do not send CORS headers for the page's origin;
- write files to the device or open the native share sheet.

`fetch-native-bridge` sends the WebView's `fetch` calls over `postMessage` to the native app. The native app performs the request and posts the response back. Your web code still works with an ordinary `Response` object, and in a regular browser `fetchBridge` simply calls `window.fetch`.

## Features

- **Drop-in `fetch`.** It accepts the same `input` (string, `URL` or `Request`) and `init` arguments and resolves to a standard `Response`.
- **Every body type.** It handles `string`, `URLSearchParams`, `ArrayBuffer`, typed arrays, `Blob` and `FormData` with file uploads.
- **Binary responses.** Native code can save files to disk or forward them to the WebView as bytes.
- **Cancellation.** `AbortSignal` support reaches the native side, so the native request is aborted too.
- **Timeouts.** Each request can set its own timeout, which applies on both sides of the bridge.
- **Allow-lists.** URL and page-origin allow-lists stop untrusted pages from using your app's credentials.
- **Typed errors.** Network failures reject with a `TypeError`, exactly as `fetch` does.
- **React hook.** `useFetchHandler` handles setup and teardown and is safe under StrictMode.
- **Small and self-contained.** There are no runtime dependencies, and it works on old React Native versions that lack `atob`/`btoa`.
- **TypeScript.** Types ship with the package, and both ESM and CommonJS builds are included.

## Installation

```sh
npm install fetch-native-bridge
# or
yarn add fetch-native-bridge
```

Install the package in **both** projects: the web app that runs inside the WebView and the React Native app that hosts it. If both live in the same repository, one installation is enough.

| Entry point | Used in | Peer dependencies |
|---|---|---|
| `fetch-native-bridge` | Web app (inside the WebView) | none |
| `fetch-native-bridge/native` | React Native app | `react` (only for `useFetchHandler`), `react-native-webview` |

## Quick start

### 1. Native app

```tsx
import { useRef } from 'react';
import WebView from 'react-native-webview';
import { useFetchHandler } from 'fetch-native-bridge/native';

export function AppWebView() {
  const webViewRef = useRef<WebView>(null);

  const onMessage = useFetchHandler(webViewRef, {
    allowedOrigins: ['https://my-app.com'],      // pages allowed to use the bridge
    allowedUrls: ['https://api.my-app.com'],     // URLs those pages may request
  });

  return <WebView ref={webViewRef} source={{ uri: 'https://my-app.com' }} onMessage={onMessage} />;
}
```

### 2. Web app

```ts
import { fetchBridge } from 'fetch-native-bridge';

const res = await fetchBridge('https://api.my-app.com/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ productId: 42 }),
});

if (!res.ok) throw new Error(`HTTP ${res.status}`);
const order = await res.json();
```

That's all the setup needed. The same web code runs unchanged in a desktop browser, where it uses `window.fetch`.

## How it works

```
 WebView (web app)                                     React Native (native app)
 ─────────────────                                     ─────────────────────────
 fetchBridge(url, init)
   ├─ serialize request (body → text / base64 / form entries)
   ├─ postMessage ───────── FETCH_REQUEST ───────────►  onMessage
   │                                                     ├─ check allowedOrigins / allowedUrls
   │                                                     ├─ fetch(url)  ──────────────►  server
   │                                                     ├─ onFetch(req, res)  (optional)
   │                                                     └─ serialize response
   ◄──────────────────────── FETCH_RESPONSE ─────────────┘
   └─ resolve Promise<Response>

 signal.abort() / timeout ── FETCH_CANCEL ────────────►  AbortController.abort()
```

Fetches run concurrently and each request is matched to its response by a random UUID. Inside a WebView, `fetchBridge` is selected automatically when `window.ReactNativeWebView` exists.

## Security

The native side sends requests **with your app's credentials**. Any page that can post messages to it can use those credentials. Configure both allow-lists in production:

```ts
useFetchHandler(webViewRef, {
  // Only pages served from these origins may use the bridge.
  allowedOrigins: ['https://my-app.com'],
  // Only these URLs may be requested.
  allowedUrls: [
    'https://api.my-app.com/v1',       // origin + path prefix (matches /v1 and /v1/…, not /v10)
    /^https:\/\/cdn\.my-app\.com\//,   // RegExp tested against the full URL
  ],
});
```

- **String patterns** must match the origin (scheme, host and port) exactly, and the request path must start with the pattern's path at a segment boundary. Dot segments (`/v1/../admin`) are resolved before matching, and look-alike hosts (`api.my-app.com.evil.com`) do not match.
- **RegExp patterns** are tested against the full URL. Anchor them with `^`.
- **A predicate** `(url) => boolean` can be passed instead of an array.
- **Without `allowedUrls`**, only `http:` and `https:` URLs are allowed, which blocks `file:`, `content:` and similar schemes.
- **Without either allow-list**, a warning is logged in development builds.

A blocked request rejects on the web side with `FetchBridgeBlockedError`.

## API reference

### Web API

```ts
import {
  fetchBridge,
  teardownFetchBridge,
  isBodyOmitted,
  isReactNativeWebView,
} from 'fetch-native-bridge';
```

#### `fetchBridge(input, init?) => Promise<Response>`

Takes the same arguments as `fetch`, plus one option:

| Option | Type | Default | Description |
|---|---|---|---|
| `timeout` | `number` | `30000` | Timeout in milliseconds. It applies on both sides of the bridge (the native side may cap it with `maxTimeout`). `0` disables it. In a regular browser, the timeout only applies when you pass it explicitly. |

Other details:

- **Relative URLs** are resolved against `document.baseURI`.
- **`Request` objects** are fully supported: method, headers, body and signal are all used. Fields in `init` take precedence.
- **Default `Content-Type`** is set for string, `URLSearchParams` and `Blob` bodies, as `fetch` would. For `FormData` the multipart boundary is generated natively, so any manual `Content-Type` header is removed.
- **`response.url` and `response.redirected`** reflect the native response.
- **`ReadableStream` bodies** are not supported and reject with a `TypeError`.

#### `isBodyOmitted(response) => boolean`

Returns `true` when the native side deliberately did not send the body. This happens when the response is binary and `sendBinaryBody` is off, or when `onFetch` returned `false`. Status and headers are still accurate.

```ts
const res = await fetchBridge('https://files.my-app.com/report.pdf');
if (res.ok && isBodyOmitted(res)) showToast('Report saved to your device');
```

#### `teardownFetchBridge() => void`

Rejects every pending request with `FetchBridgeError`, asks the native side to cancel them and removes the message listener. Call it on logout, for example. `fetchBridge` keeps working afterwards.

#### `isReactNativeWebView() => boolean`

Returns `true` when `window.ReactNativeWebView` exists or `window.__isReactNativeWebView === true`.

### Native API

```ts
import { useFetchHandler, setupFetchHandler, blobToBase64 } from 'fetch-native-bridge/native';
```

`blobToBase64(blob)` is a small helper (via `FileReader.readAsDataURL`, available on every React Native version) for writing response bodies to disk.

#### `useFetchHandler(webViewRef, options?) => onMessage`

React hook (recommended). It creates one handler per WebView, tears it down on unmount (including StrictMode's double mount) and always reads the latest `options`, so passing an inline object is fine.

#### `setupFetchHandler(webViewRef, options?) => { onMessage, teardown }`

The same functionality without React. Create the handler **once** per WebView. Don't create it inside a component's render. Call `teardown()` when the WebView goes away to abort in-flight requests.

`onMessage(event)` returns `true` when the message belonged to the bridge, so you can combine it with your own handler (see [Recipes](#sharing-onmessage-with-your-own-messages)).

#### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `allowedUrls` | `(string \| RegExp)[] \| (url) => boolean` | http(s) only | URLs the WebView may request. See [Security](#security). |
| `allowedOrigins` | `(string \| RegExp)[] \| (url) => boolean` | any | Pages allowed to use the bridge, matched against `event.nativeEvent.url`. |
| `timeout` | `number` | `30000` | Default timeout when the request doesn't specify one. `0` disables it. |
| `maxTimeout` | `number` | — | Upper bound for timeouts requested by the web side. |
| `credentials` | `RequestCredentials` | — | Passed to the native `fetch`. |
| `sendBinaryBody` | `boolean` | `false` | Forward binary bodies to the WebView (base64-encoded). When `false`, binary responses arrive with status and headers only. |
| `additionalBinaryTypes` | `string[]` | — | Content-type prefixes to treat as binary even if they look like text (e.g. `'text/csv'`). |
| `onFetch` | `(req, res) => boolean \| void \| Promise<…>` | — | Called with a clone of every successful response. Return `false` if native consumed the body; the WebView then gets status and headers with an empty body. |
| `fetch` | `typeof fetch` | `globalThis.fetch` | Custom fetch implementation, e.g. to add auth headers or use another HTTP client. |

**What counts as binary?** Any response whose content type isn't recognisably text is treated as binary. Text types are `text/*`, JSON, XML, YAML, JavaScript, form-urlencoded, GraphQL, NDJSON, CSV and SVG, including `+json` and `+xml` suffixes. A missing `Content-Type` is treated as text.

### Errors

Every error is exported from both entry points.

| Error | Extends | When |
|---|---|---|
| `FetchBridgeNetworkError` | `TypeError` | The native request failed (offline, DNS, TLS…). Like `fetch`, it is a `TypeError`. |
| `FetchBridgeBlockedError` | `FetchBridgeNetworkError` | The request was rejected by `allowedUrls` or `allowedOrigins`. |
| `FetchBridgeTimeoutError` | `FetchBridgeError` | The timeout expired. Has `requestId` and `timeoutMs`. |
| `FetchBridgeError` | `Error` | Bridge-level failure, e.g. `teardownFetchBridge()` was called. |
| `DOMException` named `AbortError` | — | The `AbortSignal` fired. If you passed a custom `signal.reason`, that reason is thrown instead. |

`isFetchBridgeError(err)` returns `true` for every error above except `AbortError`. `isFetchBridgeTimeoutError(err)` narrows to the timeout error.

HTTP error statuses (4xx and 5xx) **resolve** normally with `res.ok === false`, as with `fetch`.

## Recipes

### Save a downloaded file natively

```tsx
const onMessage = useFetchHandler(webViewRef, {
  allowedUrls: ['https://files.my-app.com'],
  onFetch: async (req, res) => {
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('application/pdf')) return true;    // forward everything else

    const base64 = await blobToBase64(await res.blob());      // exported by fetch-native-bridge/native
    await saveFile(fileNameFromUrl(req.url), base64);         // expo-file-system, react-native-fs, …
    return false;                                             // WebView gets status + headers only
  },
});
```

```ts
// Web
const res = await fetchBridge('https://files.my-app.com/invoices/42.pdf', { timeout: 120_000 });
if (res.ok) showToast('Invoice downloaded');
```

### Inject an auth token from native

```tsx
const onMessage = useFetchHandler(webViewRef, {
  allowedUrls: ['https://api.my-app.com'],
  fetch: async (url, init) => {
    const token = await getAccessToken();                     // keychain, refresh flow, …
    return fetch(url, { ...init, headers: { ...init?.headers, authorization: `Bearer ${token}` } });
  },
});
```

The web app never sees the token.

### Display a private image in the WebView

```tsx
useFetchHandler(webViewRef, { sendBinaryBody: true, allowedUrls: ['https://media.my-app.com'] });
```

```ts
const res = await fetchBridge('https://media.my-app.com/avatar.png');
img.src = URL.createObjectURL(await res.blob());
```

### Cancel a request

```ts
const controller = new AbortController();
const promise = fetchBridge('/api/search?q=react', { signal: controller.signal });
controller.abort(); // rejects with AbortError and aborts the native request too
```

### Sharing `onMessage` with your own messages

```tsx
const bridgeOnMessage = useFetchHandler(webViewRef, options);

<WebView
  ref={webViewRef}
  onMessage={(event) => {
    if (bridgeOnMessage(event)) return;     // handled by fetch-native-bridge
    handleMyOwnMessage(event.nativeEvent.data);
  }}
/>
```

### Use it as the global `fetch`

HTTP clients that accept a custom `fetch` implementation (ky, Apollo Client's `HttpLink`, openapi-fetch, …) can use `fetchBridge` directly:

```ts
import ky from 'ky';
import { fetchBridge } from 'fetch-native-bridge';

const api = ky.create({ prefixUrl: 'https://api.my-app.com', fetch: fetchBridge });
```

## Behaviour and limitations

- **Payload size.** Bodies cross the bridge as JSON strings, and binary data is base64-encoded (about 33% larger). Bridging a few megabytes is fine. For large files, handle them natively with `onFetch` instead of forwarding the bytes.
- **No streaming.** Request and response bodies are buffered. `ReadableStream` request bodies are not supported, and download/upload progress events are not available.
- **Cookies.** The native fetch uses the app's cookie store. On iOS this store is not automatically shared with the WebView's `WKWebView` cookies. Use [`@react-native-cookies/cookies`](https://github.com/react-native-cookies/cookies) if you need to sync them.
- **Headers.** Header names are lower-cased. Multiple `Set-Cookie` headers are merged by the native `Headers` implementation.
- **Outside a WebView**, `fetchBridge` is plain `fetch` (plus the optional `timeout`).

## Protocol

Messages are JSON strings sent through `postMessage`. Version `2` is fully backwards compatible with v1 handlers and clients. Use this reference to implement a native handler in another stack, such as Swift/Kotlin or Flutter.

```ts
// WebView → Native
interface FetchRequestMessage {
  type: 'FETCH_REQUEST';
  v?: '2';
  id: string;                                  // UUID
  url: string;                                 // absolute
  method: string;
  headers: Record<string, string>;             // lower-cased names
  body: string | null;
  bodyType?: 'text' | 'base64' | 'formdata';
  formDataEntries?: Array<
    | { name: string; value: string }
    | { name: string; filename: string; data: string /* base64 */; contentType: string }
  >;
  timeout?: number;                            // ms, 0 = none
}

// WebView → Native
interface FetchCancelMessage {
  type: 'FETCH_CANCEL';
  v?: '2';
  id: string;
}

// Native → WebView
interface FetchResponseMessage {
  type: 'FETCH_RESPONSE';
  v?: '2';
  id: string;
  status: number;                              // 0 when `error` is set
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyEncoding: 'text' | 'base64';
  ok: boolean;
  url?: string;                                // final URL after redirects
  redirected?: boolean;
  bodyOmitted?: boolean;
  error?: string;
  errorName?: 'NetworkError' | 'TimeoutError' | 'AbortError' | 'BlockedError';
}
```

A cancelled request must not receive a `FETCH_RESPONSE`.

## Migrating from 0.1.x

- **`onFetch` returning `false`** now answers the WebView with status and headers and an empty body. Before, it answered nothing and the request hung until the timeout.
- **Network errors** reject with `FetchBridgeNetworkError`, which is a `TypeError`, instead of a plain `Error`.
- **Non-`http(s)` URLs are blocked** by default. Add `allowedUrls` to allow other schemes explicitly.
- **More types count as binary.** Any content type that isn't recognisably text is now treated as binary (for example protobuf, zip and fonts). Before, these were decoded as text and corrupted. Use `sendBinaryBody: true` to receive them.
- **`setupFetchHandler` inside a component** should be replaced with `useFetchHandler`.
- **The `injectJavaScript` method** is no longer required on the WebView ref type.

## Contributing

Issues and pull requests are welcome at [github.com/MaxMoffa/fetch-native-bridge](https://github.com/MaxMoffa/fetch-native-bridge).

```sh
npm install
npm test            # vitest
npm run typecheck   # tsc --noEmit
npm run build       # rollup → dist/
```

Releases are published to npm by CI when a GitHub Release tagged `vX.Y.Z` is created.

## License

[MIT](LICENSE) © MaxMoffa
