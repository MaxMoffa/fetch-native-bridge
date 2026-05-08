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
