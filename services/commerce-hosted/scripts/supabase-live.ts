import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import type { PaymentAttempt, VerifiedCommerceQuote, CommerceOrder } from '../../../src/shared/commerce';
import type {
  PaymentAuthorizationEvidence,
  PaymentSettlementObservation,
} from '../../../src/shared/commerce-settlement';
import { PostgresCheckoutLedger } from '../../../src/service/commerce/postgres-checkout-ledger';
import { supabasePoolConfiguration } from '../src/database-config';
import { PgPoolBridge } from '../src/pg-pool-bridge';

function ledger(): PostgresCheckoutLedger {
  return new PostgresCheckoutLedger(new PgPoolBridge(new Pool({
    ...supabasePoolConfiguration(),
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 5_000,
    application_name: 'desky-commerce-verification',
  })));
}

const runId = `verification:${Date.now()}:${randomUUID()}`;
const now = Date.now();
const issuedAt = new Date(now - 30_000).toISOString();
const createdAt = new Date(now - 20_000).toISOString();
const approvedAt = new Date(now - 19_000).toISOString();
const verifiedAt = new Date(now - 10_000).toISOString();
const observedAt = new Date(now - 5_000).toISOString();
const expiresAt = new Date(now + 240_000).toISOString();
const authorizationExpiresAt = new Date(now + 120_000).toISOString();
const suffix = randomUUID().replaceAll('-', '');
const merchant = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';
const payer = '0x857b06519E91e3A54538791bDbb0E22373e36b66';
const quoteId = `quote:${runId}`;
const orderId = `order:${runId}`;
const attemptId = `attempt:${runId}`;
const authorizationId = `authorization:${runId}`;

const quote: VerifiedCommerceQuote = {
  schemaVersion: 1,
  quoteId,
  accountId: `account:${runId}`,
  offerId: 'offer:verification',
  offerRevision: 1,
  productId: 'avatar:verification',
  productRevision: 1,
  avatarRevisionIds: ['avatar:verification:1'],
  catalogVersion: 'catalog:verification',
  provider: 'x402-base',
  releaseProfile: 'windows-direct',
  region: 'ZA',
  currency: 'USDC',
  amountAtomic: '1',
  network: 'eip155:84532',
  asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7c',
  recipient: merchant,
  issuedAt,
  expiresAt,
};
const order: CommerceOrder = {
  schemaVersion: 1,
  orderId,
  quoteId,
  accountId: quote.accountId,
  offerId: quote.offerId,
  offerRevision: quote.offerRevision,
  idempotencyKey: runId,
  currency: quote.currency,
  amountAtomic: quote.amountAtomic,
  state: 'created',
  createdAt,
  updatedAt: createdAt,
};
const attempt: PaymentAttempt = {
  schemaVersion: 1,
  attemptId,
  orderId,
  quoteId,
  provider: quote.provider,
  network: quote.network,
  asset: quote.asset,
  recipient: quote.recipient,
  quoteExpiresAt: quote.expiresAt,
  state: 'created',
};
const authorization: PaymentAuthorizationEvidence = {
  schemaVersion: 1,
  authorizationId,
  attemptId,
  orderId,
  quoteId,
  provider: quote.provider,
  payer,
  paymentIdentifier: `0x${suffix.padEnd(64, '0').slice(0, 64)}`,
  network: quote.network,
  asset: quote.asset,
  recipient: quote.recipient,
  amountAtomic: quote.amountAtomic,
  verifiedAt,
  authorizationExpiresAt,
};
const dispatch: PaymentSettlementObservation = {
  schemaVersion: 1,
  observationId: `observation:dispatch:${runId}`,
  authorizationId,
  attemptId,
  orderId,
  quoteId,
  provider: quote.provider,
  status: 'unknown',
  source: 'facilitator-response',
  payer,
  paymentIdentifier: authorization.paymentIdentifier,
  network: quote.network,
  asset: quote.asset,
  recipient: quote.recipient,
  amountAtomic: quote.amountAtomic,
  observedAt,
  reasonCode: 'settlement-dispatching',
  reconciliationId: `reconcile:dispatch:${runId}`,
};

const first = ledger();
const second = ledger();
try {
  const health = await first.healthCheck();
  await first.storeQuote(quote);
  await first.createOrder(order);
  await first.advanceOrder(orderId, 'awaiting-approval', approvedAt);
  await first.prepareCheckoutPayment(orderId, attempt, new Date(now - 18_000).toISOString());
  await first.verifyPaymentAuthorization(authorization);

  const claims = await Promise.all([
    first.claimSettlementDispatch(dispatch),
    second.claimSettlementDispatch(dispatch),
  ]);
  const dispositions = claims.map((claim) => claim.claimed).sort();
  if (JSON.stringify(dispositions) !== JSON.stringify([false, true])) {
    throw new Error('Multi-instance settlement dispatch exclusion failed.');
  }
  const persisted = await second.getLatestSettlementObservation(authorizationId);
  if (persisted?.reasonCode !== 'settlement-dispatching') {
    throw new Error('The settlement dispatch claim did not persist across instances.');
  }

  process.stdout.write(`${JSON.stringify({
    status: 'ok',
    projectRef: process.env.DESKY_SUPABASE_PROJECT_REF,
    migrationVersion: health.migrationVersion,
    writable: health.writable,
    dispatchClaims: dispositions,
    persistedStatus: persisted.status,
    runId,
  })}\n`);
} finally {
  await Promise.allSettled([first.close(), second.close()]);
}
