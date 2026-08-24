import { describe, expect, it } from 'vitest';

import {
  appendEntitlementEvent,
  parseCommerceOffer,
  parseCommerceOrder,
  parseCommerceProduct,
  parseEntitlementEvent,
  parsePaymentAttempt,
  projectEntitlement,
  resolveCommerceRuntimePolicy,
  transitionCommerceOrder,
  transitionPaymentAttempt,
  type CommerceOrder,
  type EntitlementEvent,
  type PaymentAttempt,
} from '../src/shared/commerce';

const createdAt = '2026-08-24T20:00:00.000Z';

function order(overrides: Partial<CommerceOrder> = {}): CommerceOrder {
  return {
    schemaVersion: 1,
    orderId: 'order:1',
    accountId: 'account:1',
    offerId: 'offer:banana',
    offerRevision: 1,
    idempotencyKey: 'intent:1',
    currency: 'USDC',
    amountAtomic: '1000000',
    state: 'created',
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function attempt(overrides: Partial<PaymentAttempt> = {}): PaymentAttempt {
  return {
    schemaVersion: 1,
    attemptId: 'attempt:1',
    orderId: 'order:1',
    provider: 'x402-base',
    quoteExpiresAt: '2026-08-24T20:05:00.000Z',
    state: 'created',
    ...overrides,
  };
}

function entitlement(overrides: Partial<EntitlementEvent> = {}): EntitlementEvent {
  return {
    schemaVersion: 1,
    eventId: 'event:1',
    accountId: 'account:1',
    productId: 'avatar:banana',
    type: 'grant',
    source: 'x402-base',
    sourceReference: 'order:1',
    effectiveAt: createdAt,
    reasonCode: 'payment-settled',
    ...overrides,
  };
}

describe('commerce contracts', () => {
  it('parses exact product and offer contracts', () => {
    expect(parseCommerceProduct({
      schemaVersion: 1,
      productId: 'avatar:banana',
      revision: 1,
      kind: 'avatar',
      avatarRevisionIds: ['banana:revision:1'],
      state: 'active',
    }).productId).toBe('avatar:banana');
    expect(parseCommerceOffer({
      schemaVersion: 1,
      offerId: 'offer:banana',
      productId: 'avatar:banana',
      revision: 1,
      releaseProfiles: ['windows-direct'],
      regions: ['ZA', 'US'],
      priceBookId: 'prices:2026-q3',
      providers: ['x402-base'],
      startsAt: createdAt,
      endsAt: '2026-09-24T20:00:00.000Z',
      state: 'active',
    }).providers).toEqual(['x402-base']);
  });

  it('rejects unknown fields, duplicate revisions, and non-payment offer sources', () => {
    expect(() => parseCommerceProduct({
      schemaVersion: 1,
      productId: 'avatar:banana',
      revision: 1,
      kind: 'avatar',
      avatarRevisionIds: ['banana:revision:1'],
      state: 'active',
      price: 1,
    })).toThrow('Invalid commerce product');
    expect(() => parseCommerceProduct({
      schemaVersion: 1,
      productId: 'pack:fruit',
      revision: 1,
      kind: 'pack',
      avatarRevisionIds: ['banana:revision:1', 'banana:revision:1'],
      state: 'active',
    })).toThrow('avatar revision IDs');
    expect(() => parseCommerceOffer({
      schemaVersion: 1,
      offerId: 'offer:banana',
      productId: 'avatar:banana',
      revision: 1,
      releaseProfiles: ['windows-direct'],
      regions: ['ZA'],
      priceBookId: 'prices:2026-q3',
      providers: ['support'],
      startsAt: createdAt,
      state: 'active',
    })).toThrow('non-payment entitlement source');
  });

  it.each(['1.0', '01', '0', '-1', '1000000000000000000000000000000000000000'])(
    'rejects unsafe atomic amount %s',
    (amountAtomic) => expect(() => parseCommerceOrder(order({ amountAtomic })))
      .toThrow(/order (?:atomic )?amount/),
  );

  it('accepts only forward, idempotent order transitions', () => {
    const awaitingApproval = transitionCommerceOrder(
      parseCommerceOrder(order()),
      'awaiting-approval',
      '2026-08-24T20:00:01.000Z',
    );
    expect(transitionCommerceOrder(awaitingApproval, 'awaiting-approval', createdAt)).toBe(awaitingApproval);
    expect(transitionCommerceOrder(
      awaitingApproval,
      'awaiting-settlement',
      '2026-08-24T20:00:02.000Z',
    ).state).toBe('awaiting-settlement');
    expect(() => transitionCommerceOrder(
      awaitingApproval,
      'granted',
      '2026-08-24T20:00:02.000Z',
    )).toThrow('awaiting-approval -> granted');
  });

  it('parses and advances a payment attempt without skipping verification', () => {
    const created = parsePaymentAttempt(attempt());
    const submitted = transitionPaymentAttempt(created, 'submitted');
    expect(transitionPaymentAttempt(submitted, 'verified').state).toBe('verified');
    expect(() => transitionPaymentAttempt(created, 'settled')).toThrow('created -> settled');
    expect(() => parsePaymentAttempt(attempt({ provider: 'support' }))).toThrow('payment provider');
  });
});

describe('append-only entitlement projection', () => {
  it('projects a time-bound grant and expires it without mutating the ledger', () => {
    const grant = parseEntitlementEvent(entitlement({
      expiresAt: '2026-08-27T20:00:00.000Z',
    }));
    const ledger = appendEntitlementEvent([], grant);
    expect(projectEntitlement(ledger, 'account:1', 'avatar:banana', createdAt).status).toBe('granted');
    expect(projectEntitlement(
      ledger,
      'account:1',
      'avatar:banana',
      '2026-08-27T20:00:00.000Z',
    ).status).toBe('expired');
    expect(ledger).toHaveLength(1);
  });

  it('applies refund and later auditable support restore events in append order', () => {
    let ledger = appendEntitlementEvent([], entitlement());
    ledger = appendEntitlementEvent(ledger, entitlement({
      eventId: 'event:2',
      type: 'refund',
      sourceReference: 'refund:1',
      effectiveAt: '2026-08-24T21:00:00.000Z',
      reasonCode: 'provider-refund',
    }));
    expect(projectEntitlement(
      ledger,
      'account:1',
      'avatar:banana',
      '2026-08-24T21:01:00.000Z',
    ).status).toBe('not-granted');
    ledger = appendEntitlementEvent(ledger, entitlement({
      eventId: 'event:3',
      type: 'support-restore',
      source: 'support',
      sourceReference: 'case:123',
      effectiveAt: '2026-08-24T22:00:00.000Z',
      reasonCode: 'support-correction',
    }));
    expect(projectEntitlement(
      ledger,
      'account:1',
      'avatar:banana',
      '2026-08-24T22:01:00.000Z',
    )).toMatchObject({ status: 'granted', source: 'support', lastEventId: 'event:3' });
  });

  it('is idempotent for the exact same event and fails conflicting duplicates closed', () => {
    const first = entitlement();
    const ledger = appendEntitlementEvent([], first);
    expect(appendEntitlementEvent(ledger, first)).toEqual(ledger);
    expect(() => appendEntitlementEvent(ledger, entitlement({ reasonCode: 'changed' })))
      .toThrow('event ID collision');
    expect(() => appendEntitlementEvent(ledger, entitlement({ eventId: 'event:2' })))
      .toThrow('Duplicate entitlement source event');
  });

  it('rejects forged source/type combinations', () => {
    expect(() => parseEntitlementEvent(entitlement({
      type: 'support-restore',
      source: 'x402-base',
    }))).toThrow('Only support');
    expect(() => parseEntitlementEvent(entitlement({
      type: 'refund',
      source: 'free',
    }))).toThrow('payment provider');
  });
});

describe('release commerce policy', () => {
  it.each([
    ['direct', 'win32', 'windows-direct'],
    ['store', 'win32', 'windows-store'],
    ['direct', 'darwin', 'macos-direct'],
    ['store', 'darwin', 'macos-store'],
  ] as const)('keeps all paid providers unreachable for %s/%s', (distribution, platform, expected) => {
    const policy = resolveCommerceRuntimePolicy(distribution, platform);
    expect(policy.releaseProfile).toBe(expected);
    expect(policy.providers).toEqual({
      free: true,
      storekit: false,
      microsoft: false,
      'x402-base': false,
      'x402-solana': false,
      support: false,
    });
    expect(policy.productionPayments).toBe(false);
    expect(policy.externalCheckout).toBe(false);
  });

  it('fails closed on an unsupported release platform', () => {
    expect(() => resolveCommerceRuntimePolicy('direct', 'linux')).toThrow('unavailable');
  });
});
