import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

import type { CommerceOrder, VerifiedCommerceQuote } from '../../shared/commerce';
import {
  canonicalCommerceCheckoutTerms,
  parseCommerceCheckoutSession,
  parseCommerceCheckoutSessionRequest,
  parseCreateCommerceCheckoutRequest,
  type CommerceCheckoutSession,
  type CommerceCheckoutSessionRequest,
  type CreateCommerceCheckoutRequest,
} from '../../shared/commerce-checkout';
import { CommerceServiceError, type CommerceCheckoutApplicationService } from './http-api';

export interface CommerceCheckoutIdentity {
  accountId: string;
  installationId: string;
}

export interface CommerceCheckoutAuthenticator {
  authenticate(accessToken: string): Promise<CommerceCheckoutIdentity>;
}

export interface CommerceCheckoutSessionRecord {
  request: CreateCommerceCheckoutRequest;
  session: CommerceCheckoutSession;
  updatedAt: string;
}

type Awaitable<T> = T | Promise<T>;

export interface CommerceCheckoutSessionStore {
  getQuote(quoteId: string): Awaitable<VerifiedCommerceQuote | undefined>;
  getOrder(orderId: string): Awaitable<CommerceOrder | undefined>;
  getCheckoutSession(checkoutSessionId: string): Awaitable<CommerceCheckoutSessionRecord | undefined>;
  getCheckoutSessionByApproval(approvalId: string): Awaitable<CommerceCheckoutSessionRecord | undefined>;
  getCheckoutSessionByIdempotency(
    accountId: string,
    idempotencyKey: string,
  ): Awaitable<CommerceCheckoutSessionRecord | undefined>;
  insertCheckoutSession(
    record: CommerceCheckoutSessionRecord,
  ): Awaitable<'inserted' | 'exact-replay'>;
  updateCheckoutSession(
    expected: CommerceCheckoutSessionRecord,
    next: CommerceCheckoutSessionRecord,
  ): Awaitable<void>;
}

function exactRecord(value: unknown): CommerceCheckoutSessionRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid commerce checkout session record.');
  }
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((field) => !['request', 'session', 'updatedAt'].includes(field))
    || typeof source.updatedAt !== 'string') {
    throw new Error('Invalid commerce checkout session record.');
  }
  const updated = Date.parse(source.updatedAt);
  const session = parseCommerceCheckoutSession(source.session);
  const request = parseCreateCommerceCheckoutRequest(source.request);
  if (!Number.isFinite(updated) || new Date(updated).toISOString() !== source.updatedAt
    || request.approvalId !== session.approvalId
    || request.accountId !== session.accountId
    || request.installationId !== session.installationId
    || request.orderId !== session.orderId
    || request.quoteId !== session.quoteId
    || updated < Date.parse(session.createdAt)) {
    throw new Error('Invalid commerce checkout session record.');
  }
  return { request, session, updatedAt: source.updatedAt };
}

export function parseCommerceCheckoutSessionRecord(value: unknown): CommerceCheckoutSessionRecord {
  return exactRecord(value);
}

function normalizeOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Commerce checkout origin is invalid.'); }
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) {
    throw new Error('Commerce checkout requires an exact HTTPS origin.');
  }
  return value;
}

