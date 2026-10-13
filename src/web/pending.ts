import type { FetchResponseMessage } from '../shared/protocol';
import { FetchBridgeTimeoutError, FetchBridgeError } from '../shared/errors';

interface PendingEntry {
  resolve: (msg: FetchResponseMessage) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** Correlates outgoing requests with incoming responses by id, with optional timeouts. */
export class PendingRequestMap {
  private map = new Map<string, PendingEntry>();

  get size(): number {
    return this.map.size;
  }

  has(id: string): boolean {
    return this.map.has(id);
  }

  /**
   * @param timeoutMs `0`, negative or non-finite values disable the timeout.
   * @param onTimeout Called after the entry is rejected because of the timeout.
   */
  add(
    id: string,
    resolve: (msg: FetchResponseMessage) => void,
    reject: (reason: Error) => void,
    timeoutMs: number,
    onTimeout?: () => void
  ): void {
    const timer =
      timeoutMs > 0 && Number.isFinite(timeoutMs)
        ? setTimeout(() => {
            if (this.map.delete(id)) {
              reject(new FetchBridgeTimeoutError(id, timeoutMs));
              onTimeout?.();
            }
          }, timeoutMs)
        : undefined;
    this.map.set(id, { resolve, reject, timer });
  }

  resolve(id: string, msg: FetchResponseMessage): void {
    const entry = this.take(id);
    entry?.resolve(msg);
  }

  reject(id: string, reason: Error): void {
    const entry = this.take(id);
    entry?.reject(reason);
  }

  /** Rejects every pending entry and returns their ids. */
  clear(): string[] {
    const ids = Array.from(this.map.keys());
    const err = new FetchBridgeError('fetchBridge: torn down');
    for (const entry of this.map.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.map.clear();
    return ids;
  }

  private take(id: string): PendingEntry | undefined {
    const entry = this.map.get(id);
    if (!entry) return undefined;
    clearTimeout(entry.timer);
    this.map.delete(id);
    return entry;
  }
}
