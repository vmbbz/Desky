import { describe, expect, it } from 'vitest';

import {
  parsePaymentAuthorizationEvidence,
  parsePaymentSettlementObservation,
  settlementStatusCanAdvance,
} from '../src/shared/commerce-settlement';

const authorization = {
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
  verifiedAt: '2026-08-25T01:00:00.000Z',
  authorizationExpiresAt: '2026-08-25T01:04:00.000Z',
};

function observation(status: 'unknown' | 'pending' | 'settled' | 'failed') {
  return {
    schemaVersion: 1,
    observationId: `observation:${status}`,
    authorizationId: 'authorization:1',
    attemptId: 'attempt:1',
    orderId: 'order:1',
    quoteId: 'quote:1',
    provider: 'x402-base',
    status,
    source: 'facilitator-reconciliation',
    payer: authorization.payer,
    paymentIdentifier: authorization.paymentIdentifier,
    network: authorization.network,
    asset: authorization.asset,
    recipient: authorization.recipient,
    amountAtomic: authorization.amountAtomic,
    providerReference: status === 'pending' || status === 'settled' ? 'tx:base:1' : undefined,
    observedAt: '2026-08-25T01:00:30.000Z',
    settledAt: status === 'settled' ? '2026-08-25T01:00:20.000Z' : undefined,
    reasonCode: status,
    reconciliationId: `reconcile:${status}`,
  };
}

describe('commerce settlement contracts', () => {
  it('strictly parses separate payment authorization evidence', () => {
    expect(parsePaymentAuthorizationEvidence(authorization)).toEqual(authorization);
    expect(() => parsePaymentAuthorizationEvidence({ ...authorization, extra: true })).toThrow();
    expect(() => parsePaymentAuthorizationEvidence({ ...authorization, provider: 'free' })).toThrow();
    expect(() => parsePaymentAuthorizationEvidence({
      ...authorization,
      authorizationExpiresAt: authorization.verifiedAt,
    })).toThrow('expires before');
  });

  it.each(['unknown', 'pending', 'settled', 'failed'] as const)(
    'strictly parses a %s observation',
    (status) => {
      expect(parsePaymentSettlementObservation(observation(status))).toEqual(observation(status));
    },
  );

  it('requires a reference for pending/settled but forbids one for unknown', () => {
    expect(() => parsePaymentSettlementObservation({
      ...observation('pending'), providerReference: undefined,
    })).toThrow('requires a provider reference');
    expect(() => parsePaymentSettlementObservation({
      ...observation('unknown'), providerReference: 'tx:base:1',
    })).toThrow('cannot claim');
    expect(() => parsePaymentSettlementObservation({
      ...observation('settled'), settledAt: undefined,
    })).toThrow('settlement time');
    expect(() => parsePaymentSettlementObservation({
      ...observation('pending'), settledAt: '2026-08-25T01:00:20.000Z',
    })).toThrow('settlement time');
  });

  it('rejects unknown fields, zero/float amounts, and malformed timestamps', () => {
    expect(() => parsePaymentSettlementObservation({
      ...observation('settled'), walletSecret: 'never',
    })).toThrow();
    expect(() => parsePaymentSettlementObservation({
      ...observation('settled'), amountAtomic: '1.5',
    })).toThrow('atomic amount');
    expect(() => parsePaymentSettlementObservation({
      ...observation('settled'), observedAt: 'tomorrow',
    })).toThrow('observation time');
  });

  it('allows only monotonic settlement projections', () => {
    expect(settlementStatusCanAdvance(undefined, 'unknown')).toBe(true);
    expect(settlementStatusCanAdvance('unknown', 'pending')).toBe(true);
    expect(settlementStatusCanAdvance('unknown', 'settled')).toBe(true);
    expect(settlementStatusCanAdvance('pending', 'settled')).toBe(true);
    expect(settlementStatusCanAdvance('pending', 'unknown')).toBe(false);
    expect(settlementStatusCanAdvance('settled', 'pending')).toBe(false);
    expect(settlementStatusCanAdvance('settled', 'settled')).toBe(false);
    expect(settlementStatusCanAdvance('failed', 'settled')).toBe(false);
  });
});
