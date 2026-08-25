import { describe, expect, it } from 'vitest';

import {
  parseCommerceCheckoutSession,
  parseCommerceCheckoutSessionRequest,
  parseCreateCommerceCheckoutRequest,
} from '../src/shared/commerce-checkout';

const creation = {
  schemaVersion: 1,
  approvalId: 'approval:1',
  accountId: 'account:1',
  installationId: 'install:1',
  orderId: 'order:1',
  quoteId: 'quote:1',
  termsDigest: 'a'.repeat(43),
  approvedAt: '2026-08-25T10:00:00.000Z',
  approvalExpiresAt: '2026-08-25T10:02:00.000Z',
  idempotencyKey: 'checkout:1',
} as const;

const session = {
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
} as const;

describe('commerce checkout contracts', () => {
  it('admits exact short-lived approval and status requests', () => {
    expect(parseCreateCommerceCheckoutRequest(creation)).toEqual(creation);
    expect(parseCommerceCheckoutSessionRequest({
      schemaVersion: 1,
      checkoutSessionId: 'checkout:1',
      installationId: 'install:1',
    })).toEqual({
      schemaVersion: 1,
      checkoutSessionId: 'checkout:1',
      installationId: 'install:1',
    });
  });

  it('rejects approval inflation, unknown fields, and malformed digests', () => {
    expect(() => parseCreateCommerceCheckoutRequest({
      ...creation,
      approvalExpiresAt: '2026-08-25T10:02:00.001Z',
    })).toThrow('lifetime');
    expect(() => parseCreateCommerceCheckoutRequest({ ...creation, walletSecret: 'never' }))
      .toThrow();
    expect(() => parseCreateCommerceCheckoutRequest({ ...creation, termsDigest: 'no' }))
      .toThrow();
  });

  it('admits only same-origin-safe session-shaped URLs and consistent terminal state', () => {
    expect(parseCommerceCheckoutSession(session)).toEqual(session);
    expect(() => parseCommerceCheckoutSession({
      ...session,
      checkoutUrl: 'https://user:secret@commerce.desky.example/checkout/checkout%3A1',
    })).toThrow('URL');
    expect(() => parseCommerceCheckoutSession({
      ...session,
      checkoutUrl: `${session.checkoutUrl}?token=secret`,
    })).toThrow('URL');
    expect(() => parseCommerceCheckoutSession({ ...session, state: 'settled' }))
      .toThrow('consistency');
    expect(() => parseCommerceCheckoutSession({ ...session, grantId: 'grant:1' }))
      .toThrow('consistency');
  });
});
