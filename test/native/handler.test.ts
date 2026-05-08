// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupFetchHandler } from '../../src/native/handler';
import type { WebViewRef, WebViewMessageEvent } from '../../src/types/react-native';
import type { FetchRequestMessage } from '../../src/shared/protocol';

function makeWebViewRef(): WebViewRef {
  return { current: { postMessage: vi.fn(), injectJavaScript: vi.fn() } };
}

function makeEvent(data: unknown): WebViewMessageEvent {
  return { nativeEvent: { data: JSON.stringify(data) } };
}

const validRequest: FetchRequestMessage = {
  type: 'FETCH_REQUEST',
  id: 'req-1',
  url: 'https://api.example.com/data',
  method: 'GET',
  headers: {},
  body: null,
};

describe('setupFetchHandler', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('{"result":true}', {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
      })
    ));
  });

  it('ignores non-FETCH_REQUEST messages', async () => {
    const ref = makeWebViewRef();
    const { onMessage } = setupFetchHandler(ref);
    onMessage(makeEvent({ type: 'OTHER', id: 'x' }));
    await new Promise((r) => setTimeout(r, 10));
    expect(ref.current!.postMessage).not.toHaveBeenCalled();
  });

  it('ignores invalid JSON', async () => {
    const ref = makeWebViewRef();
    const { onMessage } = setupFetchHandler(ref);
    onMessage({ nativeEvent: { data: 'not-json' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(ref.current!.postMessage).not.toHaveBeenCalled();
  });

  it('fetches and posts FETCH_RESPONSE back', async () => {
    const ref = makeWebViewRef();
    const { onMessage } = setupFetchHandler(ref);
    onMessage(makeEvent(validRequest));
    await new Promise((r) => setTimeout(r, 50));

    expect(ref.current!.postMessage).toHaveBeenCalledOnce();
    const msg = JSON.parse((ref.current!.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(msg.type).toBe('FETCH_RESPONSE');
    expect(msg.id).toBe('req-1');
    expect(msg.status).toBe(200);
    expect(msg.ok).toBe(true);
  });

  it('posts error response on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('DNS failure')));
    const ref = makeWebViewRef();
    const { onMessage } = setupFetchHandler(ref);
    onMessage(makeEvent(validRequest));
    await new Promise((r) => setTimeout(r, 50));

    const msg = JSON.parse((ref.current!.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(msg.error).toBe('DNS failure');
    expect(msg.ok).toBe(false);
  });

  it('onFetch returning false suppresses postMessage', async () => {
    const ref = makeWebViewRef();
    const onFetch = vi.fn().mockResolvedValue(false);
    const { onMessage } = setupFetchHandler(ref, { onFetch });
    onMessage(makeEvent(validRequest));
    await new Promise((r) => setTimeout(r, 50));

    expect(ref.current!.postMessage).not.toHaveBeenCalled();
    expect(onFetch).toHaveBeenCalledOnce();
  });

  it('onFetch returning true allows postMessage', async () => {
    const ref = makeWebViewRef();
    const onFetch = vi.fn().mockResolvedValue(true);
    const { onMessage } = setupFetchHandler(ref, { onFetch });
    onMessage(makeEvent(validRequest));
    await new Promise((r) => setTimeout(r, 50));

    expect(ref.current!.postMessage).toHaveBeenCalledOnce();
  });

  it('teardown aborts in-flight requests', async () => {
    let capturedSignal: AbortSignal | null | undefined;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedSignal = init.signal;
      return new Promise(() => {}); // never resolves
    }));

    const ref = makeWebViewRef();
    const { onMessage, teardown } = setupFetchHandler(ref);
    onMessage(makeEvent(validRequest));
    await new Promise((r) => setTimeout(r, 10));

    expect(capturedSignal!.aborted).toBe(false);
    teardown();
    expect(capturedSignal!.aborted).toBe(true);
  });
});
