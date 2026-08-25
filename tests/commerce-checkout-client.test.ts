import { describe, expect, it, vi } from 'vitest';

import { CommerceCheckoutServiceClient } from '../src/main/commerce/checkout-client';
import type {
  CommerceApiRequest,
  CommerceApiTransport,
} from '../src/main/commerce/service-client';

const session = {
  schemaVersion: 1 as const,
  checkoutSessionId: 'checkout:1',
  approvalId: 'approval:1',
  accountId: 'account:1',
  installationId: 'install:1',
  orderId: 'order:1',
  quoteId: 'quote:1',
  checkoutUrl: 'https://commerce.desky.example/checkout/checkout%3A1',
  createdAt: '2026-08-25T10:00:01.000Z',
  expiresAt: '2026-08-25T10:02:00.000Z',
  state: 'ready' as const,
};

function transport(overrides: Partial<{
  status: number;
  finalUrl: string;
  contentType: string;
  body: string;
}> = {}): { transport: CommerceApiTransport; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn(async (input: CommerceApiRequest) => ({
    status: overrides.status ?? 200,
    finalUrl: overrides.finalUrl ?? input.url,
    contentType: overrides.contentType ?? 'application/json',
    body: overrides.body ?? JSON.stringify(session),
  }));
  return { transport: { request }, request };
}

describe('commerce checkout service client', () => {
  it('uses one fixed authenticated JSON route without placing credentials in the URL', async () => {
    const stub = transport();
    const client = new CommerceCheckoutServiceClient({
      serviceOrigin: 'https://commerce.desky.example',
      transport: stub.transport,
    });
    await client.getSession({
      schemaVersion: 1,
      checkoutSessionId: 'checkout:1',
      installationId: 'install:1',
    }, 't'.repeat(32));
    expect(stub.request).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://commerce.desky.example/v1/checkout/session/status',
      headers: expect.objectContaining({ authorization: `Bearer ${'t'.repeat(32)}` }),
    }));
    const submitted = stub.request.mock.calls[0][0] as CommerceApiRequest;
    expect(`${submitted.url}${submitted.body}`).not.toContain('t'.repeat(32));
  });

  it('rejects response redirects and crossed checkout origins or paths', async () => {
    const redirected = transport({ finalUrl: 'https://evil.example/status' });
    await expect(new CommerceCheckoutServiceClient({
      serviceOrigin: 'https://commerce.desky.example',
      transport: redirected.transport,
    }).getSession({
      schemaVersion: 1, checkoutSessionId: 'checkout:1', installationId: 'install:1',
    }, 't'.repeat(32))).rejects.toThrow('response is invalid');

    const crossed = transport({
      body: JSON.stringify({ ...session, checkoutUrl: 'https://evil.example/checkout/checkout%3A1' }),
    });
    await expect(new CommerceCheckoutServiceClient({
      serviceOrigin: 'https://commerce.desky.example',
      transport: crossed.transport,
    }).getSession({
      schemaVersion: 1, checkoutSessionId: 'checkout:1', installationId: 'install:1',
    }, 't'.repeat(32))).rejects.toThrow('does not match');
  });

  it('rejects non-origin configuration and header injection', async () => {
    expect(() => new CommerceCheckoutServiceClient({
      serviceOrigin: 'https://commerce.desky.example/path',
    })).toThrow('exact HTTPS origin');
    const client = new CommerceCheckoutServiceClient({
      serviceOrigin: 'https://commerce.desky.example',
      transport: transport().transport,
    });
    await expect(client.getSession({
      schemaVersion: 1, checkoutSessionId: 'checkout:1', installationId: 'install:1',
    }, `${'t'.repeat(32)}\r\nInjected: yes`)).rejects.toThrow('access token');
  });
});
