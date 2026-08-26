import { createPrivateKey, createPublicKey, KeyObject, sign } from 'node:crypto';

import { commerceAccessTokenType } from '../../main/commerce/access-token';
import { commerceOfflineLeaseType, type CommerceOfflineGrant } from '../../main/commerce/offline-lease';
import type { CommerceReconciliationSnapshot } from '../../shared/commerce-recovery';

export interface CommerceTokenIssuerOptions {
  issuer: string;
  keyId: string;
  privateKey: KeyObject | string | Buffer;
  accessLifetimeSeconds?: number;
  offlineLifetimeSeconds?: number;
}

const identifierPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function jwt(key: KeyObject, keyId: string, type: string, claims: unknown): string {
  const header = encode({ alg: 'EdDSA', kid: keyId, typ: type });
  const payload = encode(claims);
  const signature = sign(null, Buffer.from(`${header}.${payload}`, 'ascii'), key);
  return `${header}.${payload}.${signature.toString('base64url')}`;
}

function exactOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) {
    throw new Error('Commerce token issuer origin is invalid.');
  }
  return value;
}

export class CommerceTokenIssuer {
  readonly issuer: string;
  readonly keyId: string;
  readonly publicKey: KeyObject;
  private readonly privateKey: KeyObject;
  private readonly accessLifetimeSeconds: number;
  private readonly offlineLifetimeSeconds: number;

  constructor(options: CommerceTokenIssuerOptions) {
    this.issuer = exactOrigin(options.issuer);
    if (!identifierPattern.test(options.keyId)) throw new Error('Commerce token key ID is invalid.');
    this.keyId = options.keyId;
    this.privateKey = options.privateKey instanceof KeyObject
      ? options.privateKey : createPrivateKey(options.privateKey);
    if (this.privateKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('Commerce token signing key must be Ed25519.');
    }
    this.publicKey = createPublicKey(this.privateKey);
    this.accessLifetimeSeconds = options.accessLifetimeSeconds ?? 10 * 60;
    this.offlineLifetimeSeconds = options.offlineLifetimeSeconds ?? 72 * 60 * 60;
    if (!Number.isSafeInteger(this.accessLifetimeSeconds)
      || this.accessLifetimeSeconds < 60 || this.accessLifetimeSeconds > 60 * 60
      || !Number.isSafeInteger(this.offlineLifetimeSeconds)
      || this.offlineLifetimeSeconds < 60 * 60 || this.offlineLifetimeSeconds > 72 * 60 * 60) {
      throw new Error('Commerce token lifetime policy is invalid.');
    }
  }

  jwks(): { keys: Array<Record<string, string>> } {
    const key = this.publicKey.export({ format: 'jwk' });
    if (key.kty !== 'OKP' || key.crv !== 'Ed25519' || !key.x) {
      throw new Error('Commerce token public key is invalid.');
    }
    return { keys: [{ alg: 'EdDSA', crv: 'Ed25519', kid: this.keyId, kty: 'OKP', use: 'sig', x: key.x }] };
  }

  issue(input: {
    accountId: string;
    installationId: string;
    sessionId: string;
    reconciliation: CommerceReconciliationSnapshot;
    nowSeconds: number;
  }): { accessToken: string; offlineLease: string } {
    const grants = input.reconciliation.grants.filter((grant) => grant.state === 'active'
      && (!grant.expiresAt || Date.parse(grant.expiresAt) > input.nowSeconds * 1_000));
    const catalogVersions = [...new Set(grants.map((grant) => grant.catalogVersion))].sort();
    if (!identifierPattern.test(input.accountId) || !identifierPattern.test(input.installationId)
      || !identifierPattern.test(input.sessionId) || !Number.isSafeInteger(input.nowSeconds)
      || input.reconciliation.accountId !== input.accountId || grants.length < 1) {
      throw new Error('Commerce token input is inconsistent.');
    }
    const accessToken = jwt(this.privateKey, this.keyId, commerceAccessTokenType, {
      iss: this.issuer,
      aud: 'desky-assets',
      sub: input.accountId,
      iat: input.nowSeconds,
      nbf: input.nowSeconds,
      exp: input.nowSeconds + this.accessLifetimeSeconds,
      jti: input.sessionId,
      scope: ['catalog:read', 'asset:read', 'commerce:write'],
      grants: [...new Set(grants.map((grant) => grant.productId))].sort(),
      catalogVersions,
    });
    const offlineGrants: CommerceOfflineGrant[] = grants.map((grant) => ({
      grantId: grant.grantId,
      productId: grant.productId,
      productRevision: grant.productRevision,
      avatarRevisionIds: [...grant.avatarRevisionIds],
      catalogVersion: grant.catalogVersion,
      expiresAt: grant.expiresAt ? Math.floor(Date.parse(grant.expiresAt) / 1_000) : undefined,
    }));
    const offlineLease = jwt(this.privateKey, this.keyId, commerceOfflineLeaseType, {
      iss: this.issuer,
      aud: 'desky-offline',
      sub: input.accountId,
      installationId: input.installationId,
      iat: input.nowSeconds,
      nbf: input.nowSeconds,
      exp: input.nowSeconds + this.offlineLifetimeSeconds,
      jti: `lease:${input.sessionId}:${input.nowSeconds}`,
      grants: offlineGrants,
    });
    return { accessToken, offlineLease };
  }
}
