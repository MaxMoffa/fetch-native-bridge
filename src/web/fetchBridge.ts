import { generateUUID } from '../shared/uuid';
import { isFetchResponseMessage, type FetchBridgeOptions, type FetchRequestMessage } from '../shared/protocol';
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

function buildBody(init?: RequestInit): string | null {
  if (!init?.body) return null;
  if (typeof init.body === 'string') return init.body;
  return String(init.body);
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
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

  const msg: FetchRequestMessage = {
    type: 'FETCH_REQUEST',
    id,
    url,
    method: init?.method ?? 'GET',
    headers: buildHeaders(init),
    body: buildBody(init),
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
