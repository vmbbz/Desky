import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SqliteCommerceLedger } from '../src/service/commerce/sqlite-commerce-ledger';
import {
  X402CheckoutProcessor,
  type X402CheckoutFacilitator,
} from '../src/service/commerce/x402-checkout-processor';
import {
  baseSepoliaNetwork,
  baseSepoliaUsdc,
  type X402BasePaymentPayload,
  type X402PaymentRequirements,
  type X402ResourceInfo,
} from '../src/service/commerce/x402-base-sepolia';
import type { CommerceOrder, PaymentAttempt, VerifiedCommerceQuote } from '../src/shared/commerce';

const directories: string[] = [];
const now = '2026-08-25T10:00:00.000Z';
const nowSeconds = Math.floor(Date.parse(now) / 1_000);
const merchant = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';
const payer = '0x857b06519E91e3A54538791bDbb0E22373e36b66';

function ledger(): SqliteCommerceLedger {
  const directory = mkdtempSync(join(tmpdir(), 'desky-x402-processor-'));
  directories.push(directory);
  return new SqliteCommerceLedger(join(directory, 'commerce.db'));
}

const requirements: X402PaymentRequirements = {
  scheme: 'exact', network: baseSepoliaNetwork, asset: baseSepoliaUsdc,
  amount: '1250000', payTo: merchant, maxTimeoutSeconds: 60,
  extra: { assetTransferMethod: 'eip3009', name: 'USDC', version: '2' },
};
const resource: X402ResourceInfo = {
  url: 'https://commerce.desky.example/v1/x402/quotes/quote%3A1',
  description: 'Desky avatar entitlement', mimeType: 'application/json',
};

function payload(): X402BasePaymentPayload {
  return {
    x402Version: 2, resource, accepted: requirements,
    payload: {
      signature: `0x${'11'.repeat(65)}`,
      authorization: {
        from: payer, to: merchant, value: requirements.amount,
        validAfter: String(nowSeconds - 10), validBefore: String(nowSeconds + 120),
        nonce: `0x${'22'.repeat(32)}`,
      },
    },
  };
}

function quote(): VerifiedCommerceQuote {
  return {
    schemaVersion: 1, quoteId: 'quote:1', accountId: 'account:1', offerId: 'offer:1',
    offerRevision: 1, productId: 'avatar:banana', productRevision: 1,
    avatarRevisionIds: ['banana:revision:1'], catalogVersion: 'catalog:1',
    provider: 'x402-base', releaseProfile: 'windows-direct', region: 'ZA', currency: 'USDC',
    amountAtomic: requirements.amount, network: baseSepoliaNetwork, asset: baseSepoliaUsdc,
    recipient: merchant, issuedAt: new Date((nowSeconds - 30) * 1_000).toISOString(),
    expiresAt: new Date((nowSeconds + 240) * 1_000).toISOString(),
  };
}

function order(): CommerceOrder {
  return {
    schemaVersion: 1, orderId: 'order:1', quoteId: 'quote:1', accountId: 'account:1',
    offerId: 'offer:1', offerRevision: 1, idempotencyKey: 'order:1', currency: 'USDC',
    amountAtomic: requirements.amount, state: 'created',
    createdAt: new Date((nowSeconds - 20) * 1_000).toISOString(),
    updatedAt: new Date((nowSeconds - 20) * 1_000).toISOString(),
  };
}

function attempt(state: PaymentAttempt['state'] = 'created'): PaymentAttempt {
  return {
    schemaVersion: 1, attemptId: 'attempt:1', orderId: 'order:1', quoteId: 'quote:1',
    provider: 'x402-base', network: baseSepoliaNetwork, asset: baseSepoliaUsdc,
    recipient: merchant, quoteExpiresAt: quote().expiresAt, state,
  };
}

function prepare(store: SqliteCommerceLedger): PaymentAttempt {
  store.storeQuote(quote());
  store.createOrder(order());
  store.advanceOrder('order:1', 'awaiting-approval', new Date((nowSeconds - 19) * 1_000).toISOString());
  store.advanceOrder('order:1', 'awaiting-settlement', new Date((nowSeconds - 18) * 1_000).toISOString());
  store.createPaymentAttempt(attempt());
  return store.advancePaymentAttempt('attempt:1', 'submitted');
}

function facilitator(input: {
  valid?: boolean;
  settle?: 'settled' | 'pending' | 'pending-without-reference' | 'throw';
} = {}): X402CheckoutFacilitator {
  return {
    verify: vi.fn(async () => input.valid === false
      ? { isValid: false, invalidReason: 'invalid_signature' }
      : { isValid: true, payer }),
    settle: vi.fn(async () => {
      if (input.settle === 'throw') throw new Error('connection lost after dispatch');
      if (input.settle === 'pending') return {
        success: false, errorReason: 'settlement_pending', payer,
        transaction: `0x${'33'.repeat(32)}`, network: baseSepoliaNetwork,
      };
      if (input.settle === 'pending-without-reference') return {
        success: false, errorReason: 'settlement_pending', payer,
        transaction: '', network: baseSepoliaNetwork,
      };
      return {
        success: true, payer, transaction: `0x${'33'.repeat(32)}`,
        network: baseSepoliaNetwork, amount: requirements.amount,
      };
    }),
  };
}

afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('hosted x402 checkout processor', () => {
  it('durably claims dispatch before settle and records a terminal result without wallet material', async () => {
    const store = ledger();
    const submitted = prepare(store);
    const remote = facilitator();
    const result = await new X402CheckoutProcessor(store, remote).process({
      attempt: submitted, paymentPayload: payload(), paymentRequirements: requirements, resource, now,
    });
    expect(result.kind).toBe('settlement-recorded');
    expect(result.kind === 'settlement-recorded' && result.observation.status).toBe('settled');
    expect(store.listSettlementObservations('authorization:attempt:1').map((entry) => entry.status))
      .toEqual(['unknown', 'settled']);
    const durable = JSON.stringify({
      authorization: store.getPaymentAuthorization('authorization:attempt:1'),
      observations: store.listSettlementObservations('authorization:attempt:1'),
    });
    expect(durable).not.toContain(payload().payload.signature);
    expect(durable).not.toContain('signature');
    store.close();
  });

  it('leaves an indeterminate dispatch for reconciliation and never settles it twice', async () => {
    const store = ledger();
    const submitted = prepare(store);
    const firstRemote = facilitator({ settle: 'throw' });
    const processor = new X402CheckoutProcessor(store, firstRemote);
    const first = await processor.process({
      attempt: submitted, paymentPayload: payload(), paymentRequirements: requirements, resource, now,
    });
    expect(first.kind).toBe('reconciliation-required');
    expect(store.getPaymentAttempt('attempt:1')?.state).toBe('settlement-unknown');
    const secondRemote = facilitator();
    const second = await new X402CheckoutProcessor(store, secondRemote).process({
      attempt: store.getPaymentAttempt('attempt:1')!, paymentPayload: payload(),
      paymentRequirements: requirements, resource, now,
    });
    expect(second.kind).toBe('reconciliation-required');
    expect(secondRemote.settle).not.toHaveBeenCalled();
    expect(store.listSettlementObservations('authorization:attempt:1')).toHaveLength(1);
    store.close();
  });

  it('fails before authorization on an explicit verify rejection and does not call settle', async () => {
    const store = ledger();
    const submitted = prepare(store);
    const remote = facilitator({ valid: false });
    const result = await new X402CheckoutProcessor(store, remote).process({
      attempt: submitted, paymentPayload: payload(), paymentRequirements: requirements, resource, now,
    });
    expect(result).toEqual({ kind: 'verification-rejected', reason: 'invalid_signature' });
    expect(store.getPaymentAttempt('attempt:1')?.state).toBe('failed');
    expect(store.getPaymentAuthorization('authorization:attempt:1')).toBeUndefined();
    expect(remote.settle).not.toHaveBeenCalled();
    store.close();
  });

  it('rejects crossed facilitator payer identity without persisting authorization', async () => {
    const store = ledger();
    const remote = facilitator();
    vi.mocked(remote.verify).mockResolvedValue({
      isValid: true,
      payer: '0x0000000000000000000000000000000000000001',
    });
    await expect(new X402CheckoutProcessor(store, remote).process({
      attempt: prepare(store), paymentPayload: payload(), paymentRequirements: requirements,
      resource, now,
    })).rejects.toThrow('crossed x402 payer identity');
    expect(store.getPaymentAttempt('attempt:1')?.state).toBe('submitted');
    expect(store.getPaymentAuthorization('authorization:attempt:1')).toBeUndefined();
    expect(remote.settle).not.toHaveBeenCalled();
    store.close();
  });

  it('records a referenced pending result for later reconciliation', async () => {
    const store = ledger();
    const result = await new X402CheckoutProcessor(store, facilitator({ settle: 'pending' })).process({
      attempt: prepare(store), paymentPayload: payload(), paymentRequirements: requirements, resource, now,
    });
    expect(result.kind === 'settlement-recorded' && result.observation.status).toBe('pending');
    expect(store.getPaymentAttempt('attempt:1')?.state).toBe('settlement-pending');
    store.close();
  });

  it('does not convert an unreferenced pending response into a retryable failure', async () => {
    const store = ledger();
    const result = await new X402CheckoutProcessor(
      store,
      facilitator({ settle: 'pending-without-reference' }),
    ).process({
      attempt: prepare(store), paymentPayload: payload(), paymentRequirements: requirements, resource, now,
    });
    expect(result.kind).toBe('reconciliation-required');
    expect(store.getPaymentAttempt('attempt:1')?.state).toBe('settlement-unknown');
    expect(store.listSettlementObservations('authorization:attempt:1')).toHaveLength(1);
    store.close();
  });
});
