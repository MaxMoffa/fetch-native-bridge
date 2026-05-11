import { generateUUID } from '../shared/uuid';
import { type FetchBridgeOptions, type FetchRequestMessage, type FormDataEntry } from '../shared/protocol';
import { uint8ArrayToBase64 } from '../shared/base64';
import { isReactNativeWebView } from './detect';

function buildHeaders(init?: RequestInit): Record<string, string> {
  const result: Record<string, string> = {};
  if (!init?.headers) return result;
  if (init.headers instanceof Headers) {
    init.headers.forEach((value, key) => { result[key] = value; });
  } else if (Array.isArray(init.headers)) {
    for (const [key, value] of init.headers) result[key] = value;
  } else {
    Object.assign(result, init.headers);
  }
  return result;
}

function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function fetchBridge(
  input: RequestInfo | URL,
  init?: FetchBridgeOptions
): Promise<Response> {
  if (!isReactNativeWebView()) {
    const { timeout: _t, ...fetchInit } = init ?? {};
    return globalThis.fetch(input, fetchInit);
  }

  const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
  const id = generateUUID();
  const headers = buildHeaders(init);

  let body: string | null = null;
  let bodyType: FetchRequestMessage['bodyType'];
  let formDataEntries: FormDataEntry[] | undefined;

  const rawBody = init?.body ?? null;

  // Sync paths — no await, so postMessage runs synchronously for these cases
  if (!rawBody) {
    // body stays null
  } else if (typeof rawBody === 'string') {
    body = rawBody;
    bodyType = 'text';
  } else if (rawBody instanceof URLSearchParams) {
    body = rawBody.toString();
    bodyType = 'text';
  } else if (rawBody instanceof ArrayBuffer) {
    body = uint8ArrayToBase64(new Uint8Array(rawBody));
    bodyType = 'base64';
  } else if (ArrayBuffer.isView(rawBody)) {
    body = uint8ArrayToBase64(new Uint8Array(rawBody.buffer as ArrayBuffer, rawBody.byteOffset, rawBody.byteLength));
    bodyType = 'base64';
  } else if (rawBody instanceof FormData) {
    // Async path — collect entries synchronously first, then await async reads
    const rawEntries: [string, FormDataEntryValue][] = [];
    rawBody.forEach((value, name) => rawEntries.push([name, value]));
    const entries: FormDataEntry[] = [];
    for (const [name, value] of rawEntries) {
      if (typeof value === 'string') {
        entries.push({ name, value });
      } else {
        const data = await readBlobAsBase64(value);
        entries.push({
          name,
          filename: value instanceof File ? value.name : 'blob',
          data,
          contentType: value.type || 'application/octet-stream',
        });
      }
    }
    formDataEntries = entries;
    bodyType = 'formdata';
    delete headers['content-type'];
    delete headers['Content-Type'];
  } else if (rawBody instanceof Blob) {
    // Async path
    body = await readBlobAsBase64(rawBody);
    bodyType = 'base64';
  }

  const msg: FetchRequestMessage = {
    type: 'FETCH_REQUEST',
    id,
    url,
    method: init?.method ?? 'GET',
    headers,
    body,
    bodyType,
    formDataEntries,
  };

  ;(window as any).ReactNativeWebView.postMessage(JSON.stringify(msg));
  return new Response(null, { status: 200 });
}
