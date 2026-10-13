import { describe, it, expect } from 'vitest';
import { isHttpUrl, matchesUrl, parseUrl } from '../../src/native/url';

describe('parseUrl', () => {
  it('normalises scheme, host, default ports and credentials', () => {
    expect(parseUrl('HTTPS://User:Pw@API.Example.com:443/a/b?q#h')).toEqual({
      origin: 'https://api.example.com',
      path: '/a/b',
    });
    expect(parseUrl('http://localhost:8080')).toEqual({ origin: 'http://localhost:8080', path: '/' });
  });

  it('resolves dot segments, encoded dots and backslashes', () => {
    expect(parseUrl('https://x.com/v1/../admin')!.path).toBe('/admin');
    expect(parseUrl('https://x.com/v1/%2e%2e/admin')!.path).toBe('/admin');
    expect(parseUrl('https://x.com/v1\\..\\admin')!.path).toBe('/admin');
    expect(parseUrl('https://x.com/a/./b/..')!.path).toBe('/a/');
  });

  it('rejects non-hierarchical or host-less URLs', () => {
    expect(parseUrl('data:text/plain,hi')).toBeNull();
    expect(parseUrl('/relative')).toBeNull();
    expect(parseUrl('file:///etc/passwd')).toBeNull();
  });
});

describe('matchesUrl', () => {
  const patterns = ['https://api.example.com/v1', 'https://cdn.example.com'];

  it('matches origin and path prefix on segment boundaries', () => {
    expect(matchesUrl('https://api.example.com/v1', patterns)).toBe(true);
    expect(matchesUrl('https://api.example.com/v1/users?x=1', patterns)).toBe(true);
    expect(matchesUrl('https://api.example.com/v10', patterns)).toBe(false);
    expect(matchesUrl('https://api.example.com/v2', patterns)).toBe(false);
    expect(matchesUrl('https://cdn.example.com/any/thing', patterns)).toBe(true);
  });

  it('does not match look-alike hosts or schemes', () => {
    expect(matchesUrl('https://api.example.com.evil.com/v1', patterns)).toBe(false);
    expect(matchesUrl('https://api.example.com@evil.com/v1', patterns)).toBe(false);
    expect(matchesUrl('http://api.example.com/v1', patterns)).toBe(false);
    expect(matchesUrl('https://api.example.com/v1/../admin', patterns)).toBe(false);
  });

  it('supports RegExp (including global flags) and predicates', () => {
    const re = /^https:\/\/img\./g;
    expect(matchesUrl('https://img.x.com/a', [re])).toBe(true);
    expect(matchesUrl('https://img.x.com/a', [re])).toBe(true);
    expect(matchesUrl('https://x.com', (u) => u.includes('x.com'))).toBe(true);
    expect(matchesUrl('not a url', patterns)).toBe(false);
  });
});

describe('isHttpUrl', () => {
  it('only accepts http(s) URLs with a host', () => {
    expect(isHttpUrl('https://a.com')).toBe(true);
    expect(isHttpUrl('HTTP://a.com/x')).toBe(true);
    expect(isHttpUrl('file:///x')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('https:///nohost')).toBe(false);
  });
});
