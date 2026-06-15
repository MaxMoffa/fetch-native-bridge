# Production Features Roadmap — fetch-native-bridge

## Current State Summary

Before evaluating features, one critical architectural gap was identified during analysis:

**`fetchBridge.ts` does not await the native response.** It posts the `FETCH_REQUEST` message then immediately returns `new Response(null, { status: 200 })`. The `PendingRequestMap` class in `src/web/pending.ts` exists but is never used by `fetchBridge`, and no `window.addEventListener('message', ...)` listener is wired up on the web side. The library therefore cannot fulfill its core promise of returning the actual native response to the caller. This must be fixed before any feature below is implemented.

---

## Ranked Feature List

### P1 — Critical for Production

---

#### 1. Web-Side Response Listener + PendingRequestMap Integration

**Problem it solves:** `fetchBridge()` returns a stub `Response` immediately instead of the real native response. The existing `PendingRequestMap` is never connected to anything. The round-trip is broken.

**Proposed API surface:** No public API change needed. Internally, `fetchBridge` must register a `window.message` listener (or accept one via `setupWebBridge()`) that resolves the pending promise when a `FETCH_RESPONSE` arrives.

```ts
// New optional web-side setup (one-time, called once per app)
export function setupWebBridge(): () => void;

// fetchBridge internally uses PendingRequestMap and awaits the response
export async function fetchBridge(
  input: RequestInfo | URL,
  init?: FetchBridgeOptions
): Promise<Response>;
```

**Implementation complexity:** Low (the `PendingRequestMap` is already built; just wire it up)

**Priority:** P1 — the library does not work without this

---

#### 2. AbortSignal Passthrough

**Problem it solves:** Callers using `AbortController` (e.g., React `useEffect` cleanup, navigation cancel) have no way to cancel an in-flight native request. Without passthrough the native side keeps fetching and burns bandwidth/battery even after the WebView consumer has moved on.

**Proposed API surface:**

```ts
// Web side — no change; already accepted via RequestInit.signal
const controller = new AbortController();
fetchBridge(url, { signal: controller.signal });
controller.abort();

// Protocol addition
interface FetchRequestMessage {
  // existing fields...
  abortOnTimeout?: never; // already handled; no new field needed
}

// New cancel message on the wire
interface FetchCancelMessage {
  type: 'FETCH_CANCEL';
  id: string;
}

// Web side sends FETCH_CANCEL when signal fires
// Native side: handler.ts listens for FETCH_CANCEL and calls controllers.get(id)?.abort()
```

**Implementation complexity:** Medium (needs new message type in protocol, web-side signal listener, native-side cancel handler)

**Priority:** P1

---

#### 3. Message Size Guard

**Problem it solves:** React Native's WebView message bridge has an undocumented but real size limit (observed crashes/silently dropped messages above ~10–50 MB depending on OS/device). An oversized response body — a large PDF or video chunk — silently fails with no error surfaced to the caller, causing hangs.

**Proposed API surface:**

```ts
interface SetupFetchHandlerOptions {
  // existing...
  maxResponseBytes?: number; // default: 5_242_880 (5 MB)
}

// When the serialized response exceeds the limit, the native side
// sends a FETCH_RESPONSE with ok: false and a descriptive error string
// rather than attempting to post an oversized message.
```

**Implementation complexity:** Low (check `body.length` in `serializeResponse` before returning; emit error message if over limit)

**Priority:** P1 — silent failures are unacceptable in production

---

#### 4. Request / Response Interceptors

**Problem it solves:** Auth token injection, response normalization, and logging all require the ability to mutate requests before they are sent and responses before they are returned to the caller. The existing `onFetch` option is native-only and post-fetch only; there is no request interceptor and no web-side hook.

**Proposed API surface:**

```ts
// Web side
interface FetchBridgeOptions extends RequestInit {
  timeout?: number;
}

interface BridgeInterceptors {
  request?: (req: Request) => Request | Promise<Request>;
  response?: (res: Response) => Response | Promise<Response>;
}

// Global interceptor registration (axios-style)
export function addInterceptors(interceptors: BridgeInterceptors): () => void;

// Native side — extend existing onFetch to also expose a request interceptor
interface SetupFetchHandlerOptions {
  timeout?: number;
  credentials?: RequestCredentials;
  onRequest?: (req: FetchRequestMessage) => FetchRequestMessage | Promise<FetchRequestMessage>;
  onFetch?: (req: FetchRequestMessage, res: Response) => boolean | Promise<boolean>;
}
```

**Implementation complexity:** Medium

**Priority:** P1

---

### P2 — Very Useful

---

#### 5. Retry with Exponential Backoff

**Problem it solves:** Mobile networks are lossy. A single transient failure (DNS timeout, 503, dropped connection) should not propagate as an error to the caller. Without built-in retry, every consumer must implement its own retry logic.

**Proposed API surface:**

```ts
interface FetchBridgeOptions extends RequestInit {
  timeout?: number;
  retry?: {
    attempts?: number;          // default: 0 (no retry)
    baseDelayMs?: number;       // default: 200
    maxDelayMs?: number;        // default: 10_000
    jitter?: boolean;           // default: true
    retryOn?: (status: number, error?: Error) => boolean;
    // default: retry on network error or status >= 500 and not 501
  };
}
```

**Implementation complexity:** Medium (implemented entirely on the native side inside `handleRequest`; web side only passes retry config through the protocol message)

**Priority:** P2

---

#### 6. Max Concurrent Request Limit / Queue

**Problem it solves:** A WebView running many parallel `fetchBridge()` calls (e.g., a page with 30 lazy-loaded assets) can saturate the native thread and cause OS-level connection-limit errors. A configurable concurrency ceiling with a FIFO queue prevents this.

