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
  const verified = ledger.verifyPaymentAttempt('attempt:1', 'tx:base:1');
  expect(ledger.verifyPaymentAttempt('attempt:1', 'tx:base:1')).toEqual(verified);
  expect(() => ledger.verifyPaymentAttempt('attempt:1', 'tx:base:changed'))
    .toThrow('immutable');
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
      settledAt: '2026-08-24T20:00:30.000Z',
      entitlementEvent: event(),
      assetGrant: grant(),
    });
    expect(committed.order.state).toBe('granted');
    expect(committed.attempt.state).toBe('settled');
    expect(ledger.listEntitlementEvents('account:1', 'avatar:banana')).toEqual([event()]);
    expect(ledger.commitSettledGrant({
      orderId: 'order:1',
      attemptId: 'attempt:1',
      settledAt: '2026-08-24T20:00:30.000Z',
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
      settledAt: '2026-08-24T20:00:30.000Z',
      entitlementEvent: event(),
      assetGrant: grant({ productRevision: 4 }),
    })).toThrow('does not match');
    expect(ledger.getOrder('order:1')?.state).toBe('awaiting-settlement');
    expect(ledger.getPaymentAttempt('attempt:1')?.state).toBe('verified');
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

  it('rejects settlement at expiry without changing durable state', () => {
    const ledger = new SqliteCommerceLedger(databasePath());
    prepareSettlement(ledger);
    expect(() => ledger.commitSettledGrant({
      orderId: 'order:1',
      attemptId: 'attempt:1',
      settledAt: expiresAt,
      entitlementEvent: event(),
      assetGrant: grant(),
    })).toThrow('expired');
    expect(ledger.getOrder('order:1')?.state).toBe('awaiting-settlement');
    expect(ledger.listEntitlementEvents('account:1', 'avatar:banana')).toEqual([]);
    ledger.close();
  });
});