function digestMatches(expected: string, actual: string): boolean {
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(actual, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function sameCreateRequest(
  left: CreateCommerceCheckoutRequest,
  right: CreateCommerceCheckoutRequest,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class HostedCommerceCheckoutService implements CommerceCheckoutApplicationService {
  private readonly origin: string;

  constructor(
    private readonly store: CommerceCheckoutSessionStore,
    private readonly authenticator: CommerceCheckoutAuthenticator,
    options: {
      checkoutOrigin: string;
      now?: () => Date;
      sessionId?: () => string;
    },
  ) {
    this.origin = normalizeOrigin(options.checkoutOrigin);
    this.now = options.now ?? (() => new Date());
    this.sessionId = options.sessionId ?? (() => `checkout:${randomUUID()}`);
  }

  private readonly now: () => Date;
  private readonly sessionId: () => string;

  async createSession(
    value: CreateCommerceCheckoutRequest,
    accessToken: string,
  ): Promise<CommerceCheckoutSession> {
    const request = parseCreateCommerceCheckoutRequest(value);
    const identity = await this.authenticator.authenticate(accessToken);
    this.assertIdentity(identity, request.accountId, request.installationId);
    const now = this.exactNow();
    if (Date.parse(request.approvedAt) > Date.parse(now) + 60_000
      || Date.parse(request.approvalExpiresAt) <= Date.parse(now)) {
      throw new Error('Invalid commerce checkout approval window.');
    }
    const replay = await this.store.getCheckoutSessionByIdempotency(
      request.accountId,
      request.idempotencyKey,
    );
    if (replay) {
      const admitted = parseCommerceCheckoutSessionRecord(replay);
      if (!sameCreateRequest(admitted.request, request)) throw new CommerceServiceError('conflict');
      return admitted.session;
    }
    if (await this.store.getCheckoutSessionByApproval(request.approvalId)) {
      throw new CommerceServiceError('conflict');
    }
    const [quote, order] = await Promise.all([
      this.store.getQuote(request.quoteId),
      this.store.getOrder(request.orderId),
    ]);
    if (!quote || !order
      || quote.accountId !== identity.accountId || order.accountId !== identity.accountId
      || quote.provider !== 'x402-base' || quote.releaseProfile !== 'windows-direct'
      || order.state !== 'awaiting-approval' || order.quoteId !== quote.quoteId
      || order.offerId !== quote.offerId || order.offerRevision !== quote.offerRevision
      || order.currency !== quote.currency || order.amountAtomic !== quote.amountAtomic
      || Date.parse(quote.expiresAt) <= Date.parse(now)) {
      throw new CommerceServiceError('conflict');
    }
    const expectedDigest = createHash('sha256')
      .update(canonicalCommerceCheckoutTerms(quote, order))
      .digest('base64url');
    if (!digestMatches(expectedDigest, request.termsDigest)) {
      throw new CommerceServiceError('conflict');
    }
    const checkoutSessionId = this.sessionId();
    const expiresAt = new Date(Math.min(
      Date.parse(now) + 10 * 60_000,
      Date.parse(request.approvalExpiresAt),
      Date.parse(quote.expiresAt),
    )).toISOString();
    const session = parseCommerceCheckoutSession({
      schemaVersion: 1,
      checkoutSessionId,
      approvalId: request.approvalId,
      accountId: request.accountId,
      installationId: request.installationId,
      orderId: request.orderId,
      quoteId: request.quoteId,
      checkoutUrl: `${this.origin}/checkout/${encodeURIComponent(checkoutSessionId)}`,
      createdAt: now,
      expiresAt,
      state: 'ready',
    });
    const record = parseCommerceCheckoutSessionRecord({ request, session, updatedAt: now });
    const inserted = await this.store.insertCheckoutSession(record);
    if (inserted === 'exact-replay') {
      const stored = await this.store.getCheckoutSession(checkoutSessionId);
      if (!stored) throw new CommerceServiceError('conflict');
      return parseCommerceCheckoutSessionRecord(stored).session;
    }
    return session;
  }

  async getSession(
    value: CommerceCheckoutSessionRequest,
    accessToken: string,
  ): Promise<CommerceCheckoutSession> {
    const request = parseCommerceCheckoutSessionRequest(value);
    const identity = await this.authenticator.authenticate(accessToken);
    const record = await this.expireIfNeeded(await this.requireSession(request.checkoutSessionId));
    this.assertIdentity(identity, record.session.accountId, request.installationId);
    if (record.session.installationId !== request.installationId) {
      throw new CommerceServiceError('authentication-failed');
    }
    return record.session;
  }

  async cancelSession(
    value: CommerceCheckoutSessionRequest,
    accessToken: string,
  ): Promise<CommerceCheckoutSession> {
    const request = parseCommerceCheckoutSessionRequest(value);
    const identity = await this.authenticator.authenticate(accessToken);
    const record = await this.expireIfNeeded(await this.requireSession(request.checkoutSessionId));
    this.assertIdentity(identity, record.session.accountId, request.installationId);
    if (record.session.installationId !== request.installationId) {
      throw new CommerceServiceError('authentication-failed');
    }
    if (record.session.state === 'cancelled') return record.session;
    if (!['ready', 'awaiting-wallet'].includes(record.session.state)) {
      throw new CommerceServiceError('conflict');
    }
    const now = this.exactNow();
    const next = parseCommerceCheckoutSessionRecord({
      ...record,
      session: { ...record.session, state: 'cancelled' },
      updatedAt: now,
    });
    await this.store.updateCheckoutSession(record, next);
    return next.session;
  }

  private exactNow(): string {
    const date = this.now();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
      throw new Error('Invalid commerce checkout service time.');
    }
    return date.toISOString();
  }

  private assertIdentity(
    identity: CommerceCheckoutIdentity,
    accountId: string,
    installationId: string,
  ): void {
    if (identity.accountId !== accountId || identity.installationId !== installationId) {
      throw new CommerceServiceError('authentication-failed');
    }
  }

  private async requireSession(checkoutSessionId: string): Promise<CommerceCheckoutSessionRecord> {
    const record = await this.store.getCheckoutSession(checkoutSessionId);
    if (!record) throw new CommerceServiceError('authentication-failed');
    return parseCommerceCheckoutSessionRecord(record);
  }

  private async expireIfNeeded(
    record: CommerceCheckoutSessionRecord,
  ): Promise<CommerceCheckoutSessionRecord> {
    if (!['ready', 'awaiting-wallet'].includes(record.session.state)
      || Date.parse(record.session.expiresAt) > this.now().getTime()) return record;
    const updatedAt = this.exactNow();
    const expired = parseCommerceCheckoutSessionRecord({
      ...record,
      session: { ...record.session, state: 'expired' },
      updatedAt,
    });
    await this.store.updateCheckoutSession(record, expired);
    return expired;
  }
}
