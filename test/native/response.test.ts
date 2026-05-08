// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { serializeResponse } from '../../src/native/response';

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

  it('serializes binary response as base64', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const response = makeResponse(bytes, 'image/png');
    const msg = await serializeResponse('img-id', response);
    expect(msg.bodyEncoding).toBe('base64');
    expect(typeof msg.body).toBe('string');
    // Decode and verify
    const decoded = Uint8Array.from(atob(msg.body), (c) => c.charCodeAt(0));
    expect(decoded[0]).toBe(0x89);
    expect(decoded[1]).toBe(0x50);
  });

  it('serializes application/octet-stream as base64', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const response = makeResponse(bytes, 'application/octet-stream');
    const msg = await serializeResponse('bin-id', response);
    expect(msg.bodyEncoding).toBe('base64');
  });

  it('serializes application/pdf as base64', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]); // %PDF
    const response = makeResponse(bytes, 'application/pdf');
    const msg = await serializeResponse('pdf-id', response);
    expect(msg.bodyEncoding).toBe('base64');
  });

  it('includes headers in the message', async () => {
    const response = makeResponse('data', 'text/plain; charset=utf-8');
    const msg = await serializeResponse('hdr-id', response);
    expect(msg.headers['content-type']).toContain('text/plain');
  });
});
