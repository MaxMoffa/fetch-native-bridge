// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { serializeResponse, isBinaryContentType } from '../../src/native/response';

function makeResponse(body: string | Uint8Array, contentType: string): Response {
  return new Response(body as BodyInit, {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': contentType },
  });
}

describe('serializeResponse', () => {
  it('serializes text response as text', async () => {
    const response = makeResponse('hello world', 'application/json');
    const msg = await serializeResponse('test-id', response);
    expect(msg.id).toBe('test-id');
    expect(msg.bodyEncoding).toBe('text');
    expect(msg.body).toBe('hello world');
    expect(msg.status).toBe(200);
    expect(msg.ok).toBe(true);
    expect(msg.type).toBe('FETCH_RESPONSE');
  });

  it('strips binary body by default (sendBinaryBody not set)', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const response = makeResponse(bytes, 'image/png');
    const msg = await serializeResponse('img-id', response);
    expect(msg.bodyEncoding).toBe('text');
    expect(msg.body).toBe('');
  });

  it('serializes binary response as base64 when sendBinaryBody: true', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const response = makeResponse(bytes, 'image/png');
    const msg = await serializeResponse('img-id', response, { sendBinaryBody: true });
    expect(msg.bodyEncoding).toBe('base64');
    expect(typeof msg.body).toBe('string');
    const decoded = Uint8Array.from(atob(msg.body), (c) => c.charCodeAt(0));
    expect(decoded[0]).toBe(0x89);
    expect(decoded[1]).toBe(0x50);
  });

  it('strips application/octet-stream body by default', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const response = makeResponse(bytes, 'application/octet-stream');
    const msg = await serializeResponse('bin-id', response);
    expect(msg.bodyEncoding).toBe('text');
    expect(msg.body).toBe('');
  });

  it('serializes application/octet-stream as base64 when sendBinaryBody: true', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const response = makeResponse(bytes, 'application/octet-stream');
    const msg = await serializeResponse('bin-id', response, { sendBinaryBody: true });
    expect(msg.bodyEncoding).toBe('base64');
  });

  it('strips application/pdf body by default', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]); // %PDF
    const response = makeResponse(bytes, 'application/pdf');
    const msg = await serializeResponse('pdf-id', response);
    expect(msg.bodyEncoding).toBe('text');
    expect(msg.body).toBe('');
  });

  it('serializes application/pdf as base64 when sendBinaryBody: true', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]); // %PDF
    const response = makeResponse(bytes, 'application/pdf');
    const msg = await serializeResponse('pdf-id', response, { sendBinaryBody: true });
    expect(msg.bodyEncoding).toBe('base64');
  });

  it('includes headers in the message', async () => {
    const response = makeResponse('data', 'text/plain; charset=utf-8');
    const msg = await serializeResponse('hdr-id', response);
    expect(msg.headers['content-type']).toContain('text/plain');
  });
});

describe('serializeResponse — content classification', () => {
  it.each([
    ['application/problem+json', false],
    ['application/vnd.api+json; charset=utf-8', false],
    ['image/svg+xml', false],
    ['text/csv', false],
    ['', false],
    ['application/x-protobuf', true],
    ['application/zip', true],
    ['font/woff2', true],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', true],
  ])('%s → binary: %s', (contentType, binary) => {
    expect(isBinaryContentType(contentType)).toBe(binary);
  });

  it('additionalBinaryTypes forces binary handling', () => {
    expect(isBinaryContentType('text/csv; charset=utf-8', ['Text/CSV'])).toBe(true);
  });

  it('marks stripped binary bodies as omitted', async () => {
    const msg = await serializeResponse('id', makeResponse(new Uint8Array([1]), 'application/zip'));
    expect(msg.bodyOmitted).toBe(true);
    expect(msg.body).toBe('');
  });

  it('omitBody skips text bodies too', async () => {
    const msg = await serializeResponse('id', makeResponse('{"a":1}', 'application/json'), { omitBody: true });
    expect(msg).toMatchObject({ body: '', bodyOmitted: true, status: 200 });
  });

  it('does not set bodyOmitted for forwarded bodies', async () => {
    const msg = await serializeResponse('id', makeResponse('{"a":1}', 'application/json'));
    expect(msg.bodyOmitted).toBeUndefined();
    expect(msg.v).toBe('2');
  });

  it('reads binary bodies through FileReader in React Native', async () => {
    vi.stubGlobal('navigator', { product: 'ReactNative' });
    class FakeFileReader {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      async readAsDataURL(blob: Blob) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        this.result = `data:application/octet-stream;base64,${btoa(String.fromCharCode(...bytes))}`;
        this.onload?.();
      }
    }
    vi.stubGlobal('FileReader', FakeFileReader);
    try {
      const msg = await serializeResponse('id', makeResponse(new Uint8Array([1, 2, 3]), 'application/zip'), {
        sendBinaryBody: true,
      });
      expect(msg).toMatchObject({ bodyEncoding: 'base64', body: btoa('\x01\x02\x03') });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
