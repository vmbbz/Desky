import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SqliteCommerceLedger } from '../src/service/commerce/sqlite-commerce-ledger';
import type {
  AssetGrant,
  CommerceOrder,
  EntitlementEvent,
  PaymentAttempt,
  VerifiedCommerceQuote,
} from '../src/shared/commerce';
import type {
  PaymentAuthorizationEvidence,
  PaymentSettlementObservation,
  PaymentSettlementStatus,
} from '../src/shared/commerce-settlement';

const directories: string[] = [];
const issuedAt = '2026-08-24T20:00:00.000Z';
const expiresAt = '2026-08-24T20:05:00.000Z';

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'desky-commerce-ledger-'));
  directories.push(directory);
  return join(directory, 'commerce.db');
}

function quote(): VerifiedCommerceQuote {
  return {
    schemaVersion: 1,
    quoteId: 'quote:1',
    accountId: 'account:1',
    offerId: 'offer:banana',
    offerRevision: 1,
    productId: 'avatar:banana',
    productRevision: 3,
    avatarRevisionIds: ['banana:revision:3'],
    catalogVersion: 'catalog:2026-08-24',
    provider: 'x402-base',
    releaseProfile: 'windows-direct',
    region: 'ZA',
    currency: 'USDC',
    amountAtomic: '1000000',
    network: 'eip155:84532',
    asset: '0x0000000000000000000000000000000000000001',
    recipient: '0x0000000000000000000000000000000000000002',
    issuedAt,
    expiresAt,
  };
}

function order(overrides: Partial<CommerceOrder> = {}): CommerceOrder {
  return {
    schemaVersion: 1,
    orderId: 'order:1',
    quoteId: 'quote:1',
    accountId: 'account:1',
    offerId: 'offer:banana',
    offerRevision: 1,
    idempotencyKey: 'intent:1',
    currency: 'USDC',
    amountAtomic: '1000000',
    state: 'created',
    createdAt: '2026-08-24T20:00:01.000Z',
    updatedAt: '2026-08-24T20:00:01.000Z',
    ...overrides,
  };
}

function attempt(): PaymentAttempt {
  return {
    schemaVersion: 1,
    attemptId: 'attempt:1',
    orderId: 'order:1',
    quoteId: 'quote:1',
    provider: 'x402-base',
    network: 'eip155:84532',
    asset: '0x0000000000000000000000000000000000000001',
    recipient: '0x0000000000000000000000000000000000000002',
    quoteExpiresAt: expiresAt,
    state: 'created',
  };
}

function authorization(
  overrides: Partial<PaymentAuthorizationEvidence> = {},
): PaymentAuthorizationEvidence {
  return {
    schemaVersion: 1,
    authorizationId: 'authorization:1',
    attemptId: 'attempt:1',
    orderId: 'order:1',
    quoteId: 'quote:1',
    provider: 'x402-base',
    payer: '0x0000000000000000000000000000000000000003',
    paymentIdentifier: '0x1111111111111111111111111111111111111111111111111111111111111111',
    network: 'eip155:84532',
    asset: '0x0000000000000000000000000000000000000001',
    recipient: '0x0000000000000000000000000000000000000002',
    amountAtomic: '1000000',
    verifiedAt: '2026-08-24T20:00:05.000Z',
    authorizationExpiresAt: '2026-08-24T20:04:00.000Z',
    ...overrides,
  };
}

function observation(
  status: PaymentSettlementStatus,
  overrides: Partial<PaymentSettlementObservation> = {},
): PaymentSettlementObservation {
  return {
    schemaVersion: 1,
    observationId: `observation:${status}`,
    authorizationId: 'authorization:1',
    attemptId: 'attempt:1',
    orderId: 'order:1',
    quoteId: 'quote:1',
    provider: 'x402-base',
    status,
    source: status === 'unknown' ? 'facilitator-response' : 'facilitator-reconciliation',
    payer: '0x0000000000000000000000000000000000000003',
    paymentIdentifier: '0x1111111111111111111111111111111111111111111111111111111111111111',
    network: 'eip155:84532',
    asset: '0x0000000000000000000000000000000000000001',
    recipient: '0x0000000000000000000000000000000000000002',
    amountAtomic: '1000000',
    providerReference: status === 'pending' || status === 'settled' ? 'tx:base:1' : undefined,
    observedAt: status === 'settled'
      ? '2026-08-24T20:00:30.000Z' : '2026-08-24T20:00:10.000Z',
    settledAt: status === 'settled' ? '2026-08-24T20:00:30.000Z' : undefined,
    reasonCode: status === 'unknown' ? 'settle-timeout' : status,
    reconciliationId: `reconcile:${status}`,
    ...overrides,
  };
}

