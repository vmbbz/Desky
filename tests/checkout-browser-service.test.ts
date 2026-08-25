import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkoutTermsDigest } from '../src/main/commerce/checkout-coordinator';
import { BaseSepoliaCheckoutRuntime } from '../src/service/commerce/base-sepolia-checkout-runtime';
import {
  checkoutBrowserCookieName,
  HostedCheckoutBrowserService,
  type HostedCheckoutWalletRuntime,
} from '../src/service/commerce/checkout-browser-service';
import { HostedCommerceCheckoutService } from '../src/service/commerce/checkout-session-service';
import { SqliteCommerceLedger } from '../src/service/commerce/sqlite-commerce-ledger';
import type { X402CheckoutFacilitator } from '../src/service/commerce/x402-checkout-processor';
import {
  baseSepoliaNetwork,
  baseSepoliaUsdc,
  type X402BasePaymentPayload,
  type X402PaymentRequirements,
  type X402ResourceInfo,
} from '../src/service/commerce/x402-base-sepolia';
import type { CommerceOrder, VerifiedCommerceQuote } from '../src/shared/commerce';

const directories: string[] = [];
const origin = 'https://commerce.desky.example';
const merchant = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';
const payer = '0x857b06519E91e3A54538791bDbb0E22373e36b66';
const verifier = 'v'.repeat(43);
let clock = Date.parse('2026-08-25T10:00:00.000Z');

function ledger(): SqliteCommerceLedger {
  const directory = mkdtempSync(join(tmpdir(), 'desky-checkout-browser-'));
  directories.push(directory);
  return new SqliteCommerceLedger(join(directory, 'commerce.db'));
}

function quote(): VerifiedCommerceQuote {
  return {
    schemaVersion: 1, quoteId: 'quote:1', accountId: 'account:1', offerId: 'offer:1',
    offerRevision: 1, productId: 'avatar:banana', productRevision: 1,
    avatarRevisionIds: ['banana:revision:1'], catalogVersion: 'catalog:1',
    provider: 'x402-base', releaseProfile: 'windows-direct', region: 'ZA', currency: 'USDC',
    amountAtomic: '1250000', network: baseSepoliaNetwork, asset: baseSepoliaUsdc,
    recipient: merchant, issuedAt: '2026-08-25T09:59:30.000Z',
    expiresAt: '2026-08-25T10:04:00.000Z',
  };
}

function order(): CommerceOrder {
  return {
    schemaVersion: 1, orderId: 'order:1', quoteId: 'quote:1', accountId: 'account:1',
    offerId: 'offer:1', offerRevision: 1, idempotencyKey: 'order:1', currency: 'USDC',
    amountAtomic: '1250000', state: 'created', createdAt: '2026-08-25T09:59:40.000Z',
    updatedAt: '2026-08-25T09:59:40.000Z',
  };
}

function facilitator(settle: 'settled' | 'throw' = 'settled'): X402CheckoutFacilitator {
  return {
    verify: vi.fn(async () => ({ isValid: true, payer })),
    settle: vi.fn(async () => {
      if (settle === 'throw') throw new Error('connection lost after dispatch');
      return {
        success: true, payer, transaction: `0x${'33'.repeat(32)}`,
        network: baseSepoliaNetwork, amount: '1250000',
      };
    }),
  };
}

function policy() {
  return {
    merchantRecipient: merchant,
    resourceOrigin: origin,
    facilitatorBaseUrl: 'https://x402.org/facilitator',
  };
}

async function setup(store: SqliteCommerceLedger) {
  store.storeQuote(quote());
  store.createOrder(order());
  const admittedOrder = store.advanceOrder(
    'order:1',
    'awaiting-approval',
    '2026-08-25T09:59:41.000Z',
  );
  const checkout = new HostedCommerceCheckoutService(store, {
    authenticate: async () => ({ accountId: 'account:1', installationId: 'install:1' }),
  }, {
    checkoutOrigin: origin,
    now: () => new Date(clock),
    sessionId: () => 'checkout:1',
  });
  await checkout.createSession({
    schemaVersion: 1, approvalId: 'approval:1', accountId: 'account:1',
    installationId: 'install:1', orderId: 'order:1', quoteId: 'quote:1',
    termsDigest: checkoutTermsDigest(quote(), admittedOrder),
    approvedAt: new Date(clock).toISOString(),
    approvalExpiresAt: '2026-08-25T10:02:00.000Z', idempotencyKey: 'checkout:1',
    browserBindingChallenge: createHash('sha256').update(verifier).digest('base64url'),
  }, 't'.repeat(32));
  return checkout;
}

