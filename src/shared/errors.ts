export class FetchBridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchBridgeError';
  }
}

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

export class FetchBridgeNetworkError extends FetchBridgeError {
  constructor(message: string) {
    super(message);
    this.name = 'FetchBridgeNetworkError';
  }
}