function event(): EntitlementEvent {
  return {
    schemaVersion: 1,
    eventId: 'event:1',
    accountId: 'account:1',
    productId: 'avatar:banana',
    type: 'grant',
    source: 'x402-base',
    sourceReference: 'tx:base:1',
    effectiveAt: '2026-08-24T20:00:30.000Z',
    reasonCode: 'payment-settled',
  };
}

function grant(overrides: Partial<AssetGrant> = {}): AssetGrant {
  return {
    schemaVersion: 1,
    grantId: 'grant:1',
    accountId: 'account:1',
    productId: 'avatar:banana',
    productRevision: 3,
    avatarRevisionIds: ['banana:revision:3'],
    entitlementEventId: 'event:1',
    catalogVersion: 'catalog:2026-08-24',
    state: 'active',
    issuedAt: '2026-08-24T20:00:30.000Z',
    ...overrides,
  };
}

function prepareSettlement(ledger: SqliteCommerceLedger): void {
  ledger.storeQuote(quote());
  ledger.createOrder(order());
  ledger.advanceOrder('order:1', 'awaiting-approval', '2026-08-24T20:00:02.000Z');
  ledger.advanceOrder('order:1', 'awaiting-settlement', '2026-08-24T20:00:03.000Z');
  ledger.createPaymentAttempt(attempt());
  ledger.advancePaymentAttempt('attempt:1', 'submitted');
  const verified = ledger.verifyPaymentAuthorization(authorization());
  expect(verified.attempt.state).toBe('verified');
  expect(ledger.verifyPaymentAuthorization(authorization())).toEqual(verified);
  const settled = ledger.recordSettlementObservation(observation('settled'));
  expect(settled.attempt.state).toBe('settled');
  expect(ledger.recordSettlementObservation(observation('settled'))).toEqual(settled);
}

