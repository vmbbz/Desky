import { describe, expect, it, vi } from 'vitest';

import { CheckoutBrowserHttpApi } from '../src/service/commerce/checkout-browser-http';
import type { HostedCheckoutBrowserService } from '../src/service/commerce/checkout-browser-service';
import { CommerceServiceError } from '../src/service/commerce/http-api';

function material() {
  return {
    schemaVersion: 1 as const,
    session: {
      schemaVersion: 1 as const,
      checkoutSessionId: 'checkout:1', approvalId: 'approval:1', accountId: 'account:1',
      installationId: 'install:1', orderId: 'order:1', quoteId: 'quote:1',
      checkoutUrl: 'https://commerce.desky.example/checkout/checkout%3A1',
      createdAt: '2026-08-25T10:00:00.000Z', expiresAt: '2026-08-25T10:02:00.000Z',
      state: 'awaiting-wallet' as const,
    },
    csrfToken: 's'.repeat(43),
    view: {
      schemaVersion: 1 as const, checkoutSessionId: 'checkout:1', productId: 'avatar:banana',
      avatarRevisionIds: ['banana:revision:1'], currency: 'USDC' as const,
      amountAtomic: '1250000', network: 'eip155:84532', networkName: 'Base Sepolia' as const,
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      recipient: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
      expiresAt: '2026-08-25T10:02:00.000Z',
    },
    paymentRequirements: {
      scheme: 'exact' as const, network: 'eip155:84532' as const,
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const,
      amount: '1250000', payTo: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
      maxTimeoutSeconds: 60,
      extra: { assetTransferMethod: 'eip3009' as const, name: 'USDC' as const, version: '2' as const },
    },
    resource: {
      url: 'https://commerce.desky.example/v1/x402/quotes/quote%3A1',
      description: 'Desky avatar entitlement', mimeType: 'application/json' as const,
    },
    setCookie: `__Host-desky-checkout=${'c'.repeat(43)}; Path=/; Secure; HttpOnly; SameSite=Strict`,
  };
}

function browser() {
  return {
    bootstrap: vi.fn(async () => material()),
    resume: vi.fn(async () => ({ ...material(), setCookie: undefined })),
    submit: vi.fn(async () => ({ ...material(), setCookie: undefined })),
  } as unknown as HostedCheckoutBrowserService;
}

function request() {
  return {
    method: 'POST', path: '/v1/browser/bootstrap', contentType: 'application/json',
    body: JSON.stringify({
      schemaVersion: 1, checkoutSessionId: 'checkout:1', bindingVerifier: 'v'.repeat(43),
    }),
    origin: 'https://commerce.desky.example', secFetchSite: 'same-origin',
    correlationId: 'correlation:1',
  };
}

describe('checkout browser HTTP boundary', () => {
  it('keeps the HttpOnly credential in Set-Cookie and emits hardened same-origin JSON', async () => {
    const api = new CheckoutBrowserHttpApi(browser());
    const result = await api.handle(request());
    expect(result.status).toBe(200);
    expect(result.headers['set-cookie']).toContain('Secure; HttpOnly; SameSite=Strict');
    expect(result.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(result.headers['referrer-policy']).toBe('no-referrer');
    expect(result.body).not.toContain('c'.repeat(43));
    expect(result.body).toContain('s'.repeat(43));
  });

  it('rejects unknown routes, methods, media types, and oversized bodies', async () => {
    const api = new CheckoutBrowserHttpApi(browser());
    expect((await api.handle({ ...request(), path: '/v1/browser/admin' })).status).toBe(404);
    expect((await api.handle({ ...request(), method: 'GET' })).status).toBe(404);
    expect((await api.handle({ ...request(), contentType: 'text/plain' })).status).toBe(415);
    expect((await api.handle({ ...request(), body: 'x'.repeat(32 * 1_024 + 1) })).status)
      .toBe(400);
  });

  it('maps browser authentication and conflict failures without leaking internals', async () => {
    const stub = browser();
    vi.mocked(stub.bootstrap).mockRejectedValue(new CommerceServiceError('authentication-failed'));
    const auth = await new CheckoutBrowserHttpApi(stub).handle(request());
    expect(auth.status).toBe(401);
    expect(auth.body).toBe(JSON.stringify({
      schemaVersion: 1, error: 'authentication-failed', correlationId: 'correlation:1',
    }));
    vi.mocked(stub.bootstrap).mockRejectedValue(new CommerceServiceError('conflict'));
    expect((await new CheckoutBrowserHttpApi(stub).handle(request())).status).toBe(409);
  });
});