function secretSource(values: string[] = ['c', 's', 'l', 'r', 'n']): () => string {
  const queue = [...values];
  return () => (queue.shift() ?? 'z').repeat(43);
}

function context(cookie?: string, csrfToken?: string) {
  return { origin, cookie, csrfToken, secFetchSite: 'same-origin' };
}

function cookieFrom(header: string): string {
  const value = header.match(new RegExp(`^${checkoutBrowserCookieName}=([^;]+);`))?.[1];
  if (!value) throw new Error('missing test cookie');
  return `${checkoutBrowserCookieName}=${value}`;
}

function payment(
  requirements: X402PaymentRequirements,
  resource: X402ResourceInfo,
): X402BasePaymentPayload {
  const nowSeconds = Math.floor(clock / 1_000);
  return {
    x402Version: 2, resource, accepted: requirements,
    payload: {
      signature: `0x${'11'.repeat(65)}`,
      authorization: {
        from: payer, to: merchant, value: requirements.amount,
        validAfter: String(nowSeconds - 10), validBefore: String(nowSeconds + 60),
        nonce: `0x${'22'.repeat(32)}`,
      },
    },
  };
}

afterEach(() => {
  clock = Date.parse('2026-08-25T10:00:00.000Z');
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('hosted checkout browser service', () => {
  it('binds the browser, settles exact payment, projects status, and persists no raw secret', async () => {
    const store = ledger();
    await setup(store);
    const remote = facilitator();
    const runtime = new BaseSepoliaCheckoutRuntime(store, remote, policy());
    const browser = new HostedCheckoutBrowserService(store, runtime, {
      checkoutOrigin: origin, now: () => new Date(clock), secret: secretSource(),
    });
    const bootstrap = await browser.bootstrap({
      schemaVersion: 1, checkoutSessionId: 'checkout:1', bindingVerifier: verifier,
    }, context());
    expect(bootstrap.session.state).toBe('awaiting-wallet');
    expect(store.getPaymentAttempt('attempt:checkout:1')).toBeUndefined();
    expect(store.getOrder('order:1')?.state).toBe('awaiting-approval');
    expect(bootstrap.setCookie).toContain('Secure; HttpOnly; SameSite=Strict');
    expect(bootstrap.setCookie).not.toContain('Domain=');
    const cookie = cookieFrom(bootstrap.setCookie!);
    const signed = payment(bootstrap.paymentRequirements, bootstrap.resource);
    const submitted = await browser.submit({
      schemaVersion: 1, checkoutSessionId: 'checkout:1', submissionId: 'submission:1',
      paymentPayload: signed,
    }, context(cookie, bootstrap.csrfToken));
    expect(submitted.session.state).toBe('settled');
    expect(submitted.session.settlementObservationId).toBe('observation:result:attempt:checkout:1');
    expect(store.listSettlementObservations('authorization:attempt:checkout:1')
      .map((entry) => entry.status)).toEqual(['unknown', 'settled']);
    const durable = JSON.stringify(store.getCheckoutSession('checkout:1'));
    expect(durable).not.toContain(verifier);
    expect(durable).not.toContain(signed.payload.signature);
    expect(durable).not.toContain(cookie.split('=')[1]);
    expect(durable).not.toContain(bootstrap.csrfToken);
    expect(durable).toContain('payloadDigest');

    const desktop = new HostedCommerceCheckoutService(store, {
      authenticate: async () => ({ accountId: 'account:1', installationId: 'install:1' }),
    }, { checkoutOrigin: origin, now: () => new Date(clock), projector: browser });
    expect((await desktop.getSession({
      schemaVersion: 1, checkoutSessionId: 'checkout:1', installationId: 'install:1',
    }, 't'.repeat(32))).state).toBe('settled');
    expect(remote.settle).toHaveBeenCalledTimes(1);
    store.close();
  });

  it('rejects cross-site bootstrap, wrong verifier, duplicate cookie, and stale CSRF', async () => {
    const store = ledger();
    await setup(store);
    const browser = new HostedCheckoutBrowserService(
      store,
      new BaseSepoliaCheckoutRuntime(store, facilitator(), policy()),
      { checkoutOrigin: origin, now: () => new Date(clock), secret: secretSource() },
    );
    await expect(browser.bootstrap({
      schemaVersion: 1, checkoutSessionId: 'checkout:1', bindingVerifier: verifier,
    }, { ...context(), origin: 'https://evil.example' })).rejects.toThrow('authentication-failed');
    await expect(browser.bootstrap({
      schemaVersion: 1, checkoutSessionId: 'checkout:1', bindingVerifier: 'x'.repeat(43),
    }, context())).rejects.toThrow('authentication-failed');
    const bootstrap = await browser.bootstrap({
      schemaVersion: 1, checkoutSessionId: 'checkout:1', bindingVerifier: verifier,
    }, context());
    const cookie = cookieFrom(bootstrap.setCookie!);
    await expect(browser.resume({ schemaVersion: 1, checkoutSessionId: 'checkout:1' }, context(
      `${cookie}; ${cookie}`,
    ))).rejects.toThrow('authentication-failed');
    await expect(browser.submit({
      schemaVersion: 1, checkoutSessionId: 'checkout:1', submissionId: 'submission:1',
      paymentPayload: payment(bootstrap.paymentRequirements, bootstrap.resource),
    }, context(cookie, 'x'.repeat(43)))).rejects.toThrow('authentication-failed');
    store.close();
  });

  it('survives lost settle response and restart without issuing a second settle call', async () => {
    const store = ledger();
    await setup(store);
    const firstRemote = facilitator('throw');
    const first = new HostedCheckoutBrowserService(
      store,
      new BaseSepoliaCheckoutRuntime(store, firstRemote, policy()),
      { checkoutOrigin: origin, now: () => new Date(clock), secret: secretSource() },
    );
    const bootstrap = await first.bootstrap({
      schemaVersion: 1, checkoutSessionId: 'checkout:1', bindingVerifier: verifier,
    }, context());
    const cookie = cookieFrom(bootstrap.setCookie!);
    const result = await first.submit({
      schemaVersion: 1, checkoutSessionId: 'checkout:1', submissionId: 'submission:1',
      paymentPayload: payment(bootstrap.paymentRequirements, bootstrap.resource),
    }, context(cookie, bootstrap.csrfToken));
    expect(result.session.state).toBe('settlement-unknown');

    const secondRemote = facilitator();
    const restarted = new HostedCheckoutBrowserService(
      store,
      new BaseSepoliaCheckoutRuntime(store, secondRemote, policy()),
      { checkoutOrigin: origin, now: () => new Date(clock), secret: secretSource(['q']) },
    );
    const resumed = await restarted.resume({
      schemaVersion: 1, checkoutSessionId: 'checkout:1',
    }, context(cookie));
    expect(resumed.session.state).toBe('settlement-unknown');
    expect(firstRemote.settle).toHaveBeenCalledTimes(1);
    expect(secondRemote.settle).not.toHaveBeenCalled();
    store.close();
  });

  it('reclaims an expired pre-processing lease only for the exact signed payload', async () => {
    const store = ledger();
    await setup(store);
    const actual = new BaseSepoliaCheckoutRuntime(store, facilitator(), policy());
    let crash = true;
    const crashing: HostedCheckoutWalletRuntime = {
      prepare: (...args) => actual.prepare(...args),
      admitPayment: (...args) => actual.admitPayment(...args),
      project: (...args) => actual.project(...args),
      process: async (...args) => {
        if (crash) throw new Error('crash before processor entry');
        return actual.process(...args);
      },
    };
    const browser = new HostedCheckoutBrowserService(store, crashing, {
      checkoutOrigin: origin, now: () => new Date(clock), secret: secretSource(),
    });
    const bootstrap = await browser.bootstrap({
      schemaVersion: 1, checkoutSessionId: 'checkout:1', bindingVerifier: verifier,
    }, context());
    const cookie = cookieFrom(bootstrap.setCookie!);
    const signed = payment(bootstrap.paymentRequirements, bootstrap.resource);
    const submission = {
      schemaVersion: 1, checkoutSessionId: 'checkout:1', submissionId: 'submission:1',
      paymentPayload: signed,
    };
    await expect(browser.submit(submission, context(cookie, bootstrap.csrfToken)))
      .rejects.toThrow('crash before processor');
    expect(store.getCheckoutSession('checkout:1')?.session.state).toBe('signature-submitted');
    clock += 16_000;
    crash = false;
    expect((await browser.submit(submission, context(cookie, bootstrap.csrfToken))).session.state)
      .toBe('settled');
    store.close();
  });
});
