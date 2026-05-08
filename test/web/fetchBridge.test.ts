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
});
