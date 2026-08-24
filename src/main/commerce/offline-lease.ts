import { createPublicKey, verify, type KeyObject } from 'node:crypto';

import type { RotatingCommerceJwks } from './jwks';
import {
  parseCommerceTrustedTimeCheckpoint,
  type CommerceTrustedTimeCheckpoint,
} from './refresh-vault';

export const commerceOfflineLeaseType = 'desky-offline-lease+jwt';

export interface CommerceOfflineGrant {
  grantId: string;
  productId: string;
  productRevision: number;
  avatarRevisionIds: string[];
  catalogVersion: string;
  expiresAt?: number;
}

export interface CommerceOfflineLeaseClaims {
  iss: string;
  aud: 'desky-offline';
  sub: string;
  installationId: string;
  iat: number;
  nbf: number;
  exp: number;
  jti: string;
  grants: CommerceOfflineGrant[];
}

export interface CommerceOfflineLeasePolicy {
  issuer: string;
  audience: 'desky-offline';
  keys: ReadonlyMap<string, KeyObject | string | Buffer>;
  maximumLifetimeSeconds?: number;
  clockSkewSeconds?: number;
}

export type CommerceOfflineLeaseEvaluation =
  | { status: 'valid'; claims: CommerceOfflineLeaseClaims; trustedNowSeconds: number }
  | { status: 'expired'; trustedNowSeconds: number }
  | { status: 'reconnect-required'; reason: 'clock-anomaly' | 'invalid-lease'; trustedNowSeconds: number };

const identifierPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;

function exactRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid commerce offline lease ${name}.`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((field) => !fields.includes(field))) {
    throw new Error(`Invalid commerce offline lease ${name}.`);
  }
  return record;
}

function readIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !identifierPattern.test(value)) {
    throw new Error(`Invalid commerce offline lease ${field}.`);
  }
  return value;
}

function readNumericDate(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid commerce offline lease ${field}.`);
  }
  return value;
}

function decodeSegment(segment: string, field: string, maximumBytes: number): Buffer {
  if (!base64UrlPattern.test(segment)) throw new Error(`Invalid commerce offline lease ${field}.`);
  const bytes = Buffer.from(segment, 'base64url');
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes
    || bytes.toString('base64url') !== segment) {
    throw new Error(`Invalid commerce offline lease ${field}.`);
  }
  return bytes;
}

function parseJson(segment: string, field: string, maximumBytes: number): unknown {
  try {
    return JSON.parse(decodeSegment(segment, field, maximumBytes).toString('utf8')) as unknown;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid commerce offline lease')) throw error;
    throw new Error(`Invalid commerce offline lease ${field}.`);
  }
}

function parseGrant(value: unknown): CommerceOfflineGrant {
  const source = exactRecord(value, [
    'grantId', 'productId', 'productRevision', 'avatarRevisionIds', 'catalogVersion', 'expiresAt',
  ], 'grant');
  if (typeof source.productRevision !== 'number'
    || !Number.isSafeInteger(source.productRevision)
    || source.productRevision < 1
    || !Array.isArray(source.avatarRevisionIds)
    || source.avatarRevisionIds.length < 1
    || source.avatarRevisionIds.length > 1_000) {
    throw new Error('Invalid commerce offline lease grant.');
  }
  const avatarRevisionIds = source.avatarRevisionIds.map((entry) => readIdentifier(entry, 'avatar revision ID'));
  if (new Set(avatarRevisionIds).size !== avatarRevisionIds.length) {
    throw new Error('Invalid commerce offline lease duplicate avatar revision.');
  }
  return {
    grantId: readIdentifier(source.grantId, 'grant ID'),
    productId: readIdentifier(source.productId, 'product ID'),
    productRevision: source.productRevision,
    avatarRevisionIds,
    catalogVersion: readIdentifier(source.catalogVersion, 'catalog version'),
    expiresAt: source.expiresAt === undefined
      ? undefined : readNumericDate(source.expiresAt, 'grant expiry'),
  };
}

function parseClaims(value: unknown): CommerceOfflineLeaseClaims {
  const source = exactRecord(value, [
    'iss', 'aud', 'sub', 'installationId', 'iat', 'nbf', 'exp', 'jti', 'grants',
  ], 'claims');
  if (!Array.isArray(source.grants) || source.grants.length < 1 || source.grants.length > 1_000
    || typeof source.iss !== 'string' || source.iss.length > 512 || source.iss.trim() !== source.iss
    || source.aud !== 'desky-offline') {
    throw new Error('Invalid commerce offline lease claims.');
  }
  const grants = source.grants.map((entry) => parseGrant(entry));
  if (new Set(grants.map((grant) => grant.grantId)).size !== grants.length) {
    throw new Error('Invalid commerce offline lease duplicate grant.');
  }
  return {
    iss: source.iss,
    aud: 'desky-offline',
    sub: readIdentifier(source.sub, 'subject'),
    installationId: readIdentifier(source.installationId, 'installation ID'),
    iat: readNumericDate(source.iat, 'issued-at time'),
    nbf: readNumericDate(source.nbf, 'not-before time'),
    exp: readNumericDate(source.exp, 'expiry time'),
    jti: readIdentifier(source.jti, 'token ID'),
    grants,
  };
}

