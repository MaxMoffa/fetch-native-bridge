import { describe, it, expect } from 'vitest';
import {
  isFetchCancelMessage,
  isFetchRequestMessage,
  isFetchResponseMessage,
  parseMessage,
} from '../../src/shared/protocol';

const request = { type: 'FETCH_REQUEST', id: 'abc', url: 'https://x.com', method: 'GET', headers: {}, body: null };
const response = {
  type: 'FETCH_RESPONSE',
  id: 'abc',
  status: 200,
  statusText: 'OK',
  headers: {},
  body: '',
  bodyEncoding: 'text',
  ok: true,
};

describe('isFetchRequestMessage', () => {
  it('accepts valid messages', () => {
    expect(isFetchRequestMessage(request)).toBe(true);
    expect(
      isFetchRequestMessage({
        ...request,
        bodyType: 'formdata',
        formDataEntries: [{ name: 'a', value: 'b' }, { name: 'f', filename: 'f', data: '', contentType: 'x/y' }],
        timeout: 0,
      })
    ).toBe(true);
  });

  it.each([
    ['wrong type', { ...request, type: 'FETCH_RESPONSE' }],
    ['null', null],
    ['array', [request]],
    ['missing id', { ...request, id: undefined }],
    ['empty id', { ...request, id: '' }],
    ['non-string header', { ...request, headers: { a: 1 } }],
    ['non-string body', { ...request, body: 42 }],
    ['unknown bodyType', { ...request, bodyType: 'stream' }],
    ['bad formDataEntries', { ...request, formDataEntries: [{ name: 'x' }] }],
    ['negative timeout', { ...request, timeout: -1 }],
    ['NaN timeout', { ...request, timeout: NaN }],
  ])('rejects %s', (_label, msg) => {
    expect(isFetchRequestMessage(msg)).toBe(false);
  });
});

describe('isFetchResponseMessage', () => {
  it('accepts valid messages', () => {
    expect(isFetchResponseMessage(response)).toBe(true);
  });

  it('rejects invalid messages', () => {
    expect(isFetchResponseMessage({ ...response, type: 'FETCH_REQUEST' })).toBe(false);
    expect(isFetchResponseMessage({ ...response, status: '200' })).toBe(false);
    expect(isFetchResponseMessage({ ...response, headers: { a: 1 } })).toBe(false);
    expect(isFetchResponseMessage(null)).toBe(false);
  });
});

describe('isFetchCancelMessage', () => {
  it('validates cancel messages', () => {
    expect(isFetchCancelMessage({ type: 'FETCH_CANCEL', id: 'a' })).toBe(true);
    expect(isFetchCancelMessage({ type: 'FETCH_CANCEL' })).toBe(false);
  });
});

describe('parseMessage', () => {
  it('parses JSON objects and ignores everything else', () => {
    expect(parseMessage('{"a":1}')).toEqual({ a: 1 });
    expect(parseMessage('{broken')).toBeUndefined();
    expect(parseMessage('hello')).toBeUndefined();
    expect(parseMessage({ a: 1 })).toBeUndefined();
  });
});
