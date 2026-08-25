import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { verifyCommerceAccessToken, type CommerceAccessTokenClaims } from '../../main/commerce/access-token';
import type { MarketplaceAvatar } from '../../shared/avatar-marketplace';
import {
  parseCleanDeviceRestoreRequest,
  parseCommerceSessionRefreshRequest,
  type CleanDeviceRestoreRequest,
  type CommerceSessionMaterial,
  type CommerceSessionRefreshRequest,
} from '../../shared/commerce-recovery';
import {
  parseCommerceIdentitySessionRequest,
  type CommerceIdentitySessionRequest,
  type CommerceIdentitySessionResponse,
} from '../../shared/commerce-service';
import type { EntitlementEvent, AssetGrant } from '../../shared/commerce';
import { CommerceServiceError } from './http-api';
import type { CommerceSessionApplicationService } from './http-api';
import type { CommerceRefreshSessionRecord } from './repository';
import type { PostgresCommerceIdentityStore } from './postgres-identity-store';
import type { CommerceExternalIdentityVerifier } from './supabase-identity';
import type { CommerceTokenIssuer } from './token-issuer';

export interface HostedCommerceIdentityServiceOptions {
  credentialPepper: string | Buffer;
  catalogVersion: string;
  freeAvatars: readonly MarketplaceAvatar[];
  now?: () => Date;
}

const credentialPattern = /^[A-Za-z0-9_-]{43}$/;

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

function safeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

export class HostedCommerceIdentityService implements CommerceSessionApplicationService {
  private readonly pepper: Buffer;
  private readonly now: () => Date;

  constructor(
    private readonly store: PostgresCommerceIdentityStore,
    private readonly externalIdentity: CommerceExternalIdentityVerifier,
    private readonly tokens: CommerceTokenIssuer,
    private readonly options: HostedCommerceIdentityServiceOptions,
  ) {
    this.pepper = Buffer.isBuffer(options.credentialPepper)
      ? Buffer.from(options.credentialPepper) : Buffer.from(options.credentialPepper, 'base64url');
    if (this.pepper.byteLength !== 32 || !/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(options.catalogVersion)
      || options.freeAvatars.length < 1
      || options.freeAvatars.some((avatar) => avatar.admissionStatus !== 'admitted'
        || avatar.availability !== 'free')) {
      throw new Error('Hosted commerce identity service is not configured.');
    }
    this.now = options.now ?? (() => new Date());
  }

  async createIdentitySession(
    value: CommerceIdentitySessionRequest,
    providerAccessToken: string,
    correlationId: string,
  ): Promise<CommerceIdentitySessionResponse> {
    const request = parseCommerceIdentitySessionRequest(value);
    const external = await this.externalIdentity.authenticate(providerAccessToken)
      .catch(() => { throw new CommerceServiceError('authentication-failed'); });
    const providerSubjectDigest = digest(`${external.provider}:${external.subject}`);
    const accountId = `account:${createHash('sha256').update(providerSubjectDigest).digest('hex').slice(0, 32)}`;
    const sessionId = this.identifier('session', `${accountId}:${request.idempotencyKey}`);
    const recoveryId = this.identifier('recovery', `${accountId}:${request.idempotencyKey}`);
    const recoveryCode = this.secret(`recovery:${accountId}:${request.idempotencyKey}`);
    const refreshCredential = this.secret(`refresh:${sessionId}:1`);
    const now = this.timestamp();
    const recoveryExpiresAt = new Date(Date.parse(now) + 30 * 86_400_000).toISOString();
    const refreshExpiresAt = new Date(Date.parse(now) + 30 * 86_400_000).toISOString();
    const existing = await this.store.getRefreshSession(sessionId);
    if (existing) {
      if (existing.accountId !== accountId || existing.installationId !== request.installationId
        || existing.generation !== 1 || existing.credentialDigest !== this.credentialDigest(refreshCredential)) {
        throw new CommerceServiceError('conflict');
      }
      return {
        schemaVersion: 1,
        recoveryCode,
        recoveryCodeExpiresAt: new Date(Date.parse(existing.createdAt) + 30 * 86_400_000).toISOString(),
        session: await this.material(existing, refreshCredential, now),
      };
    }
    const session: CommerceRefreshSessionRecord = {
      sessionId, accountId, installationId: request.installationId,
      credentialDigest: this.credentialDigest(refreshCredential), generation: 1,
      expiresAt: refreshExpiresAt, createdAt: now, updatedAt: now,
    };
    await this.store.bootstrap({
      accountId, provider: 'supabase', providerSubjectDigest,
      installationId: request.installationId, recoveryId,
      recoveryCredentialDigest: this.credentialDigest(recoveryCode),
      proofKeyChallenge: request.proofKeyChallenge,
      idempotencyKey: request.idempotencyKey, recoveryExpiresAt,
      session,
      freeEntitlements: this.freeEntitlements(accountId, now),
      audit: this.audit('identity-session-created', accountId, sessionId, correlationId, now),
    });
    return {
      schemaVersion: 1, recoveryCode, recoveryCodeExpiresAt: recoveryExpiresAt,
      session: await this.material(session, refreshCredential, now),
    };
  }

