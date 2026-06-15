export type FormDataEntry =
  | { name: string; value: string }
  | { name: string; filename: string; data: string; contentType: string };

export interface FetchRequestMessage {
  type: 'FETCH_REQUEST';
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  bodyType?: 'text' | 'formdata' | 'base64';
  formDataEntries?: FormDataEntry[];
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

export const PROTOCOL_VERSION = '1' as const;

export interface FetchBridgeOptions extends RequestInit {
  timeout?: number;
}

export interface SetupFetchHandlerOptions {
  timeout?: number;
  credentials?: RequestCredentials;
  /** When true, binary response bodies are serialized and sent back to the WebView. Default: false. */
  sendBinaryBody?: boolean;
  /**
   * Intercept each request before the response is sent back to the WebView.
   * Return `false` to suppress sending the response (e.g., for caching or logging).
   */
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
