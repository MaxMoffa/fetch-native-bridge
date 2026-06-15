import type { FetchResponseMessage } from '../shared/protocol';

const BINARY_CONTENT_TYPES = ['image/', 'application/octet-stream', 'application/pdf', 'audio/', 'video/'];

function isBinary(contentType: string): boolean {
  return BINARY_CONTENT_TYPES.some((prefix) => contentType.startsWith(prefix));
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function serializeResponse(
  id: string,
  response: Response,
  options?: { sendBinaryBody?: boolean }
): Promise<FetchResponseMessage> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => { headers[key] = value; });

  const contentType = headers['content-type'] ?? '';
  let body: string;
  let bodyEncoding: 'text' | 'base64';

  if (isBinary(contentType)) {
    if (options?.sendBinaryBody) {
      const buffer = await response.arrayBuffer();
      body = uint8ArrayToBase64(new Uint8Array(buffer));
      bodyEncoding = 'base64';
    } else {
      // Don't serialize binary body — avoids large postMessage payloads.
      // Native side should handle binary responses directly (save to disk, etc.).
      body = '';
      bodyEncoding = 'text';
    }
  } else {
    body = await response.text();
    bodyEncoding = 'text';
  }

  return {
    type: 'FETCH_RESPONSE',
    id,
    status: response.status,
    statusText: response.statusText,
    headers,
    body,
    bodyEncoding,
    ok: response.ok,
  };
}
