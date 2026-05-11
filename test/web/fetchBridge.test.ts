import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchBridge } from '../../src/web/fetchBridge';
import type { FetchResponseMessage } from '../../src/shared/protocol';

function makeResponseMsg(id: string, overrides?: Partial<FetchResponseMessage>): FetchResponseMessage {
  return {
    type: 'FETCH_RESPONSE',
    id,
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: '{"ok":true}',
    bodyEncoding: 'text',
    ok: true,
    ...overrides,
  };
}

function fireMessageEvent(data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
}

describe('fetchBridge — non-WebView context', () => {
  it('delegates to globalThis.fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('hello'));
    vi.stubGlobal('fetch', mockFetch);
    await fetchBridge('https://example.com');
    expect(mockFetch).toHaveBeenCalledWith('https://example.com', {});
    vi.unstubAllGlobals();
  });
});

describe('fetchBridge — WebView context', () => {
  let postMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    postMessage = vi.fn();
    (window as any).ReactNativeWebView = { postMessage };
  });

  afterEach(() => {
    delete (window as any).ReactNativeWebView;
    vi.useRealTimers();
  });

  it('posts a FETCH_REQUEST message and resolves when response arrives', async () => {
    const fetchPromise = fetchBridge('https://api.example.com/data');

    // Capture the posted message to get the UUID
    expect(postMessage).toHaveBeenCalledOnce();
    const postedMsg = JSON.parse(postMessage.mock.calls[0][0]);
    expect(postedMsg.type).toBe('FETCH_REQUEST');
    expect(postedMsg.url).toBe('https://api.example.com/data');
    expect(postedMsg.method).toBe('GET');

    // Fire matching response
    fireMessageEvent(makeResponseMsg(postedMsg.id));

    const response = await fetchPromise;
    expect(response.status).toBe(200);
    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('ignores messages with mismatched id', async () => {
    vi.useFakeTimers();
    const fetchPromise = fetchBridge('https://api.example.com/data', { timeout: 500 });

    // Fire response with wrong id
    fireMessageEvent(makeResponseMsg('wrong-id'));

    vi.advanceTimersByTime(600);
    await expect(fetchPromise).rejects.toThrow('timed out');
  });

  it('rejects on timeout', async () => {
    vi.useFakeTimers();
    const fetchPromise = fetchBridge('https://api.example.com/slow', { timeout: 1000 });
    vi.advanceTimersByTime(1001);
    await expect(fetchPromise).rejects.toThrow('timed out');
  });

  it('rejects when response has error field', async () => {
    const fetchPromise = fetchBridge('https://api.example.com/fail');
    const postedMsg = JSON.parse(postMessage.mock.calls[0][0]);
    fireMessageEvent(makeResponseMsg(postedMsg.id, { error: 'network failure', ok: false, status: 0 }));
    await expect(fetchPromise).rejects.toThrow('network failure');
  });

  it('decodes base64 body for binary responses', async () => {
    const fetchPromise = fetchBridge('https://api.example.com/img');
    const postedMsg = JSON.parse(postMessage.mock.calls[0][0]);

    // base64 of [0x89, 0x50] (PNG magic bytes prefix)
    const b64 = btoa('\x89\x50');
    fireMessageEvent(makeResponseMsg(postedMsg.id, {
      headers: { 'content-type': 'image/png' },
      body: b64,
      bodyEncoding: 'base64',
    }));

    const response = await fetchPromise;
    const buffer = await response.arrayBuffer();
    expect(new Uint8Array(buffer)[0]).toBe(0x89);
    expect(new Uint8Array(buffer)[1]).toBe(0x50);
  });

  it('sends correct method and headers', async () => {
    const fetchPromise = fetchBridge('https://api.example.com/post', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: '{"data":1}',
    });
    const postedMsg = JSON.parse(postMessage.mock.calls[0][0]);
    expect(postedMsg.method).toBe('POST');
    expect(postedMsg.headers['Authorization']).toBe('Bearer token');
    expect(postedMsg.body).toBe('{"data":1}');

    fireMessageEvent(makeResponseMsg(postedMsg.id));
    await fetchPromise;
  });

  it('serializes FormData text fields as formdata bodyType', async () => {
    const fd = new FormData();
    fd.append('username', 'alice');
    fd.append('role', 'admin');

    const fetchPromise = fetchBridge('https://api.example.com/form', {
      method: 'POST',
      body: fd,
    });

    await new Promise((r) => setTimeout(r, 10));
    const postedMsg = JSON.parse(postMessage.mock.calls[0][0]);
    expect(postedMsg.bodyType).toBe('formdata');
    expect(postedMsg.body).toBeNull();
    expect(postedMsg.formDataEntries).toEqual([
      { name: 'username', value: 'alice' },
      { name: 'role', value: 'admin' },
    ]);
    expect(postedMsg.headers['content-type']).toBeUndefined();
    expect(postedMsg.headers['Content-Type']).toBeUndefined();

    fireMessageEvent(makeResponseMsg(postedMsg.id));
    await fetchPromise;
  });

  it('strips manual content-type when body is FormData', async () => {
    const fd = new FormData();
    fd.append('x', '1');

    const fetchPromise = fetchBridge('https://api.example.com/form', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data' },
      body: fd,
    });

    await new Promise((r) => setTimeout(r, 10));
    const postedMsg = JSON.parse(postMessage.mock.calls[0][0]);
    expect(postedMsg.headers['Content-Type']).toBeUndefined();
    expect(postedMsg.headers['content-type']).toBeUndefined();

    fireMessageEvent(makeResponseMsg(postedMsg.id));
    await fetchPromise;
  });

  it('serializes FormData with Blob entry as base64', async () => {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array([0x41, 0x42])], { type: 'text/plain' }), 'test.txt');

    const fetchPromise = fetchBridge('https://api.example.com/upload', {
      method: 'POST',
      body: fd,
    });

    await new Promise((r) => setTimeout(r, 10));
    const postedMsg = JSON.parse(postMessage.mock.calls[0][0]);
    expect(postedMsg.bodyType).toBe('formdata');
    const entry = postedMsg.formDataEntries[0];
    expect(entry.name).toBe('file');
    expect(entry.filename).toBe('test.txt');
    expect(entry.contentType).toBe('text/plain');
    expect(entry.data).toBe(btoa('AB'));

    fireMessageEvent(makeResponseMsg(postedMsg.id));
    await fetchPromise;
  });

  it('serializes URLSearchParams as text bodyType', async () => {
    const params = new URLSearchParams({ foo: 'bar', baz: '42' });

    const fetchPromise = fetchBridge('https://api.example.com/search', {
      method: 'POST',
      body: params,
    });

    const postedMsg = JSON.parse(postMessage.mock.calls[0][0]);
    expect(postedMsg.bodyType).toBe('text');
    expect(postedMsg.body).toBe('foo=bar&baz=42');

    fireMessageEvent(makeResponseMsg(postedMsg.id));
    await fetchPromise;
  });

  it('serializes ArrayBuffer as base64 bodyType', async () => {
    const buf = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;

    const fetchPromise = fetchBridge('https://api.example.com/binary', {
      method: 'POST',
      body: buf,
    });

    const postedMsg = JSON.parse(postMessage.mock.calls[0][0]);
    expect(postedMsg.bodyType).toBe('base64');
    expect(postedMsg.body).toBe(btoa('\x89\x50\x4e\x47'));

    fireMessageEvent(makeResponseMsg(postedMsg.id));
    await fetchPromise;
  });
});
