import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  parseCommerceBrowserBootstrapRequest,
  parseCommerceBrowserCheckoutView,
  parseCommerceBrowserPaymentSubmission,
  parseCommerceBrowserResumeRequest,
  parseCommerceBrowserSecret,
  type CommerceBrowserCheckoutView,
  type CommerceBrowserPaymentSubmission,
} from '../../shared/commerce-checkout-browser';
import {
  parseCommerceCheckoutSession,
  type CommerceCheckoutSession,
  type CommerceCheckoutState,
} from '../../shared/commerce-checkout';
import type { PaymentSettlementObservation } from '../../shared/commerce-settlement';
import type { PaymentAttempt } from '../../shared/commerce';
import type {
  X402BasePaymentPayload,
  X402PaymentRequirements,
  X402ResourceInfo,
} from './x402-base-sepolia';
import type { ProcessX402CheckoutResult } from './x402-checkout-processor';
import {
  CommerceServiceError,
} from './http-api';
import {
  parseCommerceCheckoutSessionRecord,
  type CommerceCheckoutSessionRecord,
  type CommerceCheckoutSessionStore,
} from './checkout-session-service';

export const checkoutBrowserCookieName = '__Host-desky-checkout';

export interface CommerceBrowserRequestContext {
  origin: string | undefined;
  cookie: string | undefined;
  csrfToken?: string;
  secFetchSite?: string;
}

export interface PreparedBrowserCheckout {
  attemptId: string;
  attempt: PaymentAttempt;
  view: CommerceBrowserCheckoutView;
  paymentRequirements: X402PaymentRequirements;
  resource: X402ResourceInfo;
}

export interface AdmittedBrowserPayment {
  payload: X402BasePaymentPayload;
  payloadDigest: string;
}

export interface CheckoutRuntimeProjection {
  state: Extract<
    CommerceCheckoutState,
    'signature-submitted' | 'authorization-verified' | 'settlement-unknown'
      | 'settlement-pending' | 'settled' | 'failed'
  >;
  settlementObservationId?: string;
  grantId?: string;
}

export interface HostedCheckoutWalletRuntime {
  prepare(
    record: CommerceCheckoutSessionRecord,
    now: string,
  ): Promise<PreparedBrowserCheckout>;
  admitPayment(
    prepared: PreparedBrowserCheckout,
    paymentPayload: unknown,
    now: string,
  ): AdmittedBrowserPayment;
  process(
    prepared: PreparedBrowserCheckout,
    payment: AdmittedBrowserPayment,
    now: string,
  ): Promise<ProcessX402CheckoutResult>;
  project(record: CommerceCheckoutSessionRecord): Promise<CheckoutRuntimeProjection | undefined>;
}

