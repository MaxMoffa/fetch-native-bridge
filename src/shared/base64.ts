const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
// String.fromCharCode.apply has an argument-count limit; stay well below it.
const CHUNK_SIZE = 0x8000;

let _lookup: Uint8Array | undefined;
function lookup(): Uint8Array {
  if (!_lookup) {
    _lookup = new Uint8Array(128).fill(255);
    for (let i = 0; i < ALPHABET.length; i++) _lookup[ALPHABET.charCodeAt(i)] = i;
    // Accept the URL-safe alphabet as well.
    _lookup[45 /* - */] = 62;
    _lookup[95 /* _ */] = 63;
  }
  return _lookup;
}

function encodePure(bytes: Uint8Array): string {
  let out = '';
  const len = bytes.length;
  let i = 0;
  for (; i + 2 < len; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
  }
  if (i < len) {
    const n = (bytes[i] << 16) | (i + 1 < len ? bytes[i + 1] << 8 : 0);
    out += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63];
    out += i + 1 < len ? ALPHABET[(n >> 6) & 63] + '=' : '==';
  }
  return out;
}

function decodePure(b64: string): Uint8Array {
  const table = lookup();
  const out = new Uint8Array(Math.floor((b64.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < b64.length; i++) {
    const code = b64.charCodeAt(i);
    const value = code < 128 ? table[code] : 255;
    if (value === 255) continue; // padding, whitespace
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/**
 * Encodes bytes as base64. Uses `btoa` when available (browsers, Hermes ≥ RN 0.74)
 * and a pure-JS encoder otherwise.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof btoa !== 'function') return encodePure(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE) as unknown as number[]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(b64: string): Uint8Array {
  if (typeof atob !== 'function') return decodePure(b64);
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    return decodePure(b64); // URL-safe alphabet or stray whitespace
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Copies the bytes into a standalone ArrayBuffer (no shared/oversized backing buffer). */
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bytes = base64ToUint8Array(b64);
  return bytes.buffer.byteLength === bytes.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.slice().buffer as ArrayBuffer);
}

/**
 * Reads a Blob as base64 via `FileReader.readAsDataURL`, which is implemented natively
 * on every React Native version (unlike `readAsArrayBuffer`) and in all browsers.
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

export const _internal = { encodePure, decodePure };
