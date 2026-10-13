import { describe, it, expect, vi, afterEach } from 'vitest';
import { _internal, base64ToArrayBuffer, base64ToUint8Array, uint8ArrayToBase64 } from '../../src/shared/base64';

function reference(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

const sample = Uint8Array.from({ length: 256 }, (_, i) => i);

describe('base64', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips every byte value', () => {
    const b64 = uint8ArrayToBase64(sample);
    expect(b64).toBe(reference(sample));
    expect(Array.from(base64ToUint8Array(b64))).toEqual(Array.from(sample));
  });

  it('handles payloads larger than the chunk size', () => {
    const big = new Uint8Array(200_000).map((_, i) => (i * 31) & 0xff);
    const b64 = uint8ArrayToBase64(big);
    expect(b64).toBe(reference(big));
    expect(same(base64ToUint8Array(b64), big)).toBe(true);
  });

  it.each([[[]], [[1]], [[1, 2]], [[1, 2, 3]], [[1, 2, 3, 4]]])('pure encoder matches btoa for %j', (bytes) => {
    const arr = new Uint8Array(bytes);
    const expected = reference(arr);
    expect(_internal.encodePure(arr)).toBe(expected);
    expect(Array.from(_internal.decodePure(expected))).toEqual(bytes);
  });

  it('falls back to the pure implementation without atob/btoa (old Hermes)', () => {
    const expected = reference(sample);
    vi.stubGlobal('btoa', undefined);
    vi.stubGlobal('atob', undefined);
    const b64 = uint8ArrayToBase64(sample);
    expect(b64).toBe(expected);
    expect(base64ToUint8Array(b64)).toEqual(sample);
  });

  it('decodes URL-safe base64 and ignores whitespace', () => {
    expect(Array.from(base64ToUint8Array('-_8='))).toEqual([0xfb, 0xff]);
    expect(Array.from(base64ToUint8Array('QU\nJD'))).toEqual([0x41, 0x42, 0x43]);
  });

  it('base64ToArrayBuffer returns a tightly sized buffer', () => {
    expect(base64ToArrayBuffer('QUJD').byteLength).toBe(3);
    expect(base64ToArrayBuffer('-_8=').byteLength).toBe(2);
  });
});
