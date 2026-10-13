// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal hook runtime: enough to exercise mount/unmount semantics without a renderer.
const effects: Array<() => void | (() => void)> = [];
const cleanups: Array<() => void> = [];
vi.mock('react', () => ({
  useRef: (initial: unknown) => {
    const store = (globalThis as any).__refs ?? ((globalThis as any).__refs = []);
    const i = (globalThis as any).__refIndex++;
    if (!store[i]) store[i] = { current: initial };
    return store[i];
  },
  useEffect: (fn: () => void | (() => void)) => {
    effects.push(fn);
  },
  useCallback: (fn: unknown) => fn,
}));

const { useFetchHandler } = await import('../../src/native/useFetchHandler');

function render<T>(hook: () => T): T {
  (globalThis as any).__refIndex = 0;
  return hook();
}

function flushEffects(): void {
  for (const fn of effects.splice(0)) {
    const cleanup = fn();
    if (cleanup) cleanups.push(cleanup);
  }
}

const event = (id: string) => ({
  nativeEvent: {
    data: JSON.stringify({ type: 'FETCH_REQUEST', id, url: 'https://a.com', method: 'GET', headers: {}, body: null }),
  },
});

describe('useFetchHandler', () => {
  beforeEach(() => {
    (globalThis as any).__refs = [];
    effects.length = 0;
    cleanups.length = 0;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')));
  });

  it('handles messages after mount and stops after unmount', async () => {
    const ref = { current: { postMessage: vi.fn() } };
    const onMessage = render(() => useFetchHandler(ref));
    expect(onMessage(event('before'))).toBe(false);
    flushEffects();
    expect(onMessage(event('1'))).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(ref.current.postMessage).toHaveBeenCalledOnce();

    cleanups.splice(0).forEach((c) => c());
    expect(onMessage(event('2'))).toBe(false);
  });

  it('survives StrictMode mount → unmount → mount', () => {
    const ref = { current: { postMessage: vi.fn() } };
    const onMessage = render(() => useFetchHandler(ref));
    flushEffects();
    cleanups.splice(0).forEach((c) => c());
    render(() => useFetchHandler(ref));
    flushEffects();
    expect(onMessage(event('x'))).toBe(true);
  });

  it('always uses the latest options', async () => {
    const ref = { current: { postMessage: vi.fn() } };
    const onMessage = render(() => useFetchHandler(ref, { allowedUrls: ['https://other.com'] }));
    flushEffects();
    render(() => useFetchHandler(ref, { allowedUrls: ['https://a.com'] }));
    onMessage(event('y'));
    await new Promise((r) => setTimeout(r, 10));
    expect(JSON.parse(ref.current.postMessage.mock.calls[0][0]).ok).toBe(true);
  });
});