  async restoreCleanDevice(value: CleanDeviceRestoreRequest): Promise<CommerceSessionMaterial> {
    const request = parseCleanDeviceRestoreRequest(value);
    const now = this.timestamp();
    const recovery = await this.store.findRecovery(this.credentialDigest(request.recoveryCode));
    const challenge = digest(request.proofKeyVerifier);
    if (!recovery || Date.parse(recovery.expiresAt) <= Date.parse(now)
      || !safeEquals(recovery.proofKeyChallenge, challenge)
      || (recovery.consumedAt && recovery.consumedIdempotencyKey !== request.idempotencyKey)) {
      throw new CommerceServiceError('authentication-failed');
    }
    const sessionId = this.identifier('session', `${recovery.recoveryId}:${request.idempotencyKey}`);
    const refreshCredential = this.secret(`refresh:${sessionId}:1`);
    const existing = await this.store.getRefreshSession(sessionId);
    const session: CommerceRefreshSessionRecord = existing ?? {
      sessionId, accountId: recovery.accountId, installationId: request.installationId,
      credentialDigest: this.credentialDigest(refreshCredential), generation: 1,
      expiresAt: new Date(Date.parse(now) + 30 * 86_400_000).toISOString(),
      createdAt: now, updatedAt: now,
    };
    if (session.accountId !== recovery.accountId || session.installationId !== request.installationId) {
      throw new CommerceServiceError('authentication-failed');
    }
    await this.store.consumeRecovery({
      recoveryId: recovery.recoveryId, idempotencyKey: request.idempotencyKey,
      consumedAt: now, installationId: request.installationId, session,
      audit: this.audit('clean-device-restored', recovery.accountId, sessionId,
        `restore:${request.idempotencyKey}`, now),
    });
    return this.material(session, refreshCredential, now);
  }

  async refreshSession(value: CommerceSessionRefreshRequest): Promise<CommerceSessionMaterial> {
    const request = parseCommerceSessionRefreshRequest(value);
    const now = this.timestamp();
    const current = await this.store.getRefreshSession(request.sessionId);
    if (!current || current.installationId !== request.installationId
      || current.generation !== request.refreshGeneration
      || !safeEquals(current.credentialDigest, this.credentialDigest(request.refreshCredential))) {
      if (current?.generation === request.refreshGeneration + 1
        && current.lastRotationId === request.rotationId
        && current.previousCredentialDigest === this.credentialDigest(request.refreshCredential)) {
        const replayCredential = this.secret(`refresh:${current.sessionId}:${current.generation}:${request.rotationId}`);
        return this.material(current, replayCredential, now);
      }
      throw new CommerceServiceError('authentication-failed');
    }
    const nextCredential = this.secret(`refresh:${current.sessionId}:${current.generation + 1}:${request.rotationId}`);
    const next: CommerceRefreshSessionRecord = {
      ...current,
      previousCredentialDigest: current.credentialDigest,
      credentialDigest: this.credentialDigest(nextCredential),
      generation: current.generation + 1,
      lastRotationId: request.rotationId,
      updatedAt: now,
    };
    const stored = await this.store.rotateRefreshSession({
      sessionId: current.sessionId, expectedGeneration: current.generation,
      expectedCredentialDigest: current.credentialDigest, rotationId: request.rotationId,
      next,
      audit: this.audit('refresh-session-rotated', current.accountId, current.sessionId,
        `rotate:${request.rotationId}`, now),
    });
    return this.material(stored, nextCredential, now);
  }

