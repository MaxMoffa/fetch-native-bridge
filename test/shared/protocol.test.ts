import { describe, it, expect } from 'vitest';
import { isFetchRequestMessage, isFetchResponseMessage } from '../../src/shared/protocol';

describe('isFetchRequestMessage', () => {
  it('returns true for valid message', () => {
    expect(
      isFetchRequestMessage({ type: 'FETCH_REQUEST', id: 'abc', url: 'https://x.com', method: 'GET', headers: {}, body: null })
    ).toBe(true);
  });

  it('returns false for wrong type', () => {
    expect(isFetchRequestMessage({ type: 'FETCH_RESPONSE', id: 'abc', url: 'https://x.com', method: 'GET', headers: {}, body: null })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isFetchRequestMessage(null)).toBe(false);
  });

  it('returns false for missing id', () => {
    expect(isFetchRequestMessage({ type: 'FETCH_REQUEST', url: 'https://x.com', method: 'GET', headers: {}, body: null })).toBe(false);
  });
});

describe('isFetchResponseMessage', () => {
  it('returns true for valid message', () => {
    expect(
      isFetchResponseMessage({ type: 'FETCH_RESPONSE', id: 'abc', status: 200, statusText: 'OK', headers: {}, body: '', bodyEncoding: 'text', ok: true })
    ).toBe(true);
  });

  it('returns false for wrong type', () => {
    expect(isFetchResponseMessage({ type: 'FETCH_REQUEST', id: 'abc', status: 200, statusText: 'OK', headers: {}, body: '', bodyEncoding: 'text', ok: true })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isFetchResponseMessage(null)).toBe(false);
  });
});
