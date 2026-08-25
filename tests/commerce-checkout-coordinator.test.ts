import { describe, expect, it, vi } from 'vitest';

import {
  CheckoutBrowserLaunchError,
  CheckoutHandoffCoordinator,
  type CheckoutSessionClient,
} from '../src/main/commerce/checkout-coordinator';
import type { CommerceOrder, VerifiedCommerceQuote } from '../src/shared/commerce';
import type { CommerceCheckoutSession } from '../src/shared/commerce-checkout';

const now = '2026-08-25T10:00:00.000Z';

function quote(overrides: Partial<VerifiedCommerceQuote> = {}): VerifiedCommerceQuote {
  return {
    schemaVersion: 1,
    quoteId: 'quote:1',
    accountId: 'account:1',
    offerId: 'offer:1',
    offerRevision: 1,
    productId: 'avatar:banana',
    productRevision: 1,
    avatarRevisionIds: ['banana:revision:1'],
    catalogVersion: 'catalog:1',
    provider: 'x402-base',
    releaseProfile: 'windows-direct',
    region: 'ZA',
    currency: 'USDC',
    amountAtomic: '1000000',
    network: 'eip155:84532',
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    recipient: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
    issuedAt: '2026-08-25T09:59:30.000Z',
    expiresAt: '2026-08-25T10:04:00.000Z',
    ...overrides,
  };
}

function order(overrides: Partial<CommerceOrder> = {}): CommerceOrder {
  return {
    schemaVersion: 1,
    orderId: 'order:1',
    quoteId: 'quote:1',
    accountId: 'account:1',
    offerId: 'offer:1',
    offerRevision: 1,
    idempotencyKey: 'order-intent:1',
    currency: 'USDC',
    amountAtomic: '1000000',
    state: 'awaiting-approval',
    createdAt: '2026-08-25T09:59:40.000Z',
    updatedAt: '2026-08-25T09:59:41.000Z',
    ...overrides,
  };
}

function session(overrides: Partial<CommerceCheckoutSession> = {}): CommerceCheckoutSession {
  return {
    schemaVersion: 1,
    checkoutSessionId: 'checkout:1',
    approvalId: 'approval:1',
    accountId: 'account:1',
    installationId: 'install:1',
    orderId: 'order:1',
    quoteId: 'quote:1',
    checkoutUrl: 'https://commerce.desky.example/checkout/checkout%3A1',
    createdAt: '2026-08-25T10:00:01.000Z',
    expiresAt: '2026-08-25T10:02:00.000Z',
    state: 'ready',
    ...overrides,
  };
}

function input() {
  return {
    approvalId: 'approval:1',
    idempotencyKey: 'checkout-intent:1',
    installationId: 'install:1',
    quote: quote(),
    order: order(),
    accessToken: 't'.repeat(32),
    now,
  };
}

describe('checkout browser handoff coordinator', () => {
  it('shows exact authoritative terms before creating or opening a checkout', async () => {
    const client: CheckoutSessionClient = {
      serviceOrigin: 'https://commerce.desky.example',
      createSession: vi.fn(async () => session()),
      getSession: vi.fn(async () => session()),
      cancelSession: vi.fn(async () => session({ state: 'cancelled' })),
    };
    const approver = { confirm: vi.fn(async () => 'approved' as const) };
    const browser = { openExternal: vi.fn(async () => undefined) };
    const coordinator = new CheckoutHandoffCoordinator(client, approver, browser, {
      browserBindingVerifier: () => 'v'.repeat(43),
    });
    expect(await coordinator.start(input())).toEqual(session());
    expect(approver.confirm).toHaveBeenCalledWith(expect.objectContaining({
      currency: 'USDC',
      amountAtomic: '1000000',
      network: 'eip155:84532',
      recipient: quote().recipient,
    }));
    expect(browser.openExternal).toHaveBeenCalledWith(
      `${session().checkoutUrl}#handoff=${'v'.repeat(43)}`,
    );
    const request = vi.mocked(client.createSession).mock.calls[0][0];
    expect(request.termsDigest).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(request.browserBindingChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(request)).not.toContain('t'.repeat(32));
  });

  it('does nothing after human cancellation and never reuses an approval ID', async () => {
    const client: CheckoutSessionClient = {
      serviceOrigin: 'https://commerce.desky.example',
      createSession: vi.fn(),
      getSession: vi.fn(),
      cancelSession: vi.fn(),
    };
    const approver = { confirm: vi.fn(async () => 'cancelled' as const) };
    const browser = { openExternal: vi.fn() };
    const coordinator = new CheckoutHandoffCoordinator(client, approver, browser, {
      browserBindingVerifier: () => 'v'.repeat(43),
    });
    expect(await coordinator.start(input())).toBeUndefined();
    expect(client.createSession).not.toHaveBeenCalled();
    expect(browser.openExternal).not.toHaveBeenCalled();
    await expect(coordinator.start(input())).rejects.toThrow('active authoritative order');
  });

  it('rejects order drift before prompting and crossed status identity after handoff', async () => {
    const client: CheckoutSessionClient = {
      serviceOrigin: 'https://commerce.desky.example',
      createSession: vi.fn(async () => session()),
      getSession: vi.fn(async () => session({ orderId: 'order:other' })),
      cancelSession: vi.fn(async () => session({ state: 'cancelled' })),
    };
    const approver = { confirm: vi.fn(async () => 'approved' as const) };
    const coordinator = new CheckoutHandoffCoordinator(
      client,
      approver,
      { openExternal: vi.fn(async () => undefined) },
      { browserBindingVerifier: () => 'v'.repeat(43) },
    );
    await expect(coordinator.start({
      ...input(),
      order: order({ amountAtomic: '2000000' }),
    })).rejects.toThrow('active authoritative order');
    expect(approver.confirm).not.toHaveBeenCalled();
    await expect(coordinator.refresh(session(), 't'.repeat(32)))
      .rejects.toThrow('crossed session identity');
  });

  it('preserves a recoverable session when browser launch fails and supports explicit cancellation', async () => {
    const client: CheckoutSessionClient = {
      serviceOrigin: 'https://commerce.desky.example',
      createSession: vi.fn(async () => session()),
      getSession: vi.fn(async () => session()),
      cancelSession: vi.fn(async () => session({ state: 'cancelled' })),
    };
    const browser = {
      openExternal: vi.fn()
        .mockRejectedValueOnce(new Error('no default browser'))
        .mockResolvedValueOnce(undefined),
    };
    const coordinator = new CheckoutHandoffCoordinator(
      client,
      { confirm: vi.fn(async () => 'approved' as const) },
      browser,
      { browserBindingVerifier: () => 'v'.repeat(43) },
    );
    let recoverable: CommerceCheckoutSession | undefined;
    try {
      await coordinator.start(input());
    } catch (error) {
      expect(error).toBeInstanceOf(CheckoutBrowserLaunchError);
      recoverable = (error as CheckoutBrowserLaunchError).session;
    }
    expect(recoverable).toEqual(session());
    await coordinator.reopen(recoverable!);
    expect((await coordinator.cancel(recoverable!, 't'.repeat(32))).state).toBe('cancelled');
  });
});
