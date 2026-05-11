import { generateUUID } from '../shared/uuid';
import { isFetchResponseMessage, type FetchBridgeOptions, type FetchRequestMessage, type FormDataEntry } from '../shared/protocol';
import { uint8ArrayToBase64, base64ToUint8Array } from '../shared/base64';
import { isReactNativeWebView } from './detect';
import { PendingRequestMap } from './pending';

const DEFAULT_TIMEOUT = 30_000;
const pending = new PendingRequestMap();

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

function buildResponse(msg: {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyEncoding: 'text' | 'base64';
  ok: boolean;
}): Response {
  const responseBody: BodyInit =
    msg.bodyEncoding === 'base64'
      ? base64ToUint8Array(msg.body).buffer as ArrayBuffer
      : msg.body;

  return new Response(responseBody, {
    status: msg.status,
    statusText: msg.statusText,
    headers: msg.headers,
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
  const timeout = init?.timeout ?? DEFAULT_TIMEOUT;
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

  return new Promise<Response>((resolve, reject) => {
    function onMessage(event: MessageEvent) {
      let data: unknown;
      try {
        data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (!isFetchResponseMessage(data) || data.id !== id) return;

      window.removeEventListener('message', onMessage);

      if (data.error) {
        pending.reject(id, new Error(data.error));
        return;
      }
      pending.resolve(id, data);
    }

    pending.add(
      id,
      (responseMsg) => resolve(buildResponse(responseMsg)),
      reject,
      timeout
    );

    window.addEventListener('message', onMessage);
    ;(window as any).ReactNativeWebView.postMessage(JSON.stringify(msg));
  });
}
