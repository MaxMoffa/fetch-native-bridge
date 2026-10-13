import type { FetchResponseMessage } from '../shared/protocol';
import { base64ToArrayBuffer } from '../shared/base64';

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);
const omittedBodies = new WeakSet<Response>();

function defineReadonly(target: object, key: string, value: unknown): void {
  try {
    Object.defineProperty(target, key, { value, enumerable: true, configurable: true });
  } catch {
    // Non-configurable in some engines; the default value is an acceptable fallback.
  }
}

/** Rebuilds a standard `Response` from a native `FETCH_RESPONSE` message. */
export function buildResponse(msg: FetchResponseMessage): Response {
  let body: BodyInit | null = null;
  if (!NULL_BODY_STATUSES.has(msg.status) && msg.body) {
    body = msg.bodyEncoding === 'base64' ? base64ToArrayBuffer(msg.body) : msg.body;
  }

  const response = new Response(body, {
    status: msg.status,
    statusText: msg.statusText ?? '',
    headers: msg.headers ?? {},
  });

  if (msg.url) defineReadonly(response, 'url', msg.url);
  if (msg.redirected) defineReadonly(response, 'redirected', true);
  if (msg.bodyOmitted) omittedBodies.add(response);
  return response;
}

/**
 * Returns `true` when the native side intentionally did not forward the response body —
 * because it was binary and `sendBinaryBody` is off, or because `onFetch` returned `false`
 * (e.g. the file was saved to disk). Status and headers are still accurate.
 */
export function isBodyOmitted(response: Response): boolean {
  return omittedBodies.has(response);
}
