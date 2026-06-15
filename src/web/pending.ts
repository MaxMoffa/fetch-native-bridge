import type { FetchResponseMessage } from '../shared/protocol';

interface PendingEntry {
  resolve: (msg: FetchResponseMessage) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class PendingRequestMap {
  private map = new Map<string, PendingEntry>();

  add(
    id: string,
    resolve: (msg: FetchResponseMessage) => void,
    reject: (reason: Error) => void,
    timeoutMs: number
  ): void {
    const timer = setTimeout(() => {
      if (this.map.has(id)) {
        this.map.delete(id);
        reject(new Error(`fetchBridge: request ${id} timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);
    this.map.set(id, { resolve, reject, timer });
  }

  resolve(id: string, msg: FetchResponseMessage): void {
    const entry = this.map.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.map.delete(id);
    entry.resolve(msg);
  }

  reject(id: string, reason: Error): void {
    const entry = this.map.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.map.delete(id);
    entry.reject(reason);
  }

  clear(): void {
    const err = new Error('fetchBridge: torn down');
    for (const entry of this.map.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.map.clear();
  }
}
