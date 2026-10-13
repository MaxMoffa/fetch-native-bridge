export function isReactNative(): boolean {
  return typeof navigator !== 'undefined' && navigator.product === 'ReactNative';
}

export function isDev(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

declare const __DEV__: boolean | undefined;