  async authenticateCommerceToken(accessToken: string): Promise<{
    accountId: string;
    installationId: string;
    claims: CommerceAccessTokenClaims;
  }> {
    let claims: CommerceAccessTokenClaims;
    const now = this.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new CommerceServiceError('authentication-failed');
    }
    try {
      claims = verifyCommerceAccessToken(accessToken, {
        issuer: this.tokens.issuer, audience: 'desky-assets',
        keys: new Map([[this.tokens.keyId, this.tokens.publicKey]]),
      }, Math.floor(now.getTime() / 1_000));
    } catch {
      throw new CommerceServiceError('authentication-failed');
    }
    if (!claims.scope.includes('commerce:write')) throw new CommerceServiceError('authentication-failed');
    const session = await this.store.getRefreshSession(claims.jti);
    if (!session || session.accountId !== claims.sub || session.revokedAt
      || Date.parse(session.expiresAt) <= now.getTime()) {
      throw new CommerceServiceError('authentication-failed');
    }
    return { accountId: claims.sub, installationId: session.installationId, claims };
  }

  private async material(
    session: CommerceRefreshSessionRecord,
    refreshCredential: string,
    now: string,
  ): Promise<CommerceSessionMaterial> {
    if (!credentialPattern.test(refreshCredential)) throw new Error('Invalid generated refresh credential.');
    const nowSeconds = Math.floor(Date.parse(now) / 1_000);
    const authorizationNow = new Date(nowSeconds * 1_000).toISOString();
    const reconciliation = await this.store.reconciliation(session.accountId, authorizationNow);
    const issued = this.tokens.issue({
      accountId: session.accountId, installationId: session.installationId,
      sessionId: session.sessionId, reconciliation, nowSeconds,
    });
    return {
      schemaVersion: 1,
      accountId: session.accountId,
      sessionId: session.sessionId,
      installationId: session.installationId,
      refreshCredential,
      refreshGeneration: session.generation,
      refreshExpiresAt: session.expiresAt,
      accessToken: issued.accessToken,
      offlineLease: issued.offlineLease,
      serverTimeSeconds: nowSeconds,
      reconciliation,
    };
  }

  private freeEntitlements(accountId: string, now: string): Array<{ event: EntitlementEvent; grant: AssetGrant }> {
    return this.options.freeAvatars.map((avatar) => {
      const suffix = createHash('sha256').update(`${accountId}:${avatar.productId}`).digest('hex').slice(0, 24);
      const event: EntitlementEvent = {
        schemaVersion: 1, eventId: `event:free:${suffix}`, accountId,
        productId: avatar.productId, type: 'grant', source: 'free',
        sourceReference: `free:${this.options.catalogVersion}:${avatar.productId}`,
        effectiveAt: now, reasonCode: 'foundation-free-tier',
      };
      const grant: AssetGrant = {
        schemaVersion: 1, grantId: `grant:free:${suffix}`, accountId,
        productId: avatar.productId, productRevision: 1,
        avatarRevisionIds: [avatar.revisionId], entitlementEventId: event.eventId,
        catalogVersion: this.options.catalogVersion, state: 'active', issuedAt: now,
      };
      return { event, grant };
    });
  }

  private identifier(prefix: string, material: string): string {
    return `${prefix}:${createHmac('sha256', this.pepper).update(material).digest('hex').slice(0, 32)}`;
  }

  private secret(material: string): string {
    return createHmac('sha256', this.pepper).update(material).digest('base64url');
  }

  private credentialDigest(value: string): string {
    return createHmac('sha256', this.pepper).update(`digest:${value}`).digest('base64url');
  }

  private timestamp(): string {
    const now = this.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Invalid commerce service time.');
    return now.toISOString();
  }

  private audit(
    eventType: string,
    accountId: string,
    subjectId: string,
    correlationId: string,
    occurredAt: string,
  ) {
    return {
      eventId: `audit:${randomUUID()}`, eventType, accountId, subjectId,
      occurredAt, correlationId,
      detail: { schemaVersion: 1 },
    };
  }
}
