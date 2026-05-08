import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isReactNativeWebView } from '../../src/web/detect';

describe('isReactNativeWebView', () => {
  beforeEach(() => {
    delete (window as any).ReactNativeWebView;
    delete (window as any).__isReactNativeWebView;
  });

  afterEach(() => {
    delete (window as any).ReactNativeWebView;
    delete (window as any).__isReactNativeWebView;
  });

  it('returns false in normal browser context', () => {
    expect(isReactNativeWebView()).toBe(false);
  });

  it('returns true when ReactNativeWebView is present', () => {
    (window as any).ReactNativeWebView = { postMessage: () => {} };
    expect(isReactNativeWebView()).toBe(true);
  });

  it('returns true when __isReactNativeWebView flag is set', () => {
    (window as any).__isReactNativeWebView = true;
    expect(isReactNativeWebView()).toBe(true);
  });
});
