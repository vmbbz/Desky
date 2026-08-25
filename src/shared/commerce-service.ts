import { parseCommerceOrder, parseVerifiedCommerceQuote, type CommerceOrder, type VerifiedCommerceQuote } from './commerce';
import { parseCommerceSessionMaterial, type CommerceSessionMaterial } from './commerce-recovery';

export interface CommerceIdentitySessionRequest {
  schemaVersion: 1;
  installationId: string;
  proofKeyChallenge: string;
  idempotencyKey: string;
}

export interface CommerceIdentitySessionResponse {
  schemaVersion: 1;
  recoveryCode: string;
  recoveryCodeExpiresAt: string;
  session: CommerceSessionMaterial;
}

export interface CommerceQuoteRequest {
  schemaVersion: 1;
  installationId: string;
  offerId: string;
  region: string;
  idempotencyKey: string;
}

export interface CommerceQuoteResponse {
  schemaVersion: 1;
  quote: VerifiedCommerceQuote;
  order: CommerceOrder;
}

const idPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const credentialPattern = /^[A-Za-z0-9_-]{43}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const regionPattern = /^[A-Z]{2}$/;

function exact(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid commerce service ${name}.`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((field) => !fields.includes(field))) {
    throw new Error(`Invalid commerce service ${name}.`);
  }
  return record;
}

function id(value: unknown, field: string): string {
  if (typeof value !== 'string' || !idPattern.test(value)) {
    throw new Error(`Invalid commerce service ${field}.`);
  }
  return value;
}

function credential(value: unknown, field: string): string {
  if (typeof value !== 'string' || !credentialPattern.test(value)) {
    throw new Error(`Invalid commerce service ${field}.`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !timestampPattern.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Invalid commerce service ${field}.`);
  }
  return value;
}

export function parseCommerceIdentitySessionRequest(value: unknown): CommerceIdentitySessionRequest {
  const source = exact(value, ['schemaVersion', 'installationId', 'proofKeyChallenge', 'idempotencyKey'], 'identity request');
  if (source.schemaVersion !== 1) throw new Error('Invalid commerce service identity request.');
  return {
    schemaVersion: 1,
    installationId: id(source.installationId, 'installation ID'),
    proofKeyChallenge: credential(source.proofKeyChallenge, 'proof-key challenge'),
    idempotencyKey: id(source.idempotencyKey, 'idempotency key'),
  };
}

export function parseCommerceIdentitySessionResponse(value: unknown): CommerceIdentitySessionResponse {
  const source = exact(value, ['schemaVersion', 'recoveryCode', 'recoveryCodeExpiresAt', 'session'], 'identity response');
  if (source.schemaVersion !== 1) throw new Error('Invalid commerce service identity response.');
  const session = parseCommerceSessionMaterial(source.session);
  const recoveryCodeExpiresAt = timestamp(source.recoveryCodeExpiresAt, 'recovery expiry');
  if (Date.parse(recoveryCodeExpiresAt) <= session.serverTimeSeconds * 1_000) {
    throw new Error('Invalid commerce service recovery expiry.');
  }
  return {
    schemaVersion: 1,
    recoveryCode: credential(source.recoveryCode, 'recovery code'),
    recoveryCodeExpiresAt,
    session,
  };
}

export function parseCommerceQuoteRequest(value: unknown): CommerceQuoteRequest {
  const source = exact(value, ['schemaVersion', 'installationId', 'offerId', 'region', 'idempotencyKey'], 'quote request');
  if (source.schemaVersion !== 1) throw new Error('Invalid commerce service quote request.');
  if (typeof source.region !== 'string' || !regionPattern.test(source.region)) {
    throw new Error('Invalid commerce service quote region.');
  }
  return {
    schemaVersion: 1,
    installationId: id(source.installationId, 'installation ID'),
    offerId: id(source.offerId, 'offer ID'),
    region: source.region,
    idempotencyKey: id(source.idempotencyKey, 'idempotency key'),
  };
}

export function parseCommerceQuoteResponse(value: unknown): CommerceQuoteResponse {
  const source = exact(value, ['schemaVersion', 'quote', 'order'], 'quote response');
  if (source.schemaVersion !== 1) throw new Error('Invalid commerce service quote response.');
  const quote = parseVerifiedCommerceQuote(source.quote);
  const order = parseCommerceOrder(source.order);
  if (order.quoteId !== quote.quoteId || order.accountId !== quote.accountId
    || order.offerId !== quote.offerId || order.offerRevision !== quote.offerRevision
    || order.currency !== quote.currency || order.amountAtomic !== quote.amountAtomic) {
    throw new Error('Invalid commerce service quote consistency.');
  }
  return { schemaVersion: 1, quote, order };
}