interface ParsedLeaseHeader {
  encodedHeader: string;
  encodedClaims: string;
  encodedSignature: string;
  kid: string;
}

function parseHeader(token: string): ParsedLeaseHeader {
  if (typeof token !== 'string' || token.length === 0 || token.length > 32_768) {
    throw new Error('Invalid commerce offline lease.');
  }
  const segments = token.split('.');
  if (segments.length !== 3) throw new Error('Invalid commerce offline lease.');
  const [encodedHeader, encodedClaims, encodedSignature] = segments;
  const header = exactRecord(parseJson(encodedHeader, 'header', 1_024), ['alg', 'kid', 'typ'], 'header');
  if (header.alg !== 'EdDSA' || header.typ !== commerceOfflineLeaseType) {
    throw new Error('Commerce offline lease algorithm or type is not admitted.');
  }
  return {
    encodedHeader,
    encodedClaims,
    encodedSignature,
    kid: readIdentifier(header.kid, 'key ID'),
  };
}

export function readCommerceOfflineLeaseKeyId(token: string): string {
  return parseHeader(token).kid;
}

export function verifyCommerceOfflineLease(
  token: string,
  installationId: string,
  policy: CommerceOfflineLeasePolicy,
  nowSeconds: number,
): CommerceOfflineLeaseClaims {
  const header = parseHeader(token);
  const configuredKey = policy.keys.get(header.kid);
  if (!configuredKey) throw new Error('Commerce offline lease key is not admitted.');
  const signature = decodeSegment(header.encodedSignature, 'signature', 128);
  if (signature.byteLength !== 64) throw new Error('Invalid commerce offline lease signature.');
  let key: KeyObject;
  try {
    key = typeof configuredKey === 'object'
      && !Buffer.isBuffer(configuredKey)
      && configuredKey.type === 'public'
      ? configuredKey
      : createPublicKey(configuredKey);
  } catch {
    throw new Error('Commerce offline lease key is invalid.');
  }
  if (!verify(
    null,
    Buffer.from(`${header.encodedHeader}.${header.encodedClaims}`, 'ascii'),
    key,
    signature,
  )) {
    throw new Error('Commerce offline lease signature verification failed.');
  }
  const claims = parseClaims(parseJson(header.encodedClaims, 'claims', 30 * 1_024));
  const maximumLifetimeSeconds = policy.maximumLifetimeSeconds ?? 72 * 60 * 60;
  const clockSkewSeconds = policy.clockSkewSeconds ?? 120;
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0
    || !Number.isSafeInteger(maximumLifetimeSeconds)
    || maximumLifetimeSeconds < 60 * 60 || maximumLifetimeSeconds > 7 * 24 * 60 * 60
    || !Number.isSafeInteger(clockSkewSeconds) || clockSkewSeconds < 0 || clockSkewSeconds > 300) {
    throw new Error('Commerce offline lease verifier policy is invalid.');
  }
  if (claims.exp <= nowSeconds - clockSkewSeconds) {
    throw new Error('Commerce offline lease expired.');
  }
  if (claims.iss !== policy.issuer || claims.aud !== policy.audience
    || claims.installationId !== installationId
    || claims.iat > nowSeconds + clockSkewSeconds
    || claims.nbf > nowSeconds + clockSkewSeconds
    || claims.nbf < claims.iat - clockSkewSeconds
    || claims.exp <= claims.nbf
    || claims.exp - claims.iat > maximumLifetimeSeconds
    || claims.grants.some((grant) => grant.expiresAt !== undefined && grant.expiresAt > claims.exp)) {
    throw new Error('Commerce offline lease policy failed.');
  }
  return structuredClone(claims);
}

export function createTrustedTimeCheckpoint(
  serverTimeSeconds: number,
  wallTimeSeconds: number,
  monotonicMilliseconds: number,
  previous?: CommerceTrustedTimeCheckpoint,
): CommerceTrustedTimeCheckpoint {
  const checkpoint = parseCommerceTrustedTimeCheckpoint({
    version: 1,
    serverTimeSeconds,
    wallTimeSeconds,
    monotonicMilliseconds,
  });
  if (previous && checkpoint.serverTimeSeconds < previous.serverTimeSeconds) {
    throw new Error('Commerce trusted server time moved backwards.');
  }
  return checkpoint;
}

