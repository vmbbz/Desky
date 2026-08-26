import {
  parseCommerceOrder,
  parseVerifiedCommerceQuote,
  type CommerceOrder,
  type VerifiedCommerceQuote,
} from './commerce';

export const commerceCheckoutStates = [
  'ready', 'awaiting-wallet', 'signature-submitted', 'authorization-verified', 'settlement-unknown',
  'settlement-pending', 'settled', 'failed', 'expired', 'cancelled',
] as const;
export type CommerceCheckoutState = (typeof commerceCheckoutStates)[number];

export interface CreateCommerceCheckoutRequest {
  schemaVersion: 1;
  approvalId: string;
  accountId: string;
  installationId: string;
  orderId: string;
  quoteId: string;
  termsDigest: string;
  approvedAt: string;
  approvalExpiresAt: string;
  idempotencyKey: string;
  browserBindingChallenge: string;
}

export interface CommerceCheckoutSessionRequest {
  schemaVersion: 1;
  checkoutSessionId: string;
  installationId: string;
}

export interface CommerceCheckoutSession {
  schemaVersion: 1;
  checkoutSessionId: string;
  approvalId: string;
  accountId: string;
  installationId: string;
  orderId: string;
  quoteId: string;
  checkoutUrl: string;
  createdAt: string;
  expiresAt: string;
  state: CommerceCheckoutState;
  settlementObservationId?: string;
  grantId?: string;
}

export function canonicalCommerceCheckoutTerms(
  quoteValue: VerifiedCommerceQuote,
  orderValue: CommerceOrder,
): string {
  const quote = parseVerifiedCommerceQuote(quoteValue);
  const order = parseCommerceOrder(orderValue);
  return JSON.stringify({
    quoteId: quote.quoteId,
    orderId: order.orderId,
    accountId: quote.accountId,
    offerId: quote.offerId,
    offerRevision: quote.offerRevision,
    productId: quote.productId,
    productRevision: quote.productRevision,
    avatarRevisionIds: [...quote.avatarRevisionIds],
    catalogVersion: quote.catalogVersion,
    releaseProfile: quote.releaseProfile,
    region: quote.region,
    provider: quote.provider,
    currency: quote.currency,
    amountAtomic: quote.amountAtomic,
    network: quote.network,
    asset: quote.asset,
    recipient: quote.recipient,
    quoteExpiresAt: quote.expiresAt,
  });
}

const identifierPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const digestPattern = /^[A-Za-z0-9_-]{43}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function exactRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid commerce checkout ${name}.`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((field) => !fields.includes(field))) {
    throw new Error(`Invalid commerce checkout ${name}.`);
  }
  return record;
}

function readIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !identifierPattern.test(value)) {
    throw new Error(`Invalid commerce checkout ${field}.`);
  }
  return value;
}

function readTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !timestampPattern.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Invalid commerce checkout ${field}.`);
  }
  return value;
}

export function parseCreateCommerceCheckoutRequest(value: unknown): CreateCommerceCheckoutRequest {
  const source = exactRecord(value, [
    'schemaVersion', 'approvalId', 'accountId', 'installationId', 'orderId', 'quoteId',
    'termsDigest', 'approvedAt', 'approvalExpiresAt', 'idempotencyKey',
    'browserBindingChallenge',
  ], 'creation request');
  if (source.schemaVersion !== 1 || typeof source.termsDigest !== 'string'
    || !digestPattern.test(source.termsDigest)
    || typeof source.browserBindingChallenge !== 'string'
    || !digestPattern.test(source.browserBindingChallenge)) {
    throw new Error('Invalid commerce checkout creation request.');
  }
  const request: CreateCommerceCheckoutRequest = {
    schemaVersion: 1,
    approvalId: readIdentifier(source.approvalId, 'approval ID'),
    accountId: readIdentifier(source.accountId, 'account ID'),
    installationId: readIdentifier(source.installationId, 'installation ID'),
    orderId: readIdentifier(source.orderId, 'order ID'),
    quoteId: readIdentifier(source.quoteId, 'quote ID'),
    termsDigest: source.termsDigest,
    approvedAt: readTimestamp(source.approvedAt, 'approval time'),
    approvalExpiresAt: readTimestamp(source.approvalExpiresAt, 'approval expiry'),
    idempotencyKey: readIdentifier(source.idempotencyKey, 'idempotency key'),
    browserBindingChallenge: source.browserBindingChallenge,
  };
  if (Date.parse(request.approvalExpiresAt) <= Date.parse(request.approvedAt)
    || Date.parse(request.approvalExpiresAt) - Date.parse(request.approvedAt) > 2 * 60 * 1_000) {
    throw new Error('Invalid commerce checkout approval lifetime.');
  }
  return request;
}

export function parseCommerceCheckoutSessionRequest(value: unknown): CommerceCheckoutSessionRequest {
  const source = exactRecord(value, [
    'schemaVersion', 'checkoutSessionId', 'installationId',
  ], 'session request');
  if (source.schemaVersion !== 1) throw new Error('Invalid commerce checkout session request.');
  return {
    schemaVersion: 1,
    checkoutSessionId: readIdentifier(source.checkoutSessionId, 'session ID'),
    installationId: readIdentifier(source.installationId, 'installation ID'),
  };
}

export function parseCommerceCheckoutSession(value: unknown): CommerceCheckoutSession {
  const source = exactRecord(value, [
    'schemaVersion', 'checkoutSessionId', 'approvalId', 'accountId', 'installationId',
    'orderId', 'quoteId', 'checkoutUrl', 'createdAt', 'expiresAt', 'state',
    'settlementObservationId', 'grantId',
  ], 'session');
  if (source.schemaVersion !== 1 || typeof source.state !== 'string'
    || !commerceCheckoutStates.includes(source.state as CommerceCheckoutState)
    || typeof source.checkoutUrl !== 'string' || source.checkoutUrl.length > 2_048) {
    throw new Error('Invalid commerce checkout session.');
  }
  let url: URL;
  try {
    url = new URL(source.checkoutUrl);
  } catch {
    throw new Error('Invalid commerce checkout URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid commerce checkout URL.');
  }
  const session: CommerceCheckoutSession = {
    schemaVersion: 1,
    checkoutSessionId: readIdentifier(source.checkoutSessionId, 'session ID'),
    approvalId: readIdentifier(source.approvalId, 'approval ID'),
    accountId: readIdentifier(source.accountId, 'account ID'),
    installationId: readIdentifier(source.installationId, 'installation ID'),
    orderId: readIdentifier(source.orderId, 'order ID'),
    quoteId: readIdentifier(source.quoteId, 'quote ID'),
    checkoutUrl: url.toString(),
    createdAt: readTimestamp(source.createdAt, 'creation time'),
    expiresAt: readTimestamp(source.expiresAt, 'expiry'),
    state: source.state as CommerceCheckoutState,
    settlementObservationId: source.settlementObservationId === undefined
      ? undefined : readIdentifier(source.settlementObservationId, 'settlement observation ID'),
    grantId: source.grantId === undefined ? undefined : readIdentifier(source.grantId, 'grant ID'),
  };
  if (Date.parse(session.expiresAt) <= Date.parse(session.createdAt)
    || Date.parse(session.expiresAt) - Date.parse(session.createdAt) > 10 * 60 * 1_000
    || (session.state === 'settled' && !session.settlementObservationId)
    || (session.grantId && session.state !== 'settled')) {
    throw new Error('Commerce checkout session consistency failed.');
  }
  return session;
}
