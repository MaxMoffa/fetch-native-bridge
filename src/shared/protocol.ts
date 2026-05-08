export interface FetchRequestMessage {
  type: 'FETCH_REQUEST';
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface FetchResponseMessage {
  type: 'FETCH_RESPONSE';
  id: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyEncoding: 'text' | 'base64';
  ok: boolean;
  error?: string;
}

export interface FetchBridgeOptions extends RequestInit {
  timeout?: number;
}

export interface SetupFetchHandlerOptions {
  timeout?: number;
  onFetch?: (req: FetchRequestMessage, res: Response) => boolean | Promise<boolean>;
}

export function isFetchRequestMessage(m: unknown): m is FetchRequestMessage {
  return (
    typeof m === 'object' &&
    m !== null &&
    (m as FetchRequestMessage).type === 'FETCH_REQUEST' &&
    typeof (m as FetchRequestMessage).id === 'string' &&
    typeof (m as FetchRequestMessage).url === 'string'
  );
}

export function isFetchResponseMessage(m: unknown): m is FetchResponseMessage {
  return (
    typeof m === 'object' &&
    m !== null &&
    (m as FetchResponseMessage).type === 'FETCH_RESPONSE' &&
    typeof (m as FetchResponseMessage).id === 'string' &&
    typeof (m as FetchResponseMessage).status === 'number'
  );
}
