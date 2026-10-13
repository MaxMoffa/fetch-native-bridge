/**
 * Wire protocol shared by the WebView (web) and React Native (native) sides.
 * Every message is a JSON string sent over `postMessage`.
 */

export const PROTOCOL_VERSION = '2' as const;

export type FormDataEntry =
  | { name: string; value: string }
  | { name: string; filename: string; data: string; contentType: string };

export type BodyEncoding = 'text' | 'base64';

/** WebView → Native: perform a request. */
export interface FetchRequestMessage {
  type: 'FETCH_REQUEST';
  /** Protocol version of the sender. Absent in v1 messages. */
  v?: string;
  id: string;
  /** Absolute URL (the web side resolves relative URLs before sending). */
  url: string;
  method: string;
  /** Header names are lower-cased by the web side. */
  headers: Record<string, string>;
  body: string | null;
  bodyType?: 'text' | 'base64' | 'formdata';
  formDataEntries?: FormDataEntry[];
  /** Per-request timeout in ms; `0` disables it. Falls back to the native default. */
  timeout?: number;
}

/** WebView → Native: abort an in-flight request (AbortSignal fired or web-side timeout). */
export interface FetchCancelMessage {
  type: 'FETCH_CANCEL';
  v?: string;
  id: string;
}

/** Classifies a failed request so the web side can reject with the matching error type. */
export type FetchErrorName = 'NetworkError' | 'TimeoutError' | 'AbortError' | 'BlockedError';

/** Native → WebView: the result of a request. */
export interface FetchResponseMessage {
  type: 'FETCH_RESPONSE';
  v?: string;
  id: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyEncoding: BodyEncoding;
  ok: boolean;
  /** Final URL after redirects. */
  url?: string;
  redirected?: boolean;
  /** `true` when native intentionally did not send the body (binary filter or `onFetch`). */
  bodyOmitted?: boolean;
  /** Set when the request failed; `status` is then `0`. */
  error?: string;
  errorName?: FetchErrorName;
}

export type BridgeMessage = FetchRequestMessage | FetchCancelMessage | FetchResponseMessage;

function isRecord(m: unknown): m is Record<string, unknown> {
  return typeof m === 'object' && m !== null && !Array.isArray(m);
}

function isStringRecord(m: unknown): m is Record<string, string> {
  if (!isRecord(m)) return false;
  for (const key in m) {
    if (typeof m[key] !== 'string') return false;
  }
  return true;
}

function isFormDataEntry(e: unknown): e is FormDataEntry {
  if (!isRecord(e) || typeof e.name !== 'string') return false;
  if (typeof e.value === 'string') return true;
  return typeof e.filename === 'string' && typeof e.data === 'string' && typeof e.contentType === 'string';
}

export function isFetchRequestMessage(m: unknown): m is FetchRequestMessage {
  if (!isRecord(m) || m.type !== 'FETCH_REQUEST') return false;
  if (typeof m.id !== 'string' || m.id === '' || typeof m.url !== 'string') return false;
  if (m.method !== undefined && typeof m.method !== 'string') return false;
  if (m.headers !== undefined && !isStringRecord(m.headers)) return false;
  if (m.body !== undefined && m.body !== null && typeof m.body !== 'string') return false;
  if (m.bodyType !== undefined && m.bodyType !== 'text' && m.bodyType !== 'base64' && m.bodyType !== 'formdata') {
    return false;
  }
  if (m.formDataEntries !== undefined) {
    if (!Array.isArray(m.formDataEntries) || !m.formDataEntries.every(isFormDataEntry)) return false;
  }
  if (m.timeout !== undefined && (typeof m.timeout !== 'number' || !(m.timeout >= 0))) return false;
  return true;
}

export function isFetchCancelMessage(m: unknown): m is FetchCancelMessage {
  return isRecord(m) && m.type === 'FETCH_CANCEL' && typeof m.id === 'string';
}

export function isFetchResponseMessage(m: unknown): m is FetchResponseMessage {
  return (
    isRecord(m) &&
    m.type === 'FETCH_RESPONSE' &&
    typeof m.id === 'string' &&
    typeof m.status === 'number' &&
    (m.headers === undefined || isStringRecord(m.headers)) &&
    (m.body === undefined || typeof m.body === 'string')
  );
}

/** Parses a raw `postMessage` payload; returns `undefined` for anything that is not JSON. */
export function parseMessage(data: unknown): unknown {
  if (typeof data !== 'string') return undefined;
  // Cheap pre-check: other libraries share the same channel, skip non-JSON quickly.
  if (data.charCodeAt(0) !== 123 /* { */) return undefined;
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}
