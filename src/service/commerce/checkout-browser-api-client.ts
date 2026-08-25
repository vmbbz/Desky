import {
  parseCommerceBrowserCheckoutView,
  parseCommerceBrowserSecret,
  type CommerceBrowserCheckoutView,
} from '../../shared/commerce-checkout-browser';
import {
  parseCommerceCheckoutSession,
  type CommerceCheckoutSession,
} from '../../shared/commerce-checkout';
import {
  parseX402PaymentRequirements,
  type X402PaymentRequirements,
  type X402ResourceInfo,
} from './x402-base-sepolia';
import {
  readCheckoutHandoffVerifier,
  signBaseSepoliaCheckout,
  type Eip1193Provider,
} from './checkout-browser-wallet-client';

export interface CheckoutBrowserApiMaterial {
  schemaVersion: 1;
  session: CommerceCheckoutSession;
  csrfToken: string;
  view: CommerceBrowserCheckoutView;
  paymentRequirements: X402PaymentRequirements;
  resource: X402ResourceInfo;
}

type CheckoutFetch = (input: string, init: RequestInit) => Promise<Response>;
const identifierPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

function exactRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Hosted checkout response is invalid.');
  }
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((field) => !fields.includes(field))) {
    throw new Error('Hosted checkout response is invalid.');
  }
  return source;
}

function parseResource(value: unknown, origin: string, quoteId: string): X402ResourceInfo {
  const source = exactRecord(value, ['url', 'description', 'mimeType']);
  const expectedUrl = `${origin}/v1/x402/quotes/${encodeURIComponent(quoteId)}`;
  if (source.url !== expectedUrl || source.description !== 'Desky avatar entitlement'
    || source.mimeType !== 'application/json') {
    throw new Error('Hosted checkout resource is invalid.');
  }
  return { url: expectedUrl, description: 'Desky avatar entitlement', mimeType: 'application/json' };
}

function parseMaterial(value: unknown, origin: string): CheckoutBrowserApiMaterial {
  const source = exactRecord(value, [
    'schemaVersion', 'session', 'csrfToken', 'view', 'paymentRequirements', 'resource',
  ]);
  if (source.schemaVersion !== 1) throw new Error('Hosted checkout response is invalid.');
  const session = parseCommerceCheckoutSession(source.session);
  const view = parseCommerceBrowserCheckoutView(source.view);
  const paymentRequirements = parseX402PaymentRequirements(source.paymentRequirements);
  if (view.checkoutSessionId !== session.checkoutSessionId
    || view.expiresAt !== session.expiresAt
    || view.amountAtomic !== paymentRequirements.amount
    || view.network !== paymentRequirements.network
    || view.asset.toLowerCase() !== paymentRequirements.asset.toLowerCase()
    || view.recipient.toLowerCase() !== paymentRequirements.payTo.toLowerCase()) {
    throw new Error('Hosted checkout response crossed identity.');
  }
  return {
    schemaVersion: 1,
    session,
    csrfToken: parseCommerceBrowserSecret(source.csrfToken, 'response CSRF token'),
    view,
    paymentRequirements,
    resource: parseResource(source.resource, origin, session.quoteId),
  };
}

export function checkoutSessionIdFromUrl(urlValue: string, origin: string): string {
  const url = new URL(urlValue);
  if (url.origin !== origin || url.search || !url.pathname.startsWith('/checkout/')) {
    throw new Error('Hosted checkout page URL is invalid.');
  }
  let sessionId: string;
  try { sessionId = decodeURIComponent(url.pathname.slice('/checkout/'.length)); } catch {
    throw new Error('Hosted checkout page URL is invalid.');
  }
  if (!identifierPattern.test(sessionId)
    || url.pathname !== `/checkout/${encodeURIComponent(sessionId)}`) {
    throw new Error('Hosted checkout page URL is invalid.');
  }
  return sessionId;
}

/** Same-origin client state for a separately deployed checkout page. Signing is explicit only. */
export class CheckoutBrowserApiClient {
  private readonly origin: string;
  private material?: CheckoutBrowserApiMaterial;

  constructor(
    originValue: string,
    private readonly fetchImpl: CheckoutFetch = fetch,
  ) {
    const origin = new URL(originValue);
    if (origin.protocol !== 'https:' || origin.origin !== originValue) {
      throw new Error('Hosted checkout page requires an exact HTTPS origin.');
    }
    this.origin = originValue;
  }

  async bootstrapFromUrl(urlValue: string): Promise<CheckoutBrowserApiMaterial> {
    const checkoutSessionId = checkoutSessionIdFromUrl(urlValue, this.origin);
    const bindingVerifier = readCheckoutHandoffVerifier(urlValue);
    const cleanUrl = new URL(urlValue);
    cleanUrl.hash = '';
    if (typeof globalThis.history !== 'undefined') {
      globalThis.history.replaceState(null, '', cleanUrl.toString());
    }
    this.material = await this.post('/v1/browser/bootstrap', {
      schemaVersion: 1, checkoutSessionId, bindingVerifier,
    });
    return structuredClone(this.material);
  }

  async resume(checkoutSessionId: string): Promise<CheckoutBrowserApiMaterial> {
    this.material = await this.post('/v1/browser/resume', {
      schemaVersion: 1, checkoutSessionId,
    });
    return structuredClone(this.material);
  }

  async signAndSubmit(input: {
    provider: Eip1193Provider;
    submissionId: string;
    nowSeconds: number;
    random?: (bytes: Uint8Array) => Uint8Array;
  }): Promise<CheckoutBrowserApiMaterial> {
    const current = this.material;
    if (!current || !identifierPattern.test(input.submissionId)) {
      throw new Error('Hosted checkout must be loaded before explicit wallet submission.');
    }
    const paymentPayload = await signBaseSepoliaCheckout({
      provider: input.provider,
      paymentRequirements: current.paymentRequirements,
      resource: current.resource,
      nowSeconds: input.nowSeconds,
      expiresAtSeconds: Math.floor(Date.parse(current.session.expiresAt) / 1_000),
      random: input.random,
    });
    this.material = await this.post('/v1/browser/submit', {
      schemaVersion: 1,
      checkoutSessionId: current.session.checkoutSessionId,
      submissionId: input.submissionId,
      paymentPayload,
    }, current.csrfToken);
    return structuredClone(this.material);
  }

  private async post(
    path: '/v1/browser/bootstrap' | '/v1/browser/resume' | '/v1/browser/submit',
    body: Record<string, unknown>,
    csrfToken?: string,
  ): Promise<CheckoutBrowserApiMaterial> {
    const url = `${this.origin}${path}`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'include',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'X-Desky-CSRF': csrfToken } : {}),
      },
      body: JSON.stringify(body),
    });
    if (response.url !== url || response.status !== 200
      || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      throw new Error('Hosted checkout request failed.');
    }
    const text = await response.text();
    const responseBytes = new TextEncoder().encode(text).byteLength;
    if (responseBytes === 0 || responseBytes > 64 * 1_024) {
      throw new Error('Hosted checkout response size is invalid.');
    }
    let value: unknown;
    try { value = JSON.parse(text) as unknown; } catch {
      throw new Error('Hosted checkout response JSON is invalid.');
    }
    return parseMaterial(value, this.origin);
  }
}
