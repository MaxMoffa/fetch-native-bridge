import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchBridge, teardownFetchBridge } from '../../src/web/fetchBridge';
import { isBodyOmitted } from '../../src/web/response';
import {
  FetchBridgeBlockedError,
  FetchBridgeNetworkError,
  FetchBridgeTimeoutError,
  isFetchBridgeError,
} from '../../src/shared/errors';
import type { FetchResponseMessage } from '../../src/shared/protocol';

function makeNativeResponse(id: string, overrides?: Partial<FetchResponseMessage>): FetchResponseMessage {
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

function dispatchNativeResponse(msg: FetchResponseMessage): void {
  window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(msg) }));
}

describe('fetchBridge — non-WebView context', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('delegates to globalThis.fetch without the timeout option', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('hello'));
    vi.stubGlobal('fetch', mockFetch);
    await fetchBridge('https://example.com', { method: 'POST' });
    expect(mockFetch).toHaveBeenCalledWith('https://example.com', { method: 'POST' });
  });

  it('applies an explicit timeout in the browser too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          })
      )
    );
    await expect(fetchBridge('https://example.com', { timeout: 20 })).rejects.toBeInstanceOf(FetchBridgeTimeoutError);
  });

  it('forwards the caller abort signal when a timeout is set', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          })
      )
    );
    const controller = new AbortController();
    const promise = fetchBridge('https://example.com', { timeout: 10_000, signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('fetchBridge — WebView context', () => {
  let postMessage: ReturnType<typeof vi.fn>;

  async function nextRequest(index = 0): Promise<any> {
    await vi.waitFor(() => expect(postMessage.mock.calls.length).toBeGreaterThan(index));
    return JSON.parse(postMessage.mock.calls[index][0]);
  }

  function postedOfType(type: string): any[] {
    return postMessage.mock.calls.map((c) => JSON.parse(c[0])).filter((m) => m.type === type);
  }

  beforeEach(() => {
    postMessage = vi.fn();
    (window as any).ReactNativeWebView = { postMessage };
  });

  afterEach(() => {
    teardownFetchBridge();
    delete (window as any).ReactNativeWebView;
  });

  it('posts a FETCH_REQUEST message and resolves with native response', async () => {
    const fetchPromise = fetchBridge('https://api.example.com/data');
    const posted = await nextRequest();
    expect(posted).toMatchObject({
      type: 'FETCH_REQUEST',
      v: '2',
      url: 'https://api.example.com/data',
      method: 'GET',
      body: null,
      timeout: 30_000,
    });

    dispatchNativeResponse(makeNativeResponse(posted.id));
    const response = await fetchPromise;
    expect(response.status).toBe(200);
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('also accepts responses dispatched on document (older Android)', async () => {
    const fetchPromise = fetchBridge('https://api.example.com/data');
    const posted = await nextRequest();
    document.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(makeNativeResponse(posted.id)) }));
    expect((await fetchPromise).status).toBe(200);
  });

  it('resolves relative URLs against the page URL', async () => {
    const fetchPromise = fetchBridge('/api/profile?x=1');
    const posted = await nextRequest();
    expect(posted.url).toBe(new URL('/api/profile?x=1', document.baseURI).href);
    dispatchNativeResponse(makeNativeResponse(posted.id));
    await fetchPromise;
  });

  it('accepts URL objects', async () => {
    const fetchPromise = fetchBridge(new URL('https://api.example.com/u'));
    const posted = await nextRequest();
    expect(posted.url).toBe('https://api.example.com/u');
    dispatchNativeResponse(makeNativeResponse(posted.id));
    await fetchPromise;
  });

  it('reads method, headers and body from a Request object', async () => {
    const request = new Request('https://api.example.com/items', {
      method: 'POST',
      headers: { 'X-Custom': 'yes', 'Content-Type': 'application/json' },
      body: '{"a":1}',
    });
    const fetchPromise = fetchBridge(request);
    const posted = await nextRequest();
    expect(posted.method).toBe('POST');
    expect(posted.headers['x-custom']).toBe('yes');
    expect(posted.headers['content-type']).toBe('application/json');
    expect(posted.bodyType).toBe('base64');
    expect(atob(posted.body)).toBe('{"a":1}');
    dispatchNativeResponse(makeNativeResponse(posted.id));
    await fetchPromise;
  });

  it('lets init override Request fields', async () => {
    const request = new Request('https://api.example.com/items', { method: 'POST', body: 'x' });
    const fetchPromise = fetchBridge(request, { method: 'put', body: 'y' });
    const posted = await nextRequest();
    expect(posted.method).toBe('PUT');
    expect(posted.body).toBe('y');
    dispatchNativeResponse(makeNativeResponse(posted.id));
    await fetchPromise;
  });

  it('normalises method and lower-cases header names', async () => {
    const fetchPromise = fetchBridge('https://api.example.com/post', {
      method: 'post',
      headers: [['Authorization', 'Bearer token'], ['Content-Type', 'application/json']],
      body: '{"data":1}',
    });
    const posted = await nextRequest();
    expect(posted.method).toBe('POST');
    expect(posted.headers).toEqual({ authorization: 'Bearer token', 'content-type': 'application/json' });
    expect(posted.body).toBe('{"data":1}');
    expect(posted.bodyType).toBe('text');
    dispatchNativeResponse(makeNativeResponse(posted.id));
    await fetchPromise;
  });

  it('sets the default content-type for string bodies', async () => {
    const fetchPromise = fetchBridge('https://api.example.com/t', { method: 'POST', body: 'hi' });
    const posted = await nextRequest();
    expect(posted.headers['content-type']).toBe('text/plain;charset=UTF-8');
    dispatchNativeResponse(makeNativeResponse(posted.id));
    await fetchPromise;
  });

  it('serializes URLSearchParams with the form content-type', async () => {
    const fetchPromise = fetchBridge('https://api.example.com/search', {
      method: 'POST',
      body: new URLSearchParams({ foo: 'bar', baz: '42' }),
    });
    const posted = await nextRequest();
    expect(posted.bodyType).toBe('text');
    expect(posted.body).toBe('foo=bar&baz=42');
    expect(posted.headers['content-type']).toBe('application/x-www-form-urlencoded;charset=UTF-8');
    dispatchNativeResponse(makeNativeResponse(posted.id));
    await fetchPromise;
  });

  it('serializes FormData text fields and strips any manual content-type', async () => {
    const fd = new FormData();
    fd.append('username', 'alice');
    fd.append('role', 'admin');
    const fetchPromise = fetchBridge('https://api.example.com/form', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data' },
      body: fd,
    });
    const posted = await nextRequest();
    expect(posted.bodyType).toBe('formdata');
    expect(posted.body).toBeNull();
    expect(posted.formDataEntries).toEqual([
      { name: 'username', value: 'alice' },
      { name: 'role', value: 'admin' },
    ]);
    expect(posted.headers['content-type']).toBeUndefined();
    dispatchNativeResponse(makeNativeResponse(posted.id));
    await fetchPromise;
  });

  it('serializes FormData file entries as base64, preserving order', async () => {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array([0x41, 0x42])], { type: 'text/plain' }), 'test.txt');
    fd.append('note', 'after');
    const fetchPromise = fetchBridge('https://api.example.com/upload', { method: 'POST', body: fd });
    const posted = await nextRequest();
    expect(posted.formDataEntries).toEqual([
      { name: 'file', filename: 'test.txt', data: btoa('AB'), contentType: 'text/plain' },
      { name: 'note', value: 'after' },
    ]);
    dispatchNativeResponse(makeNativeResponse(posted.id));
    await fetchPromise;
  });

  it('serializes Blob bodies and uses their type as content-type', async () => {
    const fetchPromise = fetchBridge('https://api.example.com/b', {
      method: 'POST',
      body: new Blob(['hey'], { type: 'text/csv' }),
    });
    const posted = await nextRequest();
    expect(posted.bodyType).toBe('base64');
    expect(atob(posted.body)).toBe('hey');
    expect(posted.headers['content-type']).toBe('text/csv');
    dispatchNativeResponse(makeNativeResponse(posted.id));
    await fetchPromise;
  });

  it('serializes ArrayBuffer and TypedArray views as base64', async () => {
    const buf = new Uint8Array([0x00, 0x89, 0x50, 0x4e, 0x47, 0xff]);
    const p1 = fetchBridge('https://api.example.com/bin', { method: 'POST', body: buf.buffer });
    const p2 = fetchBridge('https://api.example.com/bin', { method: 'POST', body: buf.subarray(1, 5) });
    const first = await nextRequest(0);
    const second = await nextRequest(1);
    expect(first.body).toBe(btoa('\x00\x89\x50\x4e\x47\xff'));
    expect(second.body).toBe(btoa('\x89\x50\x4e\x47'));
    dispatchNativeResponse(makeNativeResponse(first.id));
    dispatchNativeResponse(makeNativeResponse(second.id));
    await Promise.all([p1, p2]);
  });

  it('rejects unsupported bodies with a TypeError', async () => {
    const stream = new ReadableStream();
    await expect(fetchBridge('https://api.example.com/s', { method: 'POST', body: stream })).rejects.toBeInstanceOf(
      TypeError
    );
  });

  it('decodes base64 bodies from native', async () => {
    const fetchPromise = fetchBridge('https://api.example.com/img');
    const posted = await nextRequest();
    dispatchNativeResponse(
      makeNativeResponse(posted.id, {
        headers: { 'content-type': 'image/png' },
        body: btoa('\x89\x50\x4e\x47'),
        bodyEncoding: 'base64',
      })
    );
    const bytes = new Uint8Array(await (await fetchPromise).arrayBuffer());
    expect(Array.from(bytes)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('exposes url, redirected and bodyOmitted', async () => {
    const fetchPromise = fetchBridge('https://api.example.com/file.pdf');
    const posted = await nextRequest();
    dispatchNativeResponse(
      makeNativeResponse(posted.id, {
        headers: { 'content-type': 'application/pdf' },
        body: '',
        url: 'https://cdn.example.com/file.pdf',
        redirected: true,
        bodyOmitted: true,
      })
    );
    const response = await fetchPromise;
    expect(response.url).toBe('https://cdn.example.com/file.pdf');
    expect(response.redirected).toBe(true);
    expect(isBodyOmitted(response)).toBe(true);
    expect(isBodyOmitted(new Response('x'))).toBe(false);
  });

  it('handles null-body statuses', async () => {
    const fetchPromise = fetchBridge('https://api.example.com/x', { method: 'DELETE' });
    const posted = await nextRequest();
    dispatchNativeResponse(makeNativeResponse(posted.id, { status: 204, statusText: 'No Content', body: 'ignored' }));
    const response = await fetchPromise;
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('rejects network errors with a TypeError, like fetch', async () => {
    const fetchPromise = fetchBridge('https://api.example.com/fail');
    const posted = await nextRequest();
    dispatchNativeResponse(makeNativeResponse(posted.id, { status: 0, ok: false, body: '', error: 'Network error' }));
    const err = await fetchPromise.catch((e) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err).toBeInstanceOf(FetchBridgeNetworkError);
    expect(isFetchBridgeError(err)).toBe(true);
    expect(err.message).toBe('Network error');
  });

  it('maps native error names to typed errors', async () => {
    const cases: Array<[FetchResponseMessage['errorName'], (e: any) => void]> = [
      ['BlockedError', (e) => expect(e).toBeInstanceOf(FetchBridgeBlockedError)],
      ['TimeoutError', (e) => expect(e).toBeInstanceOf(FetchBridgeTimeoutError)],
      ['AbortError', (e) => expect(e.name).toBe('AbortError')],
    ];
    for (let i = 0; i < cases.length; i++) {
      const [errorName, assert] = cases[i];
      const fetchPromise = fetchBridge('https://api.example.com/e');
      const posted = await nextRequest(i);
      dispatchNativeResponse(makeNativeResponse(posted.id, { status: 0, ok: false, error: 'x', errorName }));
      assert(await fetchPromise.catch((e) => e));
    }
  });

  it('ignores unrelated messages on the channel', async () => {
    const fetchPromise = fetchBridge('https://api.example.com/data');
    const posted = await nextRequest();
    window.dispatchEvent(new MessageEvent('message', { data: 'not json' }));
    window.dispatchEvent(new MessageEvent('message', { data: '{"type":"OTHER"}' }));
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'FETCH_RESPONSE' } }));
    dispatchNativeResponse(makeNativeResponse(posted.id));
    expect((await fetchPromise).status).toBe(200);
  });

  it('times out, and asks native to cancel', async () => {
    const settled = fetchBridge('https://api.example.com/slow', { timeout: 30 }).catch((e) => e);
    const posted = await nextRequest();
    expect(posted.timeout).toBe(30);
    expect(await settled).toBeInstanceOf(FetchBridgeTimeoutError);
    expect(postedOfType('FETCH_CANCEL')).toEqual([{ type: 'FETCH_CANCEL', v: '2', id: posted.id }]);
  });

  it('timeout: 0 disables the web-side timer', async () => {
    vi.useFakeTimers();
    try {
      const fetchPromise = fetchBridge('https://api.example.com/slow', { timeout: 0 });
      await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());
      const posted = JSON.parse(postMessage.mock.calls[0][0]);
      vi.advanceTimersByTime(10 * 60_000);
      dispatchNativeResponse(makeNativeResponse(posted.id));
      expect((await fetchPromise).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fetchBridge('https://api.example.com', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('aborting rejects with the signal reason and sends FETCH_CANCEL', async () => {
    const controller = new AbortController();
    const fetchPromise = fetchBridge('https://api.example.com/data', { signal: controller.signal });
    const posted = await nextRequest();
    controller.abort();
    await expect(fetchPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(postedOfType('FETCH_CANCEL')).toEqual([{ type: 'FETCH_CANCEL', v: '2', id: posted.id }]);
  });

  it('removes the abort listener once settled', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const fetchPromise = fetchBridge('https://api.example.com/data', { signal: controller.signal });
    const posted = await nextRequest();
    dispatchNativeResponse(makeNativeResponse(posted.id));
    await fetchPromise;
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    controller.abort();
    expect(postedOfType('FETCH_CANCEL')).toHaveLength(0);
  });

  it('teardownFetchBridge rejects pending requests and cancels them natively', async () => {
    const fetchPromise = fetchBridge('https://api.example.com/data');
    const posted = await nextRequest();
    teardownFetchBridge();
    await expect(fetchPromise).rejects.toThrow('torn down');
    expect(postedOfType('FETCH_CANCEL')).toEqual([{ type: 'FETCH_CANCEL', v: '2', id: posted.id }]);
  });

  it('keeps working after teardown', async () => {
    teardownFetchBridge();
    const fetchPromise = fetchBridge('https://api.example.com/data');
    const posted = await nextRequest();
    dispatchNativeResponse(makeNativeResponse(posted.id));
    expect((await fetchPromise).ok).toBe(true);
  });

  it('rejects when postMessage throws', async () => {
    postMessage.mockImplementation(() => {
      throw new Error('too big');
    });
    await expect(fetchBridge('https://api.example.com/data')).rejects.toBeInstanceOf(FetchBridgeNetworkError);
  });
});