export interface CommerceBrowserCheckoutMaterial {
  schemaVersion: 1;
  session: CommerceCheckoutSession;
  csrfToken: string;
  view: CommerceBrowserCheckoutView;
  paymentRequirements: X402PaymentRequirements;
  resource: X402ResourceInfo;
  setCookie?: string;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

function digestMatches(expected: string, value: string): boolean {
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(digest(value), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function canonicalPayloadDigest(value: X402BasePaymentPayload): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('base64url');
}

function cookieCredential(value: string | undefined): string | undefined {
  if (!value || value.length > 4_096 || /[\r\n]/.test(value)) return undefined;
  const matches = value.split(';').map((part) => part.trim()).filter(Boolean)
    .filter((part) => part.startsWith(`${checkoutBrowserCookieName}=`));
  if (matches.length !== 1) return undefined;
  const [name, credential, ...remainder] = matches[0].split('=');
  if (name !== checkoutBrowserCookieName || remainder.length > 0) return undefined;
  try { return parseCommerceBrowserSecret(credential, 'cookie credential'); } catch { return undefined; }
}

function projectionFromResult(result: ProcessX402CheckoutResult): CheckoutRuntimeProjection {
  if (result.kind === 'verification-unavailable') return { state: 'signature-submitted' };
  if (result.kind === 'verification-rejected') return { state: 'failed' };
  return projectionFromObservation(result.observation);
}

function projectionFromObservation(
  observation: PaymentSettlementObservation,
): CheckoutRuntimeProjection {
  return {
    state: observation.status === 'unknown'
      ? 'settlement-unknown'
      : observation.status === 'pending'
        ? 'settlement-pending'
        : observation.status,
    settlementObservationId: observation.observationId,
  };
}

/** Hosted-only browser boundary. It never enters Electron's import graph. */
export class HostedCheckoutBrowserService {
  private readonly origin: string;
  private readonly secret: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly store: CommerceCheckoutSessionStore,
    private readonly runtime: HostedCheckoutWalletRuntime,
    options: {
      checkoutOrigin: string;
      now?: () => Date;
      secret?: () => string;
    },
  ) {
    const origin = new URL(options.checkoutOrigin);
    if (origin.protocol !== 'https:' || origin.origin !== options.checkoutOrigin
      || origin.username || origin.password) {
      throw new Error('Hosted checkout browser requires an exact HTTPS origin.');
    }
    this.origin = options.checkoutOrigin;
    this.now = options.now ?? (() => new Date());
    this.secret = options.secret ?? (() => randomBytes(32).toString('base64url'));
  }

  async bootstrap(
    value: unknown,
    context: CommerceBrowserRequestContext,
  ): Promise<CommerceBrowserCheckoutMaterial> {
    const request = parseCommerceBrowserBootstrapRequest(value);
    this.assertSameOrigin(context);
    const record = await this.requireOpenRecord(request.checkoutSessionId, ['ready']);
    if (record.browser || !digestMatches(
      record.request.browserBindingChallenge,
      request.bindingVerifier,
    )) {
      throw new CommerceServiceError('authentication-failed');
    }
    const now = this.exactNow();
    const prepared = await this.runtime.prepare(record, now);
    this.assertPrepared(record, prepared);
    const cookie = this.newSecret('cookie credential');
    const csrf = this.newSecret('CSRF token');
    const next = parseCommerceCheckoutSessionRecord({
      ...record,
      attemptId: prepared.attemptId,
      browser: {
        credentialDigest: digest(cookie),
        csrfDigest: digest(csrf),
        establishedAt: now,
        expiresAt: record.session.expiresAt,
      },
      session: { ...record.session, state: 'awaiting-wallet' },
      updatedAt: now,
    });
    await this.store.updateCheckoutSession(record, next);
    const maximumAge = Math.max(1, Math.floor(
      (Date.parse(next.session.expiresAt) - Date.parse(now)) / 1_000,
    ));
    return this.material(next, prepared, csrf,
      `${checkoutBrowserCookieName}=${cookie}; Path=/; Max-Age=${maximumAge}; Secure; HttpOnly; SameSite=Strict`);
  }

  async resume(
    value: unknown,
    context: CommerceBrowserRequestContext,
  ): Promise<CommerceBrowserCheckoutMaterial> {
    const request = parseCommerceBrowserResumeRequest(value);
    this.assertSameOrigin(context);
    let record = await this.requireBoundRecord(request.checkoutSessionId, context.cookie);
    record = await this.applyRuntimeProjection(record);
    if (['failed', 'expired', 'cancelled'].includes(record.session.state)) {
      throw new CommerceServiceError('conflict');
    }
    const prepared = await this.runtime.prepare(record, this.exactNow());
    this.assertPrepared(record, prepared);
    const csrf = this.newSecret('CSRF token');
    const next = parseCommerceCheckoutSessionRecord({
      ...record,
      browser: { ...record.browser!, csrfDigest: digest(csrf) },
      updatedAt: this.exactNow(),
    });
    await this.store.updateCheckoutSession(record, next);
    return this.material(next, prepared, csrf);
  }

  async submit(
    value: unknown,
    context: CommerceBrowserRequestContext,
  ): Promise<CommerceBrowserCheckoutMaterial> {
    const request = parseCommerceBrowserPaymentSubmission(value);
    this.assertSameOrigin(context);
    let record = await this.requireBoundRecord(request.checkoutSessionId, context.cookie);
    this.assertCsrf(record, context.csrfToken);
    record = await this.applyRuntimeProjection(record);
    if (!['awaiting-wallet', 'signature-submitted'].includes(record.session.state)) {
      throw new CommerceServiceError('conflict');
    }
    const now = this.exactNow();
    const prepared = await this.runtime.prepare(record, now);
    this.assertPrepared(record, prepared);
    const admitted = this.runtime.admitPayment(prepared, request.paymentPayload, now);
    if (admitted.payloadDigest !== canonicalPayloadDigest(admitted.payload)) {
      throw new Error('Hosted checkout runtime returned a non-canonical payment digest.');
    }

    let ownsLease = false;
    if (!record.submission) {
      record = await this.claimSubmission(record, request, admitted.payloadDigest, now);
      ownsLease = true;
    } else if (record.submission.submissionId !== request.submissionId
      || record.submission.payloadDigest !== admitted.payloadDigest) {
      throw new CommerceServiceError('conflict');
    } else if (Date.parse(record.submission.leaseExpiresAt) <= Date.parse(now)) {
      record = await this.reclaimSubmission(record, now);
      ownsLease = true;
    }

    if (ownsLease) {
      const result = await this.runtime.process(prepared, admitted, now);
      record = await this.applyProjection(record, projectionFromResult(result));
    } else {
      record = await this.applyRuntimeProjection(record);
      return this.material(
        record,
        prepared,
        parseCommerceBrowserSecret(context.csrfToken, 'CSRF token'),
      );
    }
    const csrf = this.newSecret('CSRF token');
    const rotated = parseCommerceCheckoutSessionRecord({
      ...record,
      browser: { ...record.browser!, csrfDigest: digest(csrf) },
      updatedAt: this.exactNow(),
    });
    await this.store.updateCheckoutSession(record, rotated);
    return this.material(rotated, prepared, csrf);
  }

  async project(record: CommerceCheckoutSessionRecord): Promise<CommerceCheckoutSessionRecord> {
    return this.applyRuntimeProjection(parseCommerceCheckoutSessionRecord(record));
  }

  private async claimSubmission(
    record: CommerceCheckoutSessionRecord,
    request: CommerceBrowserPaymentSubmission,
    payloadDigest: string,
    now: string,
  ): Promise<CommerceCheckoutSessionRecord> {
    const leaseExpiresAt = new Date(Math.min(
      Date.parse(record.session.expiresAt),
      Date.parse(now) + 15_000,
    )).toISOString();
    if (Date.parse(leaseExpiresAt) <= Date.parse(now)) throw new CommerceServiceError('conflict');
    const next = parseCommerceCheckoutSessionRecord({
      ...record,
      submission: {
        submissionId: request.submissionId,
        payloadDigest,
        receivedAt: now,
        leaseId: `lease:${this.newSecret('submission lease').slice(0, 32).toLowerCase()}`,
        leaseExpiresAt,
      },
      session: { ...record.session, state: 'signature-submitted' },
      updatedAt: now,
    });
    await this.store.updateCheckoutSession(record, next);
    return next;
  }

  private async reclaimSubmission(
    record: CommerceCheckoutSessionRecord,
    now: string,
  ): Promise<CommerceCheckoutSessionRecord> {
    const leaseExpiresAt = new Date(Math.min(
      Date.parse(record.session.expiresAt),
      Date.parse(now) + 15_000,
    )).toISOString();
    if (Date.parse(leaseExpiresAt) <= Date.parse(now)) throw new CommerceServiceError('conflict');
    const next = parseCommerceCheckoutSessionRecord({
      ...record,
      submission: {
        ...record.submission!,
        leaseId: `lease:${this.newSecret('submission lease').slice(0, 32).toLowerCase()}`,
        leaseExpiresAt,
      },
      updatedAt: now,
    });
    await this.store.updateCheckoutSession(record, next);
    return next;
  }

  private async applyRuntimeProjection(
    record: CommerceCheckoutSessionRecord,
  ): Promise<CommerceCheckoutSessionRecord> {
    const projection = await this.runtime.project(record);
    return projection ? this.applyProjection(record, projection) : record;
  }

  private async applyProjection(
    record: CommerceCheckoutSessionRecord,
    projection: CheckoutRuntimeProjection,
  ): Promise<CommerceCheckoutSessionRecord> {
    if (record.session.state === projection.state
      && record.session.settlementObservationId === projection.settlementObservationId
      && record.session.grantId === projection.grantId) return record;
    const next = parseCommerceCheckoutSessionRecord({
      ...record,
      session: parseCommerceCheckoutSession({
        ...record.session,
        state: projection.state,
        settlementObservationId: projection.settlementObservationId,
        grantId: projection.grantId,
      }),
      updatedAt: this.exactNow(),
    });
    await this.store.updateCheckoutSession(record, next);
    return next;
  }

  private material(
    record: CommerceCheckoutSessionRecord,
    prepared: PreparedBrowserCheckout,
    csrfToken: string,
    setCookie?: string,
  ): CommerceBrowserCheckoutMaterial {
    return {
      schemaVersion: 1,
      session: record.session,
      csrfToken,
      view: parseCommerceBrowserCheckoutView(prepared.view),
      paymentRequirements: structuredClone(prepared.paymentRequirements),
      resource: structuredClone(prepared.resource),
      setCookie,
    };
  }

  private async requireOpenRecord(
    checkoutSessionId: string,
    states: CommerceCheckoutState[],
  ): Promise<CommerceCheckoutSessionRecord> {
    const record = await this.store.getCheckoutSession(checkoutSessionId);
    if (!record) throw new CommerceServiceError('authentication-failed');
    const admitted = parseCommerceCheckoutSessionRecord(record);
    if (Date.parse(admitted.session.expiresAt) <= Date.parse(this.exactNow())
      || !states.includes(admitted.session.state)) throw new CommerceServiceError('conflict');
    return admitted;
  }

  private async requireBoundRecord(
    checkoutSessionId: string,
    cookie: string | undefined,
  ): Promise<CommerceCheckoutSessionRecord> {
    const credential = cookieCredential(cookie);
    const record = await this.store.getCheckoutSession(checkoutSessionId);
    if (!credential || !record) throw new CommerceServiceError('authentication-failed');
    const admitted = parseCommerceCheckoutSessionRecord(record);
    if (!admitted.browser || !digestMatches(admitted.browser.credentialDigest, credential)
      || Date.parse(admitted.browser.expiresAt) <= Date.parse(this.exactNow())) {
      throw new CommerceServiceError('authentication-failed');
    }
    return admitted;
  }

  private assertCsrf(record: CommerceCheckoutSessionRecord, value: string | undefined): void {
    let csrf: string;
    try { csrf = parseCommerceBrowserSecret(value, 'CSRF token'); } catch {
      throw new CommerceServiceError('authentication-failed');
    }
    if (!record.browser || !digestMatches(record.browser.csrfDigest, csrf)) {
      throw new CommerceServiceError('authentication-failed');
    }
  }

  private assertSameOrigin(context: CommerceBrowserRequestContext): void {
    if (context.origin !== this.origin || context.secFetchSite !== 'same-origin') {
      throw new CommerceServiceError('authentication-failed');
    }
  }

  private assertPrepared(
    record: CommerceCheckoutSessionRecord,
    prepared: PreparedBrowserCheckout,
  ): void {
    if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(prepared.attemptId)
      || prepared.attempt.attemptId !== prepared.attemptId
      || prepared.attempt.orderId !== record.session.orderId
      || prepared.attempt.quoteId !== record.session.quoteId
      || (record.attemptId && record.attemptId !== prepared.attemptId)
      || prepared.view.checkoutSessionId !== record.session.checkoutSessionId
      || prepared.view.expiresAt !== record.session.expiresAt
      || prepared.view.amountAtomic !== prepared.paymentRequirements.amount
      || prepared.view.network !== prepared.paymentRequirements.network
      || prepared.view.asset.toLowerCase() !== prepared.paymentRequirements.asset.toLowerCase()
      || prepared.view.recipient.toLowerCase() !== prepared.paymentRequirements.payTo.toLowerCase()
      || new URL(prepared.resource.url).origin !== this.origin) {
      throw new Error('Hosted checkout runtime crossed session identity.');
    }
  }

  private exactNow(): string {
    const date = this.now();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
      throw new Error('Hosted checkout browser time is invalid.');
    }
    return date.toISOString();
  }

  private newSecret(field: string): string {
    return parseCommerceBrowserSecret(this.secret(), field);
  }
}
