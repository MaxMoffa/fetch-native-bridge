import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PendingRequestMap } from '../../src/web/pending';
import type { FetchResponseMessage } from '../../src/shared/protocol';

const mockResponse: FetchResponseMessage = {
  type: 'FETCH_RESPONSE',
  id: 'test-id',
  status: 200,
  statusText: 'OK',
  headers: {},
  body: 'hello',
  bodyEncoding: 'text',
  ok: true,
};

describe('PendingRequestMap', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('resolve() settles the promise with the message', async () => {
    const map = new PendingRequestMap();
    const promise = new Promise<FetchResponseMessage>((resolve, reject) => {
      map.add('test-id', resolve, reject, 5000);
    });
    map.resolve('test-id', mockResponse);
    await expect(promise).resolves.toEqual(mockResponse);
  });

  it('timeout triggers rejection', async () => {
    const map = new PendingRequestMap();
    const promise = new Promise<FetchResponseMessage>((resolve, reject) => {
      map.add('test-id', resolve, reject, 1000);
    });
    vi.advanceTimersByTime(1001);
    await expect(promise).rejects.toThrow('timed out');
  });

  it('reject() rejects the promise', async () => {
    const map = new PendingRequestMap();
    const promise = new Promise<FetchResponseMessage>((resolve, reject) => {
      map.add('test-id', resolve, reject, 5000);
    });
    map.reject('test-id', new Error('network fail'));
    await expect(promise).rejects.toThrow('network fail');
  });

  it('resolve with unknown id is a no-op', () => {
    const map = new PendingRequestMap();
    expect(() => map.resolve('unknown', mockResponse)).not.toThrow();
  });

  it('clear() rejects all pending entries', async () => {
    const map = new PendingRequestMap();
    const p1 = new Promise<FetchResponseMessage>((res, rej) => map.add('a', res, rej, 5000));
    const p2 = new Promise<FetchResponseMessage>((res, rej) => map.add('b', res, rej, 5000));
    map.clear();
    await expect(p1).rejects.toThrow('torn down');
    await expect(p2).rejects.toThrow('torn down');
  });
});

describe('PendingRequestMap — extras', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('calls onTimeout after rejecting', async () => {
    const map = new PendingRequestMap();
    const onTimeout = vi.fn();
    const promise = new Promise((res, rej) => map.add('t', res, rej, 100, onTimeout));
    vi.advanceTimersByTime(101);
    await expect(promise).rejects.toThrow('timed out');
    expect(onTimeout).toHaveBeenCalledOnce();
    expect(map.has('t')).toBe(false);
  });

  it('a timeout of 0 never fires', () => {
    const map = new PendingRequestMap();
    const reject = vi.fn();
    map.add('t', vi.fn(), reject, 0);
    vi.advanceTimersByTime(1e9);
    expect(reject).not.toHaveBeenCalled();
    expect(map.size).toBe(1);
  });

  it('clear() returns the ids it rejected', () => {
    const map = new PendingRequestMap();
    map.add('a', vi.fn(), vi.fn(), 1000);
    map.add('b', vi.fn(), vi.fn(), 1000);
    expect(map.clear()).toEqual(['a', 'b']);
    expect(map.size).toBe(0);
  });
});
