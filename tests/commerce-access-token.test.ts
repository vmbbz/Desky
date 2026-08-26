import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  commerceAccessTokenType,
  verifyCommerceAccessToken,
  type CommerceAccessTokenClaims,
  type CommerceAccessTokenPolicy,
} from '../src/main/commerce/access-token';

const now = 1_787_600_000;
const primary = generateKeyPairSync('ed25519');
const secondary = generateKeyPairSync('ed25519');

const defaultClaims: CommerceAccessTokenClaims = {
  iss: 'https://commerce.desky.example',
  aud: 'desky-assets',
  sub: 'account:opaque-1',
  iat: now - 5,
  nbf: now - 5,
  exp: now + 595,
  jti: 'token:1',
  scope: ['catalog:read', 'asset:read'],
  grants: ['avatar:banana'],
  catalogVersions: ['catalog:42'],
};

const policy: CommerceAccessTokenPolicy = {
  issuer: defaultClaims.iss,
  audience: 'desky-assets',
  keys: new Map([['key:2026-08', primary.publicKey]]),
};

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function token(input: {
  header?: Record<string, unknown>;
  claims?: Record<string, unknown>;
  key?: KeyObject;
  signature?: Buffer;
} = {}): string {
  const header = encode(input.header ?? {
    alg: 'EdDSA',
    kid: 'key:2026-08',
    typ: commerceAccessTokenType,
  });
  const claims = encode(input.claims ?? defaultClaims);
  const signed = Buffer.from(`${header}.${claims}`, 'ascii');
  const signature = input.signature ?? sign(null, signed, input.key ?? primary.privateKey);
  return `${header}.${claims}.${signature.toString('base64url')}`;
}

describe('commerce access JWT verification', () => {
  it('verifies a short-lived Ed25519 token and returns isolated claims', () => {
    const claims = verifyCommerceAccessToken(token(), policy, now);
    expect(claims).toEqual(defaultClaims);
    claims.grants.push('avatar:other');
    expect(verifyCommerceAccessToken(token(), policy, now).grants).toEqual(['avatar:banana']);
  });

  it('normalizes the legacy single-catalog claim during the short token rollover window', () => {
    const { catalogVersions: _catalogVersions, ...legacy } = defaultClaims;
    expect(verifyCommerceAccessToken(token({
      claims: { ...legacy, catalogVersion: 'catalog:42' },
    }), policy, now).catalogVersions).toEqual(['catalog:42']);
  });

  it.each([
    { alg: 'none', kid: 'key:2026-08', typ: commerceAccessTokenType },
    { alg: 'ES256', kid: 'key:2026-08', typ: commerceAccessTokenType },
    { alg: 'EdDSA', kid: 'key:2026-08', typ: 'JWT' },
    { alg: 'EdDSA', kid: 'unknown', typ: commerceAccessTokenType },
  ])('rejects an unadmitted header %#', (header) => {
    expect(() => verifyCommerceAccessToken(token({ header }), policy, now)).toThrow();
  });

  it('rejects wrong keys, modified payloads, and malformed signatures', () => {
    expect(() => verifyCommerceAccessToken(token({ key: secondary.privateKey }), policy, now))
      .toThrow('signature verification failed');
    const valid = token().split('.');
    valid[1] = encode({ ...defaultClaims, grants: ['avatar:attacker'] });
    expect(() => verifyCommerceAccessToken(valid.join('.'), policy, now))
      .toThrow('signature verification failed');
    expect(() => verifyCommerceAccessToken(token({ signature: Buffer.alloc(10) }), policy, now))
      .toThrow('signature');
  });

  it.each([
    { ...defaultClaims, iss: 'https://attacker.example' },
    { ...defaultClaims, aud: 'other-service' },
    { ...defaultClaims, iat: now + 31, nbf: now + 31 },
    { ...defaultClaims, exp: now - 31 },
    { ...defaultClaims, exp: now + 901 },
    { ...defaultClaims, scope: ['admin'] },
    { ...defaultClaims, grants: ['INVALID'] },
  ])('rejects hostile claims %#', (claims) => {
    expect(() => verifyCommerceAccessToken(token({ claims }), policy, now)).toThrow();
  });

  it('rejects unknown claims, duplicate scopes/grants, and invalid policy bounds', () => {
    expect(() => verifyCommerceAccessToken(token({
      claims: { ...defaultClaims, wallet: '0xsecret' },
    }), policy, now)).toThrow('claims');
    expect(() => verifyCommerceAccessToken(token({
      claims: { ...defaultClaims, scope: ['asset:read', 'asset:read'] },
    }), policy, now)).toThrow('duplicate');
    expect(() => verifyCommerceAccessToken(token({
      claims: { ...defaultClaims, grants: ['avatar:banana', 'avatar:banana'] },
    }), policy, now)).toThrow('duplicate');
    expect(() => verifyCommerceAccessToken(token({
      claims: { ...defaultClaims, catalogVersions: ['catalog:42', 'catalog:42'] },
    }), policy, now)).toThrow('duplicate');
    expect(() => verifyCommerceAccessToken(token({
      claims: { ...defaultClaims, catalogVersion: 'catalog:legacy' },
    }), policy, now)).toThrow('claims');
    expect(() => verifyCommerceAccessToken(token(), {
      ...policy,
      clockSkewSeconds: 121,
    }, now)).toThrow('policy');
  });

  it('rejects malformed and oversized compact tokens before parsing claims', () => {
    expect(() => verifyCommerceAccessToken('not-a-jwt', policy, now)).toThrow('Invalid');
    expect(() => verifyCommerceAccessToken(`${'a'.repeat(8_193)}.x.y`, policy, now)).toThrow('Invalid');
    const valid = token().split('.');
    valid[0] = `${valid[0]}=`;
    expect(() => verifyCommerceAccessToken(valid.join('.'), policy, now)).toThrow('header');
  });
});