afterEach(() => {
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe('SQLite commerce ledger conformance', () => {
  it('atomically settles, grants once, survives reopen, and replays exactly', () => {
    const path = databasePath();
    let ledger = new SqliteCommerceLedger(path);
    prepareSettlement(ledger);
    const committed = ledger.commitSettledGrant({
      orderId: 'order:1',
      attemptId: 'attempt:1',
      settlementObservationId: 'observation:settled',
      entitlementEvent: event(),
      assetGrant: grant(),
    });
    expect(committed.order.state).toBe('granted');
    expect(committed.attempt.state).toBe('settled');
    expect(ledger.listEntitlementEvents('account:1', 'avatar:banana')).toEqual([event()]);
    expect(ledger.commitSettledGrant({
      orderId: 'order:1',
      attemptId: 'attempt:1',
      settlementObservationId: 'observation:settled',
      entitlementEvent: event(),
      assetGrant: grant(),
    }).assetGrant).toEqual(grant());
    ledger.close();

    ledger = new SqliteCommerceLedger(path);
    expect(ledger.getOrder('order:1')?.state).toBe('granted');
    expect(ledger.getPaymentAttempt('attempt:1')?.state).toBe('settled');
    expect(ledger.getAssetGrant('grant:1')).toEqual(grant());
    expect(ledger.listEntitlementEvents('account:1', 'avatar:banana')).toEqual([event()]);
    ledger.close();
  });

  it('rolls back every write when the grant does not match the quote', () => {
    const ledger = new SqliteCommerceLedger(databasePath());
    prepareSettlement(ledger);
    expect(() => ledger.commitSettledGrant({
      orderId: 'order:1',
      attemptId: 'attempt:1',
      settlementObservationId: 'observation:settled',
      entitlementEvent: event(),
      assetGrant: grant({ productRevision: 4 }),
    })).toThrow('does not match');
    expect(ledger.getOrder('order:1')?.state).toBe('awaiting-settlement');
    expect(ledger.getPaymentAttempt('attempt:1')?.state).toBe('settled');
    expect(ledger.getEntitlementEvent('event:1')).toBeUndefined();
    expect(ledger.getAssetGrant('grant:1')).toBeUndefined();
    ledger.close();
  });

  it('rejects quote drift and conflicting order idempotency keys', () => {
    const ledger = new SqliteCommerceLedger(databasePath());
    ledger.storeQuote(quote());
    expect(() => ledger.createOrder(order({ amountAtomic: '999999' })))
      .toThrow('does not match its authoritative quote');
    ledger.createOrder(order());
    expect(() => ledger.createOrder(order({
      orderId: 'order:2',
      updatedAt: '2026-08-24T20:00:02.000Z',
      createdAt: '2026-08-24T20:00:02.000Z',
    }))).toThrow('idempotency-key collision');
    ledger.close();
  });

  it('rejects authorization at quote expiry without changing durable state', () => {
    const ledger = new SqliteCommerceLedger(databasePath());
    ledger.storeQuote(quote());
    ledger.createOrder(order());
    ledger.advanceOrder('order:1', 'awaiting-approval', '2026-08-24T20:00:02.000Z');
    ledger.advanceOrder('order:1', 'awaiting-settlement', '2026-08-24T20:00:03.000Z');
    ledger.createPaymentAttempt(attempt());
    ledger.advancePaymentAttempt('attempt:1', 'submitted');
    expect(() => ledger.verifyPaymentAuthorization(authorization({
      verifiedAt: expiresAt,
      authorizationExpiresAt: '2026-08-24T20:06:00.000Z',
    }))).toThrow('does not match');
    expect(ledger.getOrder('order:1')?.state).toBe('awaiting-settlement');
    expect(ledger.getPaymentAttempt('attempt:1')?.state).toBe('submitted');
    expect(ledger.getPaymentAuthorization('authorization:1')).toBeUndefined();
    expect(ledger.listEntitlementEvents('account:1', 'avatar:banana')).toEqual([]);
    ledger.close();
  });

  it('blocks grant, retry, cancellation, and expiry while settlement is unknown', () => {
    const ledger = new SqliteCommerceLedger(databasePath());
    ledger.storeQuote(quote());
    ledger.createOrder(order());
    ledger.advanceOrder('order:1', 'awaiting-approval', '2026-08-24T20:00:02.000Z');
    ledger.advanceOrder('order:1', 'awaiting-settlement', '2026-08-24T20:00:03.000Z');
    ledger.createPaymentAttempt(attempt());
    ledger.advancePaymentAttempt('attempt:1', 'submitted');
    ledger.verifyPaymentAuthorization(authorization());
    ledger.recordSettlementObservation(observation('unknown'));
    expect(ledger.getPaymentAttempt('attempt:1')?.state).toBe('settlement-unknown');
    expect(() => ledger.commitSettledGrant({
      orderId: 'order:1',
      attemptId: 'attempt:1',
      settlementObservationId: 'observation:unknown',
      entitlementEvent: event(),
      assetGrant: grant(),
    })).toThrow('durable settled observation');
    expect(() => ledger.createPaymentAttempt({ ...attempt(), attemptId: 'attempt:2' }))
      .toThrow('active payment attempt');
    expect(() => ledger.advanceOrder(
      'order:1', 'cancelled', '2026-08-24T20:00:20.000Z',
    )).toThrow('requires reconciliation');
    expect(() => ledger.advanceOrder(
      'order:1', 'expired', '2026-08-24T20:05:01.000Z',
    )).toThrow('requires reconciliation');
    expect(ledger.getAssetGrant('grant:1')).toBeUndefined();
    ledger.close();
  });

  it('reconciles timeout through pending to settled and grants exactly once', () => {
    const ledger = new SqliteCommerceLedger(databasePath());
    ledger.storeQuote(quote());
    ledger.createOrder(order());
    ledger.advanceOrder('order:1', 'awaiting-approval', '2026-08-24T20:00:02.000Z');
    ledger.advanceOrder('order:1', 'awaiting-settlement', '2026-08-24T20:00:03.000Z');
    ledger.createPaymentAttempt(attempt());
    ledger.advancePaymentAttempt('attempt:1', 'submitted');
    ledger.verifyPaymentAuthorization(authorization());
    ledger.recordSettlementObservation(observation('unknown'));
    ledger.recordSettlementObservation(observation('pending'));
    ledger.recordSettlementObservation(observation('settled', {
      observedAt: '2026-08-24T20:10:00.000Z',
      settledAt: '2026-08-24T20:00:30.000Z',
    }));
    expect(ledger.listSettlementObservations('authorization:1').map((entry) => entry.status))
      .toEqual(['unknown', 'pending', 'settled']);
    expect(ledger.commitSettledGrant({
      orderId: 'order:1',
      attemptId: 'attempt:1',
      settlementObservationId: 'observation:settled',
      entitlementEvent: event(),
      assetGrant: grant(),
    }).order.state).toBe('granted');
    ledger.close();
  });

  it('rejects settlement drift, terminal regression, and transaction reuse', () => {
    const ledger = new SqliteCommerceLedger(databasePath());
    prepareSettlement(ledger);
    expect(() => ledger.recordSettlementObservation(observation('settled', {
      observationId: 'observation:settled:changed',
      reconciliationId: 'reconcile:settled:changed',
      amountAtomic: '999999',
    }))).toThrow('does not match');
    expect(() => ledger.recordSettlementObservation(observation('pending', {
      observationId: 'observation:late-pending',
      reconciliationId: 'reconcile:late-pending',
    }))).toThrow('regress');
    expect(ledger.listSettlementObservations('authorization:1')).toHaveLength(1);

    ledger.storeQuote({ ...quote(), quoteId: 'quote:2' });
    ledger.createOrder(order({
      orderId: 'order:2',
      quoteId: 'quote:2',
      idempotencyKey: 'intent:2',
    }));
    ledger.advanceOrder('order:2', 'awaiting-approval', '2026-08-24T20:00:02.000Z');
    ledger.advanceOrder('order:2', 'awaiting-settlement', '2026-08-24T20:00:03.000Z');
    ledger.createPaymentAttempt({
      ...attempt(), attemptId: 'attempt:2', orderId: 'order:2', quoteId: 'quote:2',
    });
    ledger.advancePaymentAttempt('attempt:2', 'submitted');
    expect(() => ledger.verifyPaymentAuthorization({
      ...authorization(),
      authorizationId: 'authorization:2',
      attemptId: 'attempt:2',
      orderId: 'order:2',
      quoteId: 'quote:2',
    })).toThrow('Duplicate payment authorization or payment identifier');
    expect(ledger.getPaymentAttempt('attempt:2')?.state).toBe('submitted');
    ledger.verifyPaymentAuthorization({
      ...authorization(),
      authorizationId: 'authorization:2',
      attemptId: 'attempt:2',
      orderId: 'order:2',
      quoteId: 'quote:2',
      paymentIdentifier: '0x2222222222222222222222222222222222222222222222222222222222222222',
    });
    expect(() => ledger.recordSettlementObservation({
      ...observation('settled'),
      observationId: 'observation:settled:2',
      authorizationId: 'authorization:2',
      attemptId: 'attempt:2',
      orderId: 'order:2',
      quoteId: 'quote:2',
      paymentIdentifier: '0x2222222222222222222222222222222222222222222222222222222222222222',
      reconciliationId: 'reconcile:settled:2',
    })).toThrow('belongs to another authorization');
    expect(ledger.getPaymentAttempt('attempt:2')?.state).toBe('verified');
    expect(ledger.listSettlementObservations('authorization:2')).toEqual([]);
    ledger.close();
  });

  it('permits a new attempt only after reconciliation proves failure', () => {
    const ledger = new SqliteCommerceLedger(databasePath());
    ledger.storeQuote(quote());
    ledger.createOrder(order());
    ledger.advanceOrder('order:1', 'awaiting-approval', '2026-08-24T20:00:02.000Z');
    ledger.advanceOrder('order:1', 'awaiting-settlement', '2026-08-24T20:00:03.000Z');
    ledger.createPaymentAttempt(attempt());
    ledger.advancePaymentAttempt('attempt:1', 'submitted');
    ledger.verifyPaymentAuthorization(authorization());
    ledger.recordSettlementObservation(observation('failed'));
    expect(ledger.getPaymentAttempt('attempt:1')?.state).toBe('failed');
    expect(ledger.createPaymentAttempt({ ...attempt(), attemptId: 'attempt:2' }).state)
      .toBe('created');
    ledger.close();
  });
});
