import type { FetchRequestMessage, FormDataEntry } from '../shared/protocol';
import { uint8ArrayToBase64, blobToBase64 } from '../shared/base64';

type SerializedBody = Pick<FetchRequestMessage, 'body' | 'bodyType' | 'formDataEntries'>;

export interface PreparedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  rawBody: BodyInit | null;
  signal: AbortSignal | null;
}

function isRequest(input: unknown): input is Request {
  return typeof Request !== 'undefined' && input instanceof Request;
}

function resolveUrl(url: string): string {
  try {
    const base = typeof document !== 'undefined' ? document.baseURI : globalThis.location?.href;
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

function headersToRecord(init: HeadersInit | undefined, fallback?: Headers): Record<string, string> {
  const headers = new Headers(init ?? fallback);
  const result: Record<string, string> = {};
  // Headers iterates with lower-cased names and merges duplicates, matching fetch semantics.
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/** Normalises `fetch(input, init)` arguments the same way the `Request` constructor would. */
export async function prepareRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined
): Promise<PreparedRequest> {
  if (isRequest(input)) {
    const method = (init?.method ?? input.method).toUpperCase();
    let rawBody: BodyInit | null = init?.body ?? null;
    if (init?.body === undefined && method !== 'GET' && method !== 'HEAD' && input.body !== null) {
      rawBody = await input.clone().arrayBuffer();
    }
    return {
      url: resolveUrl(input.url),
      method,
      headers: headersToRecord(init?.headers, input.headers),
      rawBody,
      signal: init?.signal ?? input.signal ?? null,
    };
  }
  return {
    url: resolveUrl(input instanceof URL ? input.href : String(input)),
    method: (init?.method ?? 'GET').toUpperCase(),
    headers: headersToRecord(init?.headers),
    rawBody: init?.body ?? null,
    signal: init?.signal ?? null,
  };
}

function setDefaultContentType(headers: Record<string, string>, value: string): void {
  if (value && headers['content-type'] === undefined) headers['content-type'] = value;
}

/**
 * Converts any `BodyInit` into a JSON-safe representation. Mutates `headers` to apply the
 * default `content-type` that `fetch` would have set for the original body type.
 */
export async function serializeBody(
  raw: BodyInit | null,
  headers: Record<string, string>
): Promise<SerializedBody> {
  if (raw === null || raw === undefined) return { body: null };

  if (typeof raw === 'string') {
    setDefaultContentType(headers, 'text/plain;charset=UTF-8');
    return { body: raw, bodyType: 'text' };
  }
  if (raw instanceof URLSearchParams) {
    setDefaultContentType(headers, 'application/x-www-form-urlencoded;charset=UTF-8');
    return { body: raw.toString(), bodyType: 'text' };
  }
  if (raw instanceof ArrayBuffer) {
    return { body: uint8ArrayToBase64(new Uint8Array(raw)), bodyType: 'base64' };
  }
  if (ArrayBuffer.isView(raw)) {
    const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    return { body: uint8ArrayToBase64(bytes), bodyType: 'base64' };
  }
  if (typeof FormData !== 'undefined' && raw instanceof FormData) {
    const pending: Array<Promise<FormDataEntry>> = [];
    raw.forEach((value, name) => {
      if (typeof value === 'string') {
        pending.push(Promise.resolve({ name, value }));
      } else {
        pending.push(
          blobToBase64(value).then((data) => ({
            name,
            filename: typeof File !== 'undefined' && value instanceof File ? value.name : 'blob',
            data,
            contentType: value.type || 'application/octet-stream',
          }))
        );
      }
    });
    // Native generates the multipart boundary, so any manual content-type must go.
    delete headers['content-type'];
    return { body: null, bodyType: 'formdata', formDataEntries: await Promise.all(pending) };
  }
  if (typeof Blob !== 'undefined' && raw instanceof Blob) {
    setDefaultContentType(headers, raw.type);
    return { body: await blobToBase64(raw), bodyType: 'base64' };
  }
  throw new TypeError('fetchBridge: unsupported body type (ReadableStream bodies cannot be bridged)');
}
