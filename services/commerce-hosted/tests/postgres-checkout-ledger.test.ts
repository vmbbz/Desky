import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { newDb } from 'pg-mem';
import { describe, expect, it, vi } from 'vitest';

import { canonicalCommerceCheckoutTerms } from '../../../src/shared/commerce-checkout';
import type { CommerceOrder, VerifiedCommerceQuote } from '../../../src/shared/commerce';
import { HostedCommerceCheckoutService } from '../../../src/service/commerce/checkout-session-service';
import { HostedCheckoutBrowserService } from '../../../src/service/commerce/checkout-browser-service';
import { BaseSepoliaCheckoutRuntime } from '../../../src/service/commerce/base-sepolia-checkout-runtime';
import {
  PostgresCheckoutLedger,
  type PostgresPool,
} from '../../../src/service/commerce/postgres-checkout-ledger';
import { HostedPaidGrantService } from '../../../src/service/commerce/paid-grant-service';
import {
  baseSepoliaNetwork,
  baseSepoliaUsdc,
  type X402PaymentRequirements,
  type X402ResourceInfo,
} from '../../../src/service/commerce/x402-base-sepolia';
import type { X402CheckoutFacilitator } from '../../../src/service/commerce/x402-checkout-processor';

const origin = 'https://desky-checkout-testnet.netlify.app';
const merchant = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';
const payer = '0x857b06519E91e3A54538791bDbb0E22373e36b66';
const now = '2026-08-25T10:00:00.000Z';
const verifier = 'v'.repeat(43);
const hostedRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(hostedRoot, '..', '..');

function quote(): VerifiedCommerceQuote {
  return {
    schemaVersion: 1, quoteId: 'quote:postgres:1', accountId: 'account:1',
    offerId: 'offer:banana', offerRevision: 1, productId: 'avatar:banana', productRevision: 1,
    avatarRevisionIds: ['banana:revision:1'], catalogVersion: 'catalog:1',
    provider: 'x402-base', releaseProfile: 'windows-direct', region: 'ZA', currency: 'USDC',
    amountAtomic: '1250000', network: baseSepoliaNetwork, asset: baseSepoliaUsdc,
    recipient: merchant, issuedAt: '2026-08-25T09:59:30.000Z',
    expiresAt: '2026-08-25T10:04:00.000Z',
  };
}

function order(): CommerceOrder {
  return {
    schemaVersion: 1, orderId: 'order:postgres:1', quoteId: 'quote:postgres:1',
    accountId: 'account:1', offerId: 'offer:banana', offerRevision: 1,
    idempotencyKey: 'order:postgres:1', currency: 'USDC', amountAtomic: '1250000',
    state: 'created', createdAt: '2026-08-25T09:59:40.000Z',
    updatedAt: '2026-08-25T09:59:40.000Z',
  };
}

async function ledger(): Promise<{
  store: PostgresCheckoutLedger;
  pool: { query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> };
}> {
  const memory = newDb();
  const migration = await readFile(resolve(repositoryRoot,
    'supabase/migrations/20260825000100_checkout_ledger.sql',
  ), 'utf8');
  // pg-mem does not implement PostgreSQL role or GRANT/REVOKE DDL. The deployment-boundary
  // suite asserts those exact statements, while this suite exercises the same schema and ledger.
  const pgMemMigration = migration.split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement
      && !/^(?:CREATE ROLE|GRANT|REVOKE)\b/.test(statement))
    .join(';\n');
  memory.public.none(`${pgMemMigration};`);
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool();
  return {
    store: new PostgresCheckoutLedger(pool as unknown as PostgresPool),
    pool,
  };
}

function facilitator(): X402CheckoutFacilitator {
  return {
    verify: vi.fn(async () => ({ isValid: true, payer })),
    settle: vi.fn(async () => ({
      success: true,
      payer,
      transaction: `0x${'33'.repeat(32)}`,
      network: baseSepoliaNetwork,
      amount: '1250000',
    })),
  };
}

