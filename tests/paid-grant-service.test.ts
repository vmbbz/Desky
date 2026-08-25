import { describe, expect, it, vi } from 'vitest';

import { HostedPaidGrantService } from '../src/service/commerce/paid-grant-service';
import type { PostgresCheckoutLedger } from '../src/service/commerce/postgres-checkout-ledger';
import type { PaymentSettlementObservation } from '../src/shared/commerce-settlement';

const settledAt = '2026-08-25T17:00:00.000Z';
const transaction = `0x${'44'.repeat(32)}`;
const observation: PaymentSettlementObservation = {
  schemaVersion: 1,
  observationId: 'observation:settled',
  authorizationId: 'authorization:test',
  attemptId: 'attempt:test',
  orderId: 'order:test',
  quoteId: 'quote:test',
  provider: 'x402-base',
  status: 'settled',
  source: 'chain-reconciliation',
  payer: '0x1111111111111111111111111111111111111111',
  paymentIdentifier: `0x${'33'.repeat(32)}`,
  network: 'eip155:84532',
  asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  recipient: '0x2222222222222222222222222222222222222222',
  amountAtomic: '100000',
  providerReference: transaction,
  observedAt: settledAt,
  settledAt,
  reasonCode: 'chain-confirmed',
  reconciliationId: 'reconcile:settled',
};

describe('hosted paid grant service', () => {
  it('projects exact settled quote terms into the sole atomic grant transaction', async () => {
    const commitSettledGrant = vi.fn(async () => ({}));
    const ledger = {
      getOrder: vi.fn(async () => ({
        schemaVersion: 1, orderId: 'order:test', quoteId: 'quote:test', accountId: 'account:test',
        offerId: 'offer.toothpaste.pilot', offerRevision: 1, idempotencyKey: 'order-key:test',
        currency: 'USDC', amountAtomic: '100000', state: 'awaiting-settlement',
        createdAt: '2026-08-25T16:55:00.000Z', updatedAt: '2026-08-25T16:56:00.000Z',
      })),
      getQuote: vi.fn(async () => ({
        schemaVersion: 1, quoteId: 'quote:test', accountId: 'account:test',
        offerId: 'offer.toothpaste.pilot', offerRevision: 1,
        productId: 'avatar.toothpaste', productRevision: 1,
        avatarRevisionIds: ['toothpaste-6dc38124-v1'], catalogVersion: 'desky-pilot:1',
        provider: 'x402-base', releaseProfile: 'windows-direct', region: 'ZA',
        currency: 'USDC', amountAtomic: '100000', network: 'eip155:84532',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        recipient: '0x2222222222222222222222222222222222222222',
        issuedAt: '2026-08-25T16:55:00.000Z', expiresAt: '2026-08-25T17:00:00.000Z',
      })),
      commitSettledGrant,
    } as unknown as PostgresCheckoutLedger;
    const committed = await new HostedPaidGrantService(ledger).commitSettlement(observation);
    expect(committed.entitlementEvent).toMatchObject({
      accountId: 'account:test', productId: 'avatar.toothpaste', source: 'x402-base',
      sourceReference: transaction, effectiveAt: settledAt,
    });
    expect(committed.assetGrant).toMatchObject({
      accountId: 'account:test', productId: 'avatar.toothpaste', productRevision: 1,
      avatarRevisionIds: ['toothpaste-6dc38124-v1'], state: 'active', issuedAt: settledAt,
    });
    expect(commitSettledGrant).toHaveBeenCalledOnce();
  });

  it('never grants unknown settlement', async () => {
    const ledger = {} as PostgresCheckoutLedger;
    await expect(new HostedPaidGrantService(ledger).commitSettlement({
      ...observation, status: 'unknown', providerReference: undefined, settledAt: undefined,
    })).rejects.toThrow(/exact durable settlement/);
  });
});
