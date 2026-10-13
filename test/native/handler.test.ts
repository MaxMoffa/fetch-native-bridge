// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupFetchHandler } from '../../src/native/handler';
import type { WebViewRef, WebViewMessageEvent } from '../../src/types/react-native';
import type { FetchRequestMessage } from '../../src/shared/protocol';

function makeWebViewRef(): WebViewRef & { current: { postMessage: ReturnType<typeof vi.fn> } } {
  return { current: { postMessage: vi.fn() } };
}

function makeEvent(data: unknown, url?: string): WebViewMessageEvent {
  return { nativeEvent: { data: JSON.stringify(data), url } };
}

function posted(ref: ReturnType<typeof makeWebViewRef>): any[] {
  return ref.current.postMessage.mock.calls.map((c) => JSON.parse(c[0]));
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

const validRequest: FetchRequestMessage = {
  type: 'FETCH_REQUEST',
  id: 'req-1',
  url: 'https://api.example.com/data',
  method: 'GET',
  headers: {},
  body: null,
};

/** A fetch that never settles until aborted. */
function hangingFetch() {
  return vi.fn().mockImplementation(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })
  );
}

describe('setupFetchHandler', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response('{"result":true}', {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
          })
        )
      )
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('ignores non-bridge and invalid messages, returning false', async () => {
    const ref = makeWebViewRef();
    const { onMessage } = setupFetchHandler(ref);
    expect(onMessage(makeEvent({ type: 'OTHER', id: 'x' }))).toBe(false);
    expect(onMessage({ nativeEvent: { data: 'not-json' } })).toBe(false);
    expect(onMessage({ nativeEvent: { data: '{broken' } })).toBe(false);
    expect(onMessage(makeEvent({ ...validRequest, headers: { a: 1 } }))).toBe(false);
    await tick();
    expect(ref.current.postMessage).not.toHaveBeenCalled();
  });

  it('fetches and posts FETCH_RESPONSE back', async () => {
    const ref = makeWebViewRef();
    const { onMessage } = setupFetchHandler(ref);
    expect(onMessage(makeEvent(validRequest))).toBe(true);
    await tick();

    const [msg] = posted(ref);
    expect(msg).toMatchObject({
      type: 'FETCH_RESPONSE',
      v: '2',
      id: 'req-1',
      status: 200,
      ok: true,
      body: '{"result":true}',
      bodyEncoding: 'text',
    });
    expect(msg.error).toBeUndefined();
  });

  it('accepts v1 messages without method/headers', async () => {
    const ref = makeWebViewRef();
    const { onMessage } = setupFetchHandler(ref);
    onMessage(makeEvent({ type: 'FETCH_REQUEST', id: 'old', url: 'https://api.example.com', body: null }));
    await tick();
    expect(fetch).toHaveBeenCalledWith('https://api.example.com', expect.objectContaining({ method: 'GET' }));
    expect(posted(ref)[0].status).toBe(200);
  });

  it('posts a NetworkError on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('DNS failure')));
    const ref = makeWebViewRef();
    const { onMessage } = setupFetchHandler(ref);
    onMessage(makeEvent(validRequest));
    await tick();

    const [msg] = posted(ref);
    expect(msg).toMatchObject({ id: 'req-1', status: 0, ok: false, error: 'DNS failure', errorName: 'NetworkError' });
  });

  it('onFetch returning false still answers, without body', async () => {
    const ref = makeWebViewRef();
    const onFetch = vi.fn().mockResolvedValue(false);
    const { onMessage } = setupFetchHandler(ref, { onFetch });
    onMessage(makeEvent(validRequest));
    await tick();

    expect(onFetch).toHaveBeenCalledOnce();
    expect(onFetch.mock.calls[0][0]).toMatchObject({ id: 'req-1' });
    expect(onFetch.mock.calls[0][1]).toBeInstanceOf(Response);
    const [msg] = posted(ref);
    expect(msg).toMatchObject({ status: 200, ok: true, body: '', bodyOmitted: true });
  });

  it('onFetch returning true or nothing forwards the body', async () => {
    for (const result of [true, undefined]) {
      const ref = makeWebViewRef();
      const { onMessage } = setupFetchHandler(ref, { onFetch: () => result });
      onMessage(makeEvent(validRequest));
      await tick();
      expect(posted(ref)[0].body).toBe('{"result":true}');
    }
  });

  it('onFetch throwing is reported as a network error', async () => {
    const ref = makeWebViewRef();
    const { onMessage } = setupFetchHandler(ref, {
      onFetch: () => {
        throw new Error('disk full');
      },
    });
    onMessage(makeEvent(validRequest));
    await tick();
    expect(posted(ref)[0]).toMatchObject({ error: 'disk full', errorName: 'NetworkError' });
  });

  it('passes method, headers, credentials and body to fetch', async () => {
    const ref = makeWebViewRef();
    const { onMessage } = setupFetchHandler(ref, { credentials: 'include' });
    onMessage(
      makeEvent({ ...validRequest, method: 'POST', headers: { 'X-A': '1' }, body: 'hello', bodyType: 'text' })
    );
    await tick();
    const init = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(init).toMatchObject({ method: 'POST', headers: { 'x-a': '1' }, body: 'hello', credentials: 'include' });
  });

  it('uses a custom fetch implementation', async () => {
    const customFetch = vi.fn().mockResolvedValue(new Response('custom'));
    const ref = makeWebViewRef();
    const { onMessage } = setupFetchHandler(ref, { fetch: customFetch });
    onMessage(makeEvent(validRequest));
    await tick();
    expect(customFetch).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(posted(ref)[0].body).toBe('custom');
  });

  describe('security', () => {
    it('blocks non-http(s) URLs by default', async () => {
      const ref = makeWebViewRef();
      const { onMessage } = setupFetchHandler(ref);
      onMessage(makeEvent({ ...validRequest, url: 'file:///data/user/secrets.db' }));
      await tick();
      expect(fetch).not.toHaveBeenCalled();
      expect(posted(ref)[0]).toMatchObject({ errorName: 'BlockedError', status: 0, ok: false });
    });

    it('enforces allowedUrls', async () => {
      const ref = makeWebViewRef();
      const { onMessage } = setupFetchHandler(ref, {
        allowedUrls: ['https://api.example.com/v1', /^https:\/\/cdn\.example\.com\//],
      });
      onMessage(makeEvent({ ...validRequest, id: 'a', url: 'https://api.example.com/v1/users' }));
      onMessage(makeEvent({ ...validRequest, id: 'b', url: 'https://cdn.example.com/x.png' }));
      onMessage(makeEvent({ ...validRequest, id: 'c', url: 'https://api.example.com/v1/../admin' }));
      onMessage(makeEvent({ ...validRequest, id: 'd', url: 'https://evil.com/?https://api.example.com/v1' }));
      await tick();
      const byId = Object.fromEntries(posted(ref).map((m) => [m.id, m]));
      expect(byId.a.ok).toBe(true);
      expect(byId.b.ok).toBe(true);
      expect(byId.c.errorName).toBe('BlockedError');
      expect(byId.d.errorName).toBe('BlockedError');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('enforces allowedOrigins against the sending page', async () => {
      const ref = makeWebViewRef();
      const { onMessage } = setupFetchHandler(ref, { allowedOrigins: ['https://my-app.com'] });
      onMessage(makeEvent({ ...validRequest, id: 'ok' }, 'https://my-app.com/dashboard'));
      onMessage(makeEvent({ ...validRequest, id: 'evil' }, 'https://evil.com/'));
      onMessage(makeEvent({ ...validRequest, id: 'unknown' }));
      await tick();
      const byId = Object.fromEntries(posted(ref).map((m) => [m.id, m]));
      expect(byId.ok.ok).toBe(true);
      expect(byId.evil.errorName).toBe('BlockedError');
      expect(byId.unknown.errorName).toBe('BlockedError');
    });

    it('accepts a predicate as allowedUrls', async () => {
      const ref = makeWebViewRef();
      const { onMessage } = setupFetchHandler(ref, { allowedUrls: (url) => url.endsWith('/data') });
      onMessage(makeEvent(validRequest));
      await tick();
      expect(posted(ref)[0].ok).toBe(true);
    });
  });

  describe('cancellation and timeouts', () => {
    it('FETCH_CANCEL aborts the request without answering', async () => {
      vi.stubGlobal('fetch', hangingFetch());
      const ref = makeWebViewRef();
      const { onMessage } = setupFetchHandler(ref);
      onMessage(makeEvent(validRequest));
      await tick(5);
      const signal = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].signal as AbortSignal;
      expect(onMessage(makeEvent({ type: 'FETCH_CANCEL', id: 'req-1' }))).toBe(true);
      expect(signal.aborted).toBe(true);
      await tick();
      expect(ref.current.postMessage).not.toHaveBeenCalled();
    });

    it('honours the per-request timeout and reports TimeoutError', async () => {
      vi.stubGlobal('fetch', hangingFetch());
      const ref = makeWebViewRef();
      const { onMessage } = setupFetchHandler(ref, { timeout: 10_000 });
      onMessage(makeEvent({ ...validRequest, timeout: 15 }));
      await tick(60);
      expect(posted(ref)[0]).toMatchObject({ errorName: 'TimeoutError', status: 0 });
    });

    it('caps the requested timeout with maxTimeout', async () => {
      vi.stubGlobal('fetch', hangingFetch());
      const ref = makeWebViewRef();
      const { onMessage } = setupFetchHandler(ref, { maxTimeout: 15 });
      onMessage(makeEvent({ ...validRequest, timeout: 0 }));
      await tick(60);
      expect(posted(ref)[0]).toMatchObject({ errorName: 'TimeoutError' });
    });

    it('teardown aborts in-flight requests and ignores later messages', async () => {
      vi.stubGlobal('fetch', hangingFetch());
      const ref = makeWebViewRef();
      const { onMessage, teardown } = setupFetchHandler(ref);
      onMessage(makeEvent(validRequest));
      await tick(5);
      const signal = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].signal as AbortSignal;
      expect(signal.aborted).toBe(false);
      teardown();
      expect(signal.aborted).toBe(true);
      onMessage(makeEvent({ ...validRequest, id: 'req-2' }));
      await tick();
      expect(fetch).toHaveBeenCalledOnce();
      expect(ref.current.postMessage).not.toHaveBeenCalled();
    });

    it('ignores a duplicate id while the first request is in flight', async () => {
      vi.stubGlobal('fetch', hangingFetch());
      const ref = makeWebViewRef();
      const { onMessage, teardown } = setupFetchHandler(ref);
      onMessage(makeEvent(validRequest));
      await tick(5);
      onMessage(makeEvent(validRequest));
      await tick(5);
      expect(fetch).toHaveBeenCalledOnce();
      teardown();
    });
  });

  describe('request bodies', () => {
    let capturedInit: RequestInit | undefined;
    beforeEach(() => {
      capturedInit = undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          capturedInit = init;
          return Promise.resolve(new Response('ok', { status: 200 }));
        })
      );
    });

    async function send(req: Partial<FetchRequestMessage>): Promise<void> {
      const { onMessage } = setupFetchHandler(makeWebViewRef());
      onMessage(makeEvent({ ...validRequest, method: 'POST', ...req }));
      await tick();
    }

    it('reconstructs FormData text fields and drops content-type', async () => {
      await send({
        headers: { 'Content-Type': 'multipart/form-data', Authorization: 'Bearer x' },
        bodyType: 'formdata',
        formDataEntries: [
          { name: 'username', value: 'alice' },
          { name: 'role', value: 'admin' },
        ],
      });
      const fd = capturedInit!.body as FormData;
      expect(fd).toBeInstanceOf(FormData);
      expect(fd.get('username')).toBe('alice');
      expect(fd.get('role')).toBe('admin');
      expect(capturedInit!.headers).toEqual({ authorization: 'Bearer x' });
    });

    it('reconstructs FormData file entries as Blobs', async () => {
      await send({
        bodyType: 'formdata',
        formDataEntries: [{ name: 'file', filename: 'test.txt', data: btoa('AB'), contentType: 'text/plain' }],
      });
      const entry = (capturedInit!.body as FormData).get('file') as File;
      expect(entry).toBeInstanceOf(Blob);
      expect(entry.type).toBe('text/plain');
      expect(entry.name).toBe('test.txt');
      expect(Array.from(new Uint8Array(await entry.arrayBuffer()))).toEqual([0x41, 0x42]);
    });

    it('uses { uri, name, type } file parts in React Native', async () => {
      vi.stubGlobal('navigator', { product: 'ReactNative' });
      const appended: unknown[] = [];
      const RNFormData = class {
        append(...args: unknown[]) {
          appended.push(args);
        }
      };
      vi.stubGlobal('FormData', RNFormData);
      await send({
        bodyType: 'formdata',
        formDataEntries: [{ name: 'file', filename: 'a.png', data: 'iVBORw==', contentType: 'image/png' }],
      });
      expect(appended).toEqual([['file', { uri: 'data:image/png;base64,iVBORw==', name: 'a.png', type: 'image/png' }]]);
    });

    it('reconstructs an ArrayBuffer from base64 bodies', async () => {
      await send({ body: btoa('\x89\x50\x4e\x47'), bodyType: 'base64' });
      expect(capturedInit!.body).toBeInstanceOf(ArrayBuffer);
      expect(Array.from(new Uint8Array(capturedInit!.body as ArrayBuffer))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    });
  });
});
