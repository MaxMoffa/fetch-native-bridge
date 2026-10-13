export { setupFetchHandler } from './handler';
export type { SetupFetchHandlerOptions, FetchHandler } from './handler';
export { useFetchHandler } from './useFetchHandler';
export { serializeResponse, isBinaryContentType } from './response';
export type { UrlMatcher, UrlPattern } from './url';
export { blobToBase64 } from '../shared/base64';
export {
  FetchBridgeError,
  FetchBridgeTimeoutError,
  FetchBridgeNetworkError,
  FetchBridgeBlockedError,
  isFetchBridgeError,
  isFetchBridgeTimeoutError,
} from '../shared/errors';
export { PROTOCOL_VERSION } from '../shared/protocol';
export type {
  FetchRequestMessage,
  FetchResponseMessage,
  FetchCancelMessage,
  FetchErrorName,
  FormDataEntry,
} from '../shared/protocol';
export type { WebViewRef, WebViewMessageEvent } from '../types/react-native';
