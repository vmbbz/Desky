import { createPublicKey, verify, type KeyObject } from 'node:crypto';

export const commerceAccessTokenType = 'desky-access+jwt';
export const commerceAccessTokenScopes = ['catalog:read', 'asset:read'] as const;
export type CommerceAccessTokenScope = (typeof commerceAccessTokenScopes)[number];

export interface CommerceAccessTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  iat: number;
  nbf: number;
  exp: number;
  jti: string;
  scope: CommerceAccessTokenScope[];
  grants: string[];
  catalogVersion: string;
}

export interface CommerceAccessTokenPolicy {
  issuer: string;
  audience: 'desky-assets';
  keys: ReadonlyMap<string, KeyObject | string | Buffer>;
  maximumLifetimeSeconds?: number;
  clockSkewSeconds?: number;
}

const identifierPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;

interface ParsedAccessTokenHeader {
  encodedHeader: string;
  encodedClaims: string;
  encodedSignature: string;
  kid: string;
}

function exactRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid commerce access token ${name}.`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((field) => !fields.includes(field))) {
    throw new Error(`Invalid commerce access token ${name}.`);
  }
  return record;
}

function decodeSegment(segment: string, name: string, maximumBytes: number): Buffer {
  if (!base64UrlPattern.test(segment)) throw new Error(`Invalid commerce access token ${name}.`);
  const decoded = Buffer.from(segment, 'base64url');
  if (decoded.byteLength === 0
    || decoded.byteLength > maximumBytes
    || decoded.toString('base64url') !== segment) {
    throw new Error(`Invalid commerce access token ${name}.`);
  }
  return decoded;
}

function parseJson(segment: string, name: string, maximumBytes: number): unknown {
  const bytes = decodeSegment(segment, name, maximumBytes);
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error(`Invalid commerce access token ${name}.`);
  }
}

function readString(value: unknown, field: string, maximum = 256): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || value.trim() !== value) {
    throw new Error(`Invalid commerce access token ${field}.`);
  }
  return value;
}

function readIdentifier(value: unknown, field: string): string {
  const identifier = readString(value, field, 128);
  if (!identifierPattern.test(identifier)) throw new Error(`Invalid commerce access token ${field}.`);
  return identifier;
}

function readNumericDate(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid commerce access token ${field}.`);
  }
  return value;
}

function parseClaims(value: unknown): CommerceAccessTokenClaims {
  const claims = exactRecord(value, [
    'iss', 'aud', 'sub', 'iat', 'nbf', 'exp', 'jti', 'scope', 'grants', 'catalogVersion',
  ], 'claims');
  if (!Array.isArray(claims.scope) || claims.scope.length < 1
    || claims.scope.length > commerceAccessTokenScopes.length
    || !Array.isArray(claims.grants) || claims.grants.length > 1_000) {
    throw new Error('Invalid commerce access token claims.');
  }
  const scope = claims.scope.map((entry) => {
    if (typeof entry !== 'string'
      || !commerceAccessTokenScopes.includes(entry as CommerceAccessTokenScope)) {
      throw new Error('Invalid commerce access token scope.');
    }
    return entry as CommerceAccessTokenScope;
  });
  const grants = claims.grants.map((entry) => readIdentifier(entry, 'grant'));
  if (new Set(scope).size !== scope.length || new Set(grants).size !== grants.length) {
    throw new Error('Invalid commerce access token duplicate claims.');
  }
  return {
    iss: readString(claims.iss, 'issuer', 512),
    aud: readString(claims.aud, 'audience', 128),
    sub: readIdentifier(claims.sub, 'subject'),
    iat: readNumericDate(claims.iat, 'issued-at time'),
    nbf: readNumericDate(claims.nbf, 'not-before time'),
    exp: readNumericDate(claims.exp, 'expiry time'),
    jti: readIdentifier(claims.jti, 'token ID'),
    scope,
    grants,
    catalogVersion: readIdentifier(claims.catalogVersion, 'catalog version'),
  };
}

function parseAccessTokenHeader(token: string): ParsedAccessTokenHeader {
  if (typeof token !== 'string' || token.length === 0 || token.length > 8_192) {
    throw new Error('Invalid commerce access token.');
  }
  const segments = token.split('.');
  if (segments.length !== 3) throw new Error('Invalid commerce access token.');
  const [encodedHeader, encodedClaims, encodedSignature] = segments;
  const header = exactRecord(
    parseJson(encodedHeader, 'header', 1_024),
    ['alg', 'kid', 'typ'],
    'header',
  );
  if (header.alg !== 'EdDSA' || header.typ !== commerceAccessTokenType) {
    throw new Error('Commerce access token algorithm or type is not admitted.');
  }
  return {
    encodedHeader,
    encodedClaims,
    encodedSignature,
    kid: readIdentifier(header.kid, 'key ID'),
  };
}

export function readCommerceAccessTokenKeyId(token: string): string {
  return parseAccessTokenHeader(token).kid;
}

export function verifyCommerceAccessToken(
  token: string,
  policy: CommerceAccessTokenPolicy,
  nowSeconds = Math.floor(Date.now() / 1000),
): CommerceAccessTokenClaims {
  const { encodedHeader, encodedClaims, encodedSignature, kid } = parseAccessTokenHeader(token);
  const configuredKey = policy.keys.get(kid);
  if (!configuredKey) throw new Error('Commerce access token key is not admitted.');
  const signature = decodeSegment(encodedSignature, 'signature', 128);
  if (signature.byteLength !== 64) throw new Error('Invalid commerce access token signature.');
  let key: KeyObject;
  try {
    key = typeof configuredKey === 'object'
      && !Buffer.isBuffer(configuredKey)
      && configuredKey.type === 'public'
      ? configuredKey
      : createPublicKey(configuredKey);
  } catch {
    throw new Error('Commerce access token key is invalid.');
  }
  const signed = Buffer.from(`${encodedHeader}.${encodedClaims}`, 'ascii');
  if (!verify(null, signed, key, signature)) {
    throw new Error('Commerce access token signature verification failed.');
  }

  const claims = parseClaims(parseJson(encodedClaims, 'claims', 6_144));
  const clockSkewSeconds = policy.clockSkewSeconds ?? 30;
  const maximumLifetimeSeconds = policy.maximumLifetimeSeconds ?? 15 * 60;
  if (!Number.isSafeInteger(nowSeconds)
    || !Number.isSafeInteger(clockSkewSeconds)
    || clockSkewSeconds < 0
    || clockSkewSeconds > 120
    || !Number.isSafeInteger(maximumLifetimeSeconds)
    || maximumLifetimeSeconds < 60
    || maximumLifetimeSeconds > 60 * 60) {
    throw new Error('Invalid commerce access token policy.');
  }
  if (claims.iss !== policy.issuer || claims.aud !== policy.audience) {
    throw new Error('Commerce access token issuer or audience mismatch.');
  }
  if (claims.iat > nowSeconds + clockSkewSeconds
    || claims.nbf > nowSeconds + clockSkewSeconds
    || claims.exp <= nowSeconds - clockSkewSeconds
    || claims.nbf < claims.iat - clockSkewSeconds
    || claims.exp <= claims.nbf
    || claims.exp - claims.iat > maximumLifetimeSeconds) {
    throw new Error('Commerce access token time policy failed.');
  }
  return structuredClone(claims);
}
