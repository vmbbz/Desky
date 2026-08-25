import { describe, expect, it } from 'vitest';

import {
  parseCommerceBrowserBootstrapRequest,
  parseCommerceBrowserCheckoutView,
  parseCommerceBrowserPaymentSubmission,
} from '../src/shared/commerce-checkout-browser';

describe('hosted checkout browser contracts', () => {
  it('admits exact one-time bootstrap and payment submission envelopes', () => {
    expect(parseCommerceBrowserBootstrapRequest({
      schemaVersion: 1,
      checkoutSessionId: 'checkout:1',
      bindingVerifier: 'v'.repeat(43),
    })).toEqual({
      schemaVersion: 1,
      checkoutSessionId: 'checkout:1',
      bindingVerifier: 'v'.repeat(43),
    });
    expect(parseCommerceBrowserPaymentSubmission({
      schemaVersion: 1,
      checkoutSessionId: 'checkout:1',
      submissionId: 'submission:1',
      paymentPayload: { x402Version: 2 },
    })).toEqual({
      schemaVersion: 1,
      checkoutSessionId: 'checkout:1',
      submissionId: 'submission:1',
      paymentPayload: { x402Version: 2 },
    });
  });

  it('rejects unknown fields, malformed secrets, and scalar payment payloads', () => {
    expect(() => parseCommerceBrowserBootstrapRequest({
      schemaVersion: 1,
      checkoutSessionId: 'checkout:1',
      bindingVerifier: 'short',
    })).toThrow('binding verifier');
    expect(() => parseCommerceBrowserPaymentSubmission({
      schemaVersion: 1,
      checkoutSessionId: 'checkout:1',
      submissionId: 'submission:1',
      paymentPayload: 'signature',
    })).toThrow('payment submission');
    expect(() => parseCommerceBrowserPaymentSubmission({
      schemaVersion: 1,
      checkoutSessionId: 'checkout:1',
      submissionId: 'submission:1',
      paymentPayload: {},
      walletKey: 'never',
    })).toThrow();
  });

  it('strictly parses the public authoritative checkout view', () => {
    const view = {
      schemaVersion: 1,
      checkoutSessionId: 'checkout:1',
      productId: 'avatar:banana',
      avatarRevisionIds: ['banana:revision:1'],
      currency: 'USDC',
      amountAtomic: '1250000',
      network: 'eip155:84532',
      networkName: 'Base Sepolia',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      recipient: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
      expiresAt: '2026-08-25T10:02:00.000Z',
    };
    expect(parseCommerceBrowserCheckoutView(view)).toEqual(view);
    expect(() => parseCommerceBrowserCheckoutView({ ...view, networkName: 'Base Mainnet' }))
      .toThrow();
    expect(() => parseCommerceBrowserCheckoutView({
      ...view,
      avatarRevisionIds: ['banana:revision:1', 'banana:revision:1'],
    })).toThrow('avatar revisions');
  });
});