function trustedNow(
  checkpoint: CommerceTrustedTimeCheckpoint,
  wallTimeSeconds: number,
  monotonicMilliseconds: number,
  maximumBackwardSkewSeconds: number,
): { now: number; anomaly: boolean } {
  if (!Number.isSafeInteger(wallTimeSeconds) || wallTimeSeconds < 0
    || !Number.isSafeInteger(monotonicMilliseconds) || monotonicMilliseconds < 0
    || !Number.isSafeInteger(maximumBackwardSkewSeconds)
    || maximumBackwardSkewSeconds < 0 || maximumBackwardSkewSeconds > 300) {
    throw new Error('Commerce offline clock input is invalid.');
  }
  if (wallTimeSeconds < checkpoint.serverTimeSeconds - maximumBackwardSkewSeconds) {
    return { now: checkpoint.serverTimeSeconds, anomaly: true };
  }
  if (monotonicMilliseconds < checkpoint.monotonicMilliseconds) {
    return { now: Math.max(wallTimeSeconds, checkpoint.serverTimeSeconds), anomaly: true };
  }
  const monotonicEstimate = checkpoint.serverTimeSeconds
    + Math.floor((monotonicMilliseconds - checkpoint.monotonicMilliseconds) / 1_000);
  return { now: Math.max(wallTimeSeconds, monotonicEstimate), anomaly: false };
}

export function evaluateCommerceOfflineLeaseWithKeys(
  token: string,
  installationId: string,
  policy: {
    issuer: string;
    keys: ReadonlyMap<string, KeyObject | string | Buffer>;
    maximumLifetimeSeconds?: number;
    clockSkewSeconds?: number;
    maximumBackwardSkewSeconds?: number;
  },
  checkpoint: CommerceTrustedTimeCheckpoint,
  wallTimeSeconds: number,
  monotonicMilliseconds: number,
): CommerceOfflineLeaseEvaluation {
  const clock = trustedNow(
    parseCommerceTrustedTimeCheckpoint(checkpoint),
    wallTimeSeconds,
    monotonicMilliseconds,
    policy.maximumBackwardSkewSeconds ?? 120,
  );
  if (clock.anomaly) {
    return { status: 'reconnect-required', reason: 'clock-anomaly', trustedNowSeconds: clock.now };
  }
  try {
    const claims = verifyCommerceOfflineLease(token, installationId, {
      issuer: policy.issuer,
      audience: 'desky-offline',
      keys: policy.keys,
      maximumLifetimeSeconds: policy.maximumLifetimeSeconds,
      clockSkewSeconds: policy.clockSkewSeconds,
    }, clock.now);
    return { status: 'valid', claims, trustedNowSeconds: clock.now };
  } catch (error) {
    if (error instanceof Error && error.message === 'Commerce offline lease expired.') {
      return { status: 'expired', trustedNowSeconds: clock.now };
    }
    return { status: 'reconnect-required', reason: 'invalid-lease', trustedNowSeconds: clock.now };
  }
}

export async function evaluateCommerceOfflineLease(
  token: string,
  installationId: string,
  policy: {
    issuer: string;
    jwks: RotatingCommerceJwks;
    maximumLifetimeSeconds?: number;
    clockSkewSeconds?: number;
    maximumBackwardSkewSeconds?: number;
  },
  checkpoint: CommerceTrustedTimeCheckpoint,
  wallTimeSeconds: number,
  monotonicMilliseconds: number,
): Promise<CommerceOfflineLeaseEvaluation> {
  const clock = trustedNow(
    parseCommerceTrustedTimeCheckpoint(checkpoint),
    wallTimeSeconds,
    monotonicMilliseconds,
    policy.maximumBackwardSkewSeconds ?? 120,
  );
  if (clock.anomaly) {
    return { status: 'reconnect-required', reason: 'clock-anomaly', trustedNowSeconds: clock.now };
  }
  try {
    const kid = readCommerceOfflineLeaseKeyId(token);
    const keys = await policy.jwks.getKeys(kid, clock.now);
    return evaluateCommerceOfflineLeaseWithKeys(
      token,
      installationId,
      { ...policy, keys },
      checkpoint,
      wallTimeSeconds,
      monotonicMilliseconds,
    );
  } catch {
    return { status: 'reconnect-required', reason: 'invalid-lease', trustedNowSeconds: clock.now };
  }
}
