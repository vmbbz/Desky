import {
  parseCommerceCheckoutSession,
  parseCommerceCheckoutSessionRequest,
  parseCreateCommerceCheckoutRequest,
  type CommerceCheckoutSession,
  type CommerceCheckoutSessionRequest,
  type CreateCommerceCheckoutRequest,
} from '../../shared/commerce-checkout';
import {
  FetchCommerceApiTransport,
  type CommerceApiResponse,
  type CommerceApiTransport,
} from './service-client';

export interface CommerceCheckoutClientOptions {
  serviceOrigin: string;
  transport?: CommerceApiTransport;
  timeoutMs?: number;
  maximumResponseBytes?: number;
}

function normalizeOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Commerce checkout service origin is invalid.'); }
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) {
    throw new Error('Commerce checkout requires an exact HTTPS origin.');
  }
  return value;
}

function parseResponse(response: CommerceApiResponse, expectedUrl: string, maximum: number): unknown {
  if (response.finalUrl !== expectedUrl || response.status !== 200
    || !response.contentType?.toLowerCase().startsWith('application/json')
    || Buffer.byteLength(response.body, 'utf8') === 0
    || Buffer.byteLength(response.body, 'utf8') > maximum) {
    throw new Error('Commerce checkout service response is invalid.');
  }
  try { return JSON.parse(response.body) as unknown; } catch {
    throw new Error('Commerce checkout service returned invalid JSON.');
  }
}

export class CommerceCheckoutServiceClient {
  readonly serviceOrigin: string;
  private readonly transport: CommerceApiTransport;
  private readonly timeoutMs: number;
  private readonly maximumResponseBytes: number;

  constructor(options: CommerceCheckoutClientOptions) {
    this.serviceOrigin = normalizeOrigin(options.serviceOrigin);
    this.transport = options.transport ?? new FetchCommerceApiTransport();
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maximumResponseBytes = options.maximumResponseBytes ?? 64 * 1_024;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 30_000
      || !Number.isSafeInteger(this.maximumResponseBytes)
      || this.maximumResponseBytes < 1_024 || this.maximumResponseBytes > 256 * 1_024) {
      throw new Error('Commerce checkout client policy is invalid.');
    }
  }

  createSession(value: CreateCommerceCheckoutRequest, accessToken: string): Promise<CommerceCheckoutSession> {
    return this.post('/v1/checkout/session', parseCreateCommerceCheckoutRequest(value), accessToken);
  }

  getSession(value: CommerceCheckoutSessionRequest, accessToken: string): Promise<CommerceCheckoutSession> {
    return this.post('/v1/checkout/session/status', parseCommerceCheckoutSessionRequest(value), accessToken);
  }

  cancelSession(value: CommerceCheckoutSessionRequest, accessToken: string): Promise<CommerceCheckoutSession> {
    return this.post('/v1/checkout/session/cancel', parseCommerceCheckoutSessionRequest(value), accessToken);
  }

  private async post(
    path: '/v1/checkout/session' | '/v1/checkout/session/status' | '/v1/checkout/session/cancel',
    body: CreateCommerceCheckoutRequest | CommerceCheckoutSessionRequest,
    accessToken: string,
  ): Promise<CommerceCheckoutSession> {
    if (typeof accessToken !== 'string' || accessToken.length < 32 || accessToken.length > 8_192
      || /[\r\n]/.test(accessToken)) throw new Error('Commerce checkout access token is invalid.');
    const url = `${this.serviceOrigin}${path}`;
    const response = await this.transport.request({
      url, method: 'POST',
      headers: {
        accept: 'application/json', authorization: `Bearer ${accessToken}`,
        'cache-control': 'no-store', 'content-type': 'application/json',
        'x-desky-api-version': '1',
      },
      body: JSON.stringify(body), timeoutMs: this.timeoutMs,
    });
    const session = parseCommerceCheckoutSession(parseResponse(response, url, this.maximumResponseBytes));
    const checkoutUrl = new URL(session.checkoutUrl);
    if (checkoutUrl.origin !== this.serviceOrigin
      || checkoutUrl.pathname !== `/checkout/${encodeURIComponent(session.checkoutSessionId)}`) {
      throw new Error('Commerce checkout URL does not match its service session.');
    }
    return session;
  }
}
