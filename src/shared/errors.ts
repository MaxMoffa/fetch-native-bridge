// A brand instead of `instanceof FetchBridgeError` so that network errors can extend
// `TypeError` (what `fetch` rejects with) and still be recognised as bridge errors.
const BRAND = '__fetchBridgeError';

function brand(err: Error): void {
  Object.defineProperty(err, BRAND, { value: true });
}

/** Base class for bridge-specific errors (protocol, teardown). */
export class FetchBridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchBridgeError';
    brand(this);
  }
}

/** The request did not complete within its timeout (web- or native-side). */
export class FetchBridgeTimeoutError extends FetchBridgeError {
  readonly requestId: string;
  readonly timeoutMs: number;

  constructor(requestId: string, timeoutMs: number) {
    super(`fetchBridge: request ${requestId} timed out after ${timeoutMs}ms`);
    this.name = 'FetchBridgeTimeoutError';
    this.requestId = requestId;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * The native request failed (DNS, TLS, offline…). Extends `TypeError`, exactly like the
 * error thrown by `fetch`, so existing `catch (e) { if (e instanceof TypeError) … }`
 * code keeps working.
 */
export class FetchBridgeNetworkError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'FetchBridgeNetworkError';
    brand(this);
  }
}

/** The native handler refused the request (URL or page origin not allowed). */
export class FetchBridgeBlockedError extends FetchBridgeNetworkError {
  constructor(message: string) {
    super(message);
    this.name = 'FetchBridgeBlockedError';
  }
}

export function isFetchBridgeError(err: unknown): err is FetchBridgeError | FetchBridgeNetworkError {
  return typeof err === 'object' && err !== null && (err as Record<string, unknown>)[BRAND] === true;
}

export function isFetchBridgeTimeoutError(err: unknown): err is FetchBridgeTimeoutError {
  return err instanceof FetchBridgeTimeoutError;
}

/** Creates the same error `fetch` rejects with when aborted. */
export function createAbortError(message = 'The operation was aborted.'): Error {
  try {
    return new DOMException(message, 'AbortError');
  } catch {
    const err = new Error(message);
    err.name = 'AbortError';
    return err;
  }
}
