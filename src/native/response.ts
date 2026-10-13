import { PROTOCOL_VERSION, type BodyEncoding, type FetchResponseMessage } from '../shared/protocol';
import { blobToBase64, uint8ArrayToBase64 } from '../shared/base64';
import { isReactNative } from './env';

export interface SerializeResponseOptions {
  sendBinaryBody?: boolean;
  additionalBinaryTypes?: string[];
  /** Skip the body entirely (status and headers are still sent). */
  omitBody?: boolean;
}

// Anything that is not recognisably text is treated as binary: decoding arbitrary bytes
// with `response.text()` would corrupt them (protobuf, zip, fonts, …).
const TEXT_TYPE_RE =
  /^text\/|^application\/(?:[\w.-]+\+)?(?:json|xml|yaml|x-yaml|graphql|javascript|x-javascript|ecmascript|x-www-form-urlencoded|x-ndjson|ndjson|csv)$|^image\/svg\+xml$/;

export function isBinaryContentType(contentType: string, additionalBinaryTypes?: string[]): boolean {
  const type = contentType.trim().toLowerCase();
  if (!type) return false; // no content-type: most often an empty or plain-text API response
  if (additionalBinaryTypes?.some((prefix) => type.startsWith(prefix.toLowerCase()))) return true;
  return !TEXT_TYPE_RE.test(type.split(';')[0].trim());
}

async function readBodyAsBase64(response: Response): Promise<string> {
  // In React Native, FileReader.readAsDataURL runs natively and exists on every version,
  // whereas Response.arrayBuffer() relies on readAsArrayBuffer (missing before RN 0.72).
  if (isReactNative()) return blobToBase64(await response.blob());
  return uint8ArrayToBase64(new Uint8Array(await response.arrayBuffer()));
}

/** Converts a native `Response` into a `FETCH_RESPONSE` message. */
export async function serializeResponse(
  id: string,
  response: Response,
  options?: SerializeResponseOptions
): Promise<FetchResponseMessage> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  let body = '';
  let bodyEncoding: BodyEncoding = 'text';
  let bodyOmitted = false;

  if (options?.omitBody) {
    bodyOmitted = true;
  } else if (isBinaryContentType(headers['content-type'] ?? '', options?.additionalBinaryTypes)) {
    if (options?.sendBinaryBody) {
      body = await readBodyAsBase64(response);
      bodyEncoding = 'base64';
    } else {
      // Large binary payloads over postMessage are slow and memory-hungry; native code should
      // handle them (save to disk, share sheet…) and the web side only gets status/headers.
      bodyOmitted = true;
    }
  } else {
    body = await response.text();
  }

  const message: FetchResponseMessage = {
    type: 'FETCH_RESPONSE',
    v: PROTOCOL_VERSION,
    id,
    status: response.status,
    statusText: response.statusText ?? '',
    headers,
    body,
    bodyEncoding,
    ok: response.ok,
  };
  if (response.url) message.url = response.url;
  if (response.redirected === true) message.redirected = true;
  if (bodyOmitted) message.bodyOmitted = true;
  return message;
}
