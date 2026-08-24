import {
  parseCleanDeviceRestoreRequest,
  parseCommerceSessionMaterial,
  parseCommerceSessionRefreshRequest,
  type CleanDeviceRestoreRequest,
  type CommerceSessionMaterial,
  type CommerceSessionRefreshRequest,
} from '../../shared/commerce-recovery';

export interface CommerceApiRequest {
  url: string;
  method: 'POST';
  headers: Readonly<Record<string, string>>;
  body: string;
  timeoutMs: number;
}

export interface CommerceApiResponse {
  status: number;
  finalUrl: string;
  contentType: string | null;
  body: string;
}

export interface CommerceApiTransport {
  request(input: CommerceApiRequest): Promise<CommerceApiResponse>;
}

export class FetchCommerceApiTransport implements CommerceApiTransport {
  async request(input: CommerceApiRequest): Promise<CommerceApiResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const response = await fetch(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
      });
      const body = await response.text();
      return {
        status: response.status,
        finalUrl: response.url,
        contentType: response.headers.get('content-type'),
        body,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export interface CommerceServiceClientOptions {
  serviceOrigin: string;
  transport?: CommerceApiTransport;
  timeoutMs?: number;
  maximumResponseBytes?: number;
}

function normalizeServiceOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Commerce service origin is invalid.');
  }
  if (url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Commerce service requires an HTTPS origin without credentials or a path.');
  }
  return url.origin;
}

function parseJsonResponse(response: CommerceApiResponse, expectedUrl: string, maximumBytes: number): unknown {
  if (response.finalUrl !== expectedUrl) throw new Error('Commerce service response URL mismatch.');
  if (response.status !== 200) throw new Error(`Commerce service request failed with status ${response.status}.`);
  if (!response.contentType?.toLowerCase().startsWith('application/json')) {
    throw new Error('Commerce service response content type is invalid.');
  }
  if (Buffer.byteLength(response.body, 'utf8') === 0
    || Buffer.byteLength(response.body, 'utf8') > maximumBytes) {
    throw new Error('Commerce service response size is invalid.');
  }
  try {
    return JSON.parse(response.body) as unknown;
  } catch {
    throw new Error('Commerce service returned invalid JSON.');
  }
}

export class CommerceServiceClient {
  readonly serviceOrigin: string;
  private readonly transport: CommerceApiTransport;
  private readonly timeoutMs: number;
  private readonly maximumResponseBytes: number;

  constructor(options: CommerceServiceClientOptions) {
    this.serviceOrigin = normalizeServiceOrigin(options.serviceOrigin);
    this.transport = options.transport ?? new FetchCommerceApiTransport();
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maximumResponseBytes = options.maximumResponseBytes ?? 256 * 1_024;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 30_000
      || !Number.isSafeInteger(this.maximumResponseBytes)
      || this.maximumResponseBytes < 1_024
      || this.maximumResponseBytes > 1024 * 1_024) {
      throw new Error('Commerce service client policy is invalid.');
    }
  }

  async restoreCleanDevice(value: CleanDeviceRestoreRequest): Promise<CommerceSessionMaterial> {
    return this.post('/v1/session/restore', parseCleanDeviceRestoreRequest(value));
  }

  async refreshSession(value: CommerceSessionRefreshRequest): Promise<CommerceSessionMaterial> {
    return this.post('/v1/session/refresh', parseCommerceSessionRefreshRequest(value));
  }

  private async post(
    path: '/v1/session/restore' | '/v1/session/refresh',
    body: CleanDeviceRestoreRequest | CommerceSessionRefreshRequest,
  ): Promise<CommerceSessionMaterial> {
    const url = `${this.serviceOrigin}${path}`;
    const response = await this.transport.request({
      url,
      method: 'POST',
      headers: {
        accept: 'application/json',
        'cache-control': 'no-store',
        'content-type': 'application/json',
        'x-desky-api-version': '1',
      },
      body: JSON.stringify(body),
      timeoutMs: this.timeoutMs,
    });
    return parseCommerceSessionMaterial(parseJsonResponse(response, url, this.maximumResponseBytes));
  }
}