function payment(requirements: X402PaymentRequirements, resource: X402ResourceInfo) {
  const nowSeconds = Math.floor(Date.parse(now) / 1_000);
  return {
    x402Version: 2,
    resource,
    accepted: requirements,
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

describe('hosted PostgreSQL checkout ledger', () => {
  it('expires bounded quote-only orders while preserving orders with checkout sessions', async () => {
    const { store } = await ledger();
    await store.storeQuote(quote());
    await store.createOrder(order());
    expect(await store.expireUnstartedOrders('2026-08-25T10:03:59.999Z')).toBe(0);
    expect(await store.expireUnstartedOrders('2026-08-25T10:05:00.000Z')).toBe(1);
    expect((await store.getOrder(order().orderId))?.state).toBe('expired');
    expect(await store.expireUnstartedOrders('2026-08-25T10:06:00.000Z')).toBe(0);
    await expect(store.expireUnstartedOrders('2026-08-25T10:06:00.000Z', 101))
      .rejects.toThrow('expiry policy');
    await store.close();
  });

  it('expires idle checkout sessions and their orders without touching settlement states', async () => {
    const { store } = await ledger();
    await store.storeQuote(quote());
    await store.createOrder(order());
    const approved = await store.advanceOrder(
      order().orderId, 'awaiting-approval', '2026-08-25T09:59:41.000Z',
    );
    const checkout = new HostedCommerceCheckoutService(store, {
      authenticate: async () => ({ accountId: 'account:1', installationId: 'install:1' }),
    }, { checkoutOrigin: origin, now: () => new Date(now), sessionId: () => 'checkout:postgres:idle' });
    await checkout.createSession({
      schemaVersion: 1, approvalId: 'approval:postgres:idle', accountId: 'account:1',
      installationId: 'install:1', orderId: order().orderId, quoteId: quote().quoteId,
      termsDigest: createHash('sha256')
        .update(canonicalCommerceCheckoutTerms(quote(), approved)).digest('base64url'),
      approvedAt: now, approvalExpiresAt: '2026-08-25T10:02:00.000Z',
      idempotencyKey: 'checkout:postgres:idle', browserBindingChallenge: 'b'.repeat(43),
    }, 't'.repeat(32));
    expect(await store.expireIdleCheckoutSessions('2026-08-25T10:01:59.999Z')).toBe(0);
    expect(await store.expireIdleCheckoutSessions('2026-08-25T10:02:00.000Z')).toBe(1);
    expect((await store.getCheckoutSession('checkout:postgres:idle'))?.session.state).toBe('expired');
    expect((await store.getOrder(order().orderId))?.state).toBe('expired');
    expect(await store.expireIdleCheckoutSessions('2026-08-25T10:03:00.000Z')).toBe(0);
    await expect(store.expireIdleCheckoutSessions('2026-08-25T10:03:00.000Z', 101))
      .rejects.toThrow('expiry policy');
    await store.close();
  });

  it('runs the real checkout-to-settlement path durably without storing browser secrets', async () => {
    const { store, pool } = await ledger();
    await store.storeQuote(quote());
    await store.createOrder(order());
    const approved = await store.advanceOrder(
      order().orderId, 'awaiting-approval', '2026-08-25T09:59:41.000Z',
    );
    const checkout = new HostedCommerceCheckoutService(store, {
      authenticate: async () => ({ accountId: 'account:1', installationId: 'install:1' }),
    }, { checkoutOrigin: origin, now: () => new Date(now), sessionId: () => 'checkout:postgres:1' });
    await checkout.createSession({
      schemaVersion: 1, approvalId: 'approval:postgres:1', accountId: 'account:1',
      installationId: 'install:1', orderId: order().orderId, quoteId: quote().quoteId,
      termsDigest: createHash('sha256')
        .update(canonicalCommerceCheckoutTerms(quote(), approved)).digest('base64url'),
      approvedAt: now, approvalExpiresAt: '2026-08-25T10:02:00.000Z',
      idempotencyKey: 'checkout:postgres:1',
      browserBindingChallenge: createHash('sha256').update(verifier).digest('base64url'),
    }, 't'.repeat(32));

    const remote = facilitator();
    const browser = new HostedCheckoutBrowserService(
      store,
      new BaseSepoliaCheckoutRuntime(store, remote, {
        merchantRecipient: merchant,
        resourceOrigin: origin,
        facilitatorBaseUrl: 'https://x402.org/facilitator',
      }),
      { checkoutOrigin: origin, now: () => new Date(now), secret: () => 's'.repeat(43) },
    );
    const opened = await browser.bootstrap({
      schemaVersion: 1, checkoutSessionId: 'checkout:postgres:1', bindingVerifier: verifier,
    }, { origin, secFetchSite: 'same-origin', cookie: undefined });
    const cookie = opened.setCookie?.match(/^(__Host-desky-checkout=[^;]+)/)?.[1];
    expect(cookie).toBeTruthy();
    const completed = await browser.submit({
      schemaVersion: 1, checkoutSessionId: 'checkout:postgres:1',
      submissionId: 'submission:postgres:1',
      paymentPayload: payment(opened.paymentRequirements, opened.resource),
    }, { origin, secFetchSite: 'same-origin', cookie, csrfToken: opened.csrfToken });

    expect(completed.session.state).toBe('settled');
    expect(await store.expireIdleCheckoutSessions('2026-08-25T10:10:00.000Z')).toBe(0);
    expect((await store.getOrder(order().orderId))?.state).toBe('awaiting-settlement');
    expect((await store.getPaymentAttempt('attempt:checkout:postgres:1'))?.state).toBe('settled');
    expect(remote.settle).toHaveBeenCalledTimes(1);
    const settled = await store.getLatestSettlementObservation(
      'authorization:attempt:checkout:postgres:1',
    );
    expect(settled?.status).toBe('settled');
    await new HostedPaidGrantService(store).commitSettlement(settled!);
    expect((await store.getOrder(order().orderId))?.state).toBe('granted');
    expect(await store.listReconciliationCandidates(25)).toEqual([]);
    expect(await store.listAssetGrants('account:1')).toEqual([
      expect.objectContaining({
        productId: 'avatar:banana', avatarRevisionIds: ['banana:revision:1'], state: 'active',
      }),
    ]);
    expect((await store.healthCheck()).migrationVersion).toBe(1);

    const durable = await pool.query(`
      SELECT payload_text FROM (
        SELECT payload_text FROM desky_commerce.commerce_checkout_sessions
        UNION ALL SELECT payload_text FROM desky_commerce.payment_attempts
        UNION ALL SELECT payload_text FROM desky_commerce.payment_authorizations
        UNION ALL SELECT payload_text FROM desky_commerce.settlement_observations
      ) AS durable_records
    `);
    const stored = durable.rows.map((row) => String(
      (row as { payload_text?: unknown }).payload_text ?? '',
    )).join('');
    expect(stored).not.toContain(verifier);
    expect(stored).not.toContain(`0x${'11'.repeat(65)}`);
    expect(stored).not.toContain(opened.csrfToken);
    expect(stored).not.toContain(cookie?.split('=')[1]);
    await store.close();
  });

  it('rejects checkout session collisions instead of overwriting durable identity', async () => {
    const { store } = await ledger();
    await store.storeQuote(quote());
    await store.createOrder(order());
    await store.advanceOrder(order().orderId, 'awaiting-approval', '2026-08-25T09:59:41.000Z');
    const checkout = new HostedCommerceCheckoutService(store, {
      authenticate: async () => ({ accountId: 'account:1', installationId: 'install:1' }),
    }, { checkoutOrigin: origin, now: () => new Date(now), sessionId: () => 'checkout:postgres:1' });
    const request = {
      schemaVersion: 1 as const, approvalId: 'approval:postgres:1', accountId: 'account:1',
      installationId: 'install:1', orderId: order().orderId, quoteId: quote().quoteId,
      termsDigest: createHash('sha256').update(canonicalCommerceCheckoutTerms(
        quote(), (await store.getOrder(order().orderId))!,
      )).digest('base64url'),
      approvedAt: now, approvalExpiresAt: '2026-08-25T10:02:00.000Z',
      idempotencyKey: 'checkout:postgres:1', browserBindingChallenge: 'b'.repeat(43),
    };
    await checkout.createSession(request, 't'.repeat(32));
    await expect(checkout.createSession({
      ...request, browserBindingChallenge: 'c'.repeat(43),
    }, 't'.repeat(32))).rejects.toThrow('conflict');
    await store.close();
  });
});
