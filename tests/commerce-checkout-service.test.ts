import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkoutTermsDigest } from '../src/main/commerce/checkout-coordinator';
import { HostedCommerceCheckoutService } from '../src/service/commerce/checkout-session-service';
import { CommerceServiceError } from '../src/service/commerce/http-api';
import { SqliteCommerceLedger } from '../src/service/commerce/sqlite-commerce-ledger';
import type { CommerceOrder, VerifiedCommerceQuote } from '../src/shared/commerce';

const directories: string[] = [];
const now = '2026-08-25T10:00:00.000Z';

function ledger(): SqliteCommerceLedger {
  const directory = mkdtempSync(join(tmpdir(), 'desky-checkout-service-'));
  directories.push(directory);
  return new SqliteCommerceLedger(join(directory, 'commerce.db'));
}

function quote(): VerifiedCommerceQuote {
  return {
    schemaVersion: 1,
    quoteId: 'quote:1', accountId: 'account:1', offerId: 'offer:1', offerRevision: 1,
    productId: 'avatar:banana', productRevision: 1,
    avatarRevisionIds: ['banana:revision:1'], catalogVersion: 'catalog:1',
    provider: 'x402-base', releaseProfile: 'windows-direct', region: 'ZA', currency: 'USDC',
    amountAtomic: '1000000', network: 'eip155:84532',
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    recipient: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
    issuedAt: '2026-08-25T09:59:30.000Z', expiresAt: '2026-08-25T10:04:00.000Z',
  };
}

function order(): CommerceOrder {
  return {
    schemaVersion: 1,
    orderId: 'order:1', quoteId: 'quote:1', accountId: 'account:1', offerId: 'offer:1',
    offerRevision: 1, idempotencyKey: 'order:1', currency: 'USDC', amountAtomic: '1000000',
    state: 'created', createdAt: '2026-08-25T09:59:40.000Z',
    updatedAt: '2026-08-25T09:59:40.000Z',
  };
}

function prepare(store: SqliteCommerceLedger): CommerceOrder {
  const admittedQuote = store.storeQuote(quote());
  store.createOrder(order());
  const admittedOrder = store.advanceOrder('order:1', 'awaiting-approval', '2026-08-25T09:59:41.000Z');
  expect(admittedQuote.quoteId).toBe('quote:1');
  return admittedOrder;
}

afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('hosted commerce checkout service', () => {
  it('persists an exact short-lived session and replays only the identical request', async () => {
    const store = ledger();
    const admittedOrder = prepare(store);
    const service = new HostedCommerceCheckoutService(store, {
      authenticate: async () => ({ accountId: 'account:1', installationId: 'install:1' }),
    }, {
      checkoutOrigin: 'https://commerce.desky.example',
      now: () => new Date(now),
      sessionId: () => 'checkout:1',
    });
    const request = {
      schemaVersion: 1 as const,
      approvalId: 'approval:1', accountId: 'account:1', installationId: 'install:1',
      orderId: 'order:1', quoteId: 'quote:1', termsDigest: checkoutTermsDigest(quote(), admittedOrder),
      approvedAt: now, approvalExpiresAt: '2026-08-25T10:02:00.000Z',
      idempotencyKey: 'checkout-intent:1',
    };
    const created = await service.createSession(request, 't'.repeat(32));
    expect(created.checkoutUrl).toBe('https://commerce.desky.example/checkout/checkout%3A1');
    expect(await service.createSession(request, 't'.repeat(32))).toEqual(created);
    expect(store.getCheckoutSession('checkout:1')?.request).toEqual(request);
    await expect(service.createSession({ ...request, quoteId: 'quote:other' }, 't'.repeat(32)))
      .rejects.toEqual(new CommerceServiceError('conflict'));
    store.close();
  });

  it('binds status and cancellation to both account and installation', async () => {
    const store = ledger();
    const admittedOrder = prepare(store);
    let installationId = 'install:1';
    const service = new HostedCommerceCheckoutService(store, {
      authenticate: async () => ({ accountId: 'account:1', installationId }),
    }, {
      checkoutOrigin: 'https://commerce.desky.example', now: () => new Date(now),
      sessionId: () => 'checkout:1',
    });
    await service.createSession({
      schemaVersion: 1, approvalId: 'approval:1', accountId: 'account:1',
      installationId: 'install:1', orderId: 'order:1', quoteId: 'quote:1',
      termsDigest: checkoutTermsDigest(quote(), admittedOrder), approvedAt: now,
      approvalExpiresAt: '2026-08-25T10:02:00.000Z', idempotencyKey: 'checkout-intent:1',
    }, 't'.repeat(32));
    installationId = 'install:other';
    await expect(service.getSession({
      schemaVersion: 1, checkoutSessionId: 'checkout:1', installationId: 'install:1',
    }, 't'.repeat(32))).rejects.toEqual(new CommerceServiceError('authentication-failed'));
    installationId = 'install:1';
    expect((await service.cancelSession({
      schemaVersion: 1, checkoutSessionId: 'checkout:1', installationId: 'install:1',
    }, 't'.repeat(32))).state).toBe('cancelled');
    store.close();
  });
});