**Proposed API surface:**

```ts
interface SetupFetchHandlerOptions {
  // existing...
  maxConcurrent?: number; // default: Infinity (current behavior)
  queueTimeout?: number;  // ms to wait in queue before rejecting; default: uses per-request timeout
}
```

**Implementation complexity:** Medium (replace direct `handleRequest` call with a queue/semaphore on the native side)

**Priority:** P2

---

#### 7. Debug / Logging Hooks

**Problem it solves:** Diagnosing bridge failures in production (dropped messages, size issues, unexpected errors) is nearly impossible without structured logging. Teams need to integrate bridge telemetry into their existing observability stack (Sentry, Datadog, custom loggers).

**Proposed API surface:**

```ts
type BridgeLogLevel = 'debug' | 'info' | 'warn' | 'error';

interface BridgeLogEvent {
  level: BridgeLogLevel;
  id?: string;       // request id
  url?: string;
  phase: 'request' | 'response' | 'error' | 'cancel' | 'queue' | 'retry';
  durationMs?: number;
  status?: number;
  message: string;
  meta?: Record<string, unknown>;
}

// Web side
export function setLogger(fn: (event: BridgeLogEvent) => void): void;

// Native side
interface SetupFetchHandlerOptions {
  // existing...
  logger?: (event: BridgeLogEvent) => void;
}
```

**Implementation complexity:** Low (pure instrumentation; no protocol changes needed)

**Priority:** P2

---

#### 8. Request Deduplication

**Problem it solves:** Multiple simultaneous calls to `fetchBridge()` with the same `method + url + body` (common with React Strict Mode double-renders or shared data hooks) result in redundant native fetches. Deduplication coalesces them into one in-flight request and shares the response.

**Proposed API surface:**

```ts
interface SetupFetchHandlerOptions {
  // existing...
  deduplicate?: boolean; // default: false
  deduplicateKeyFn?: (req: FetchRequestMessage) => string;
  // default key: `${method}:${url}` — ignores headers/body
}
```

**Implementation complexity:** Medium (native side tracks a `Map<key, Promise<Response>>` for in-flight dedup; cleans up on resolve/reject)

**Priority:** P2

---

### P3 — Nice to Have

---

#### 9. Progress Events (Upload / Download)

**Problem it solves:** Large file uploads and downloads show no progress to the user. There is no way to drive a progress bar or track transfer speed via the current bridge.

**Proposed API surface:**

```ts
// New progress message type on the wire
interface FetchProgressMessage {
  type: 'FETCH_PROGRESS';
  id: string;
  direction: 'upload' | 'download';
  loaded: number;
  total: number | null; // null when Content-Length is absent
}

// Web side option
interface FetchBridgeOptions extends RequestInit {
  timeout?: number;
  onProgress?: (event: { direction: 'upload' | 'download'; loaded: number; total: number | null }) => void;
}
```

**Implementation complexity:** High (React Native's `fetch` does not expose streaming progress natively; requires `XMLHttpRequest` or `expo-file-system` on the native side; adds a new protocol message and web-side dispatch)

**Priority:** P3

---

#### 10. TTL-Based Response Caching

**Problem it solves:** Repeated identical GET requests (e.g., fetching a config endpoint on every navigation) waste bandwidth and increase latency on slow connections. A simple in-memory TTL cache on the native side can serve repeat requests instantly.

**Proposed API surface:**

```ts
interface SetupFetchHandlerOptions {
  // existing...
  cache?: {
    ttlMs?: number;             // default: 0 (disabled)
    maxEntries?: number;        // default: 100 (LRU eviction)
    cacheKeyFn?: (req: FetchRequestMessage) => string | null;
    // return null to skip caching for that request
    // default: cache only GET requests, key = url
  };
}
```

**Implementation complexity:** Medium (LRU + TTL cache on native side; no protocol changes needed)

**Priority:** P3

---

#### 11. Custom Serializers for Non-Standard Body Types

**Problem it solves:** `ReadableStream` bodies are silently dropped today (the `rawBody` check falls through to `body = null`). Teams using streaming request bodies (e.g., chunked uploads) receive no error and send an empty body, which is a silent data-loss bug.

**Proposed API surface:**

```ts
interface BodySerializer {
  canHandle: (body: unknown) => boolean;
  serialize: (body: unknown) => Promise<{ body: string; bodyType: FetchRequestMessage['bodyType'] }>;
}

// Web side
export function addBodySerializer(serializer: BodySerializer): void;

// ReadableStream built-in serializer example (ships as optional export):
export const readableStreamSerializer: BodySerializer;
```

**Implementation complexity:** Medium (requires consuming the stream to a buffer before serialization, since the bridge cannot transfer a live stream; clearly documents the limitation)

**Priority:** P3

---

## Implementation Order Summary

| # | Feature | Priority | Complexity | Depends On |
|---|---------|----------|------------|------------|
| 1 | Web-side response listener + PendingRequestMap wiring | P1 | Low | — |
| 2 | AbortSignal passthrough | P1 | Medium | #1 |
| 3 | Message size guard | P1 | Low | — |
| 4 | Request/response interceptors | P1 | Medium | #1 |
| 5 | Retry with exponential backoff | P2 | Medium | #1 |
| 6 | Max concurrent request limit / queue | P2 | Medium | — |
| 7 | Debug / logging hooks | P2 | Low | — |
| 8 | Request deduplication | P2 | Medium | #1 |
| 9 | Progress events | P3 | High | #1 |
| 10 | TTL-based response caching | P3 | Medium | — |
| 11 | Custom body serializers | P3 | Medium | — |
