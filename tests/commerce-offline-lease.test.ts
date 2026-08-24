import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  commerceOfflineLeaseType,
  createTrustedTimeCheckpoint,
  evaluateCommerceOfflineLease,
  verifyCommerceOfflineLease,
  type CommerceOfflineLeaseClaims,
} from '../src/main/commerce/offline-lease';
import {
  RotatingCommerceJwks,
  type CommerceJwksLoader,
} from '../src/main/commerce/jwks';

const now = 1_787_600_000;
const keyPair = generateKeyPairSync('ed25519');
const otherKeyPair = generateKeyPairSync('ed25519');

const claims: CommerceOfflineLeaseClaims = {
  iss: 'https://commerce.desky.example',
  aud: 'desky-offline',
  sub: 'account:1',
  installationId: 'install:1',
  iat: now,
  nbf: now,
  exp: now + 72 * 60 * 60,
  jti: 'lease:1',
  grants: [{
    grantId: 'grant:1',
    productId: 'avatar:banana',
    productRevision: 1,
    avatarRevisionIds: ['banana:revision:1'],
    catalogVersion: 'catalog:1',
  }],
};

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function lease(input: {
  claims?: Record<string, unknown>;
  header?: Record<string, unknown>;
  key?: KeyObject;
} = {}): string {
  const header = encode(input.header ?? {
    alg: 'EdDSA',
    kid: 'key:lease',
    typ: commerceOfflineLeaseType,
  });
  const encodedClaims = encode(input.claims ?? claims);
  const signature = sign(
    null,
    Buffer.from(`${header}.${encodedClaims}`, 'ascii'),
    input.key ?? keyPair.privateKey,
  );
  return `${header}.${encodedClaims}.${signature.toString('base64url')}`;
}

function jwks(): RotatingCommerceJwks {
  const loader: CommerceJwksLoader = {
    load: async () => ({
      keys: new Map([['key:lease', keyPair.publicKey]]),
      maxAgeSeconds: 300,
    }),
  };
  return new RotatingCommerceJwks({ loader });
}

describe('commerce offline lease', () => {
  it('verifies an installation-bound, revision-exact 72-hour Ed25519 lease', () => {
    expect(verifyCommerceOfflineLease(lease(), 'install:1', {
      issuer: claims.iss,
      audience: 'desky-offline',
      keys: new Map([['key:lease', keyPair.publicKey]]),
    }, now + 1).grants).toEqual(claims.grants);
  });

  it('rejects wrong installation, tampering, wrong key, excessive lifetime, and unknown claims', () => {
    const policy = {
      issuer: claims.iss,
      audience: 'desky-offline' as const,
      keys: new Map([['key:lease', keyPair.publicKey]]),
    };
    expect(() => verifyCommerceOfflineLease(lease(), 'install:other', policy, now + 1))
      .toThrow('policy');
    const tampered = lease().split('.');
    tampered[1] = encode({ ...claims, sub: 'account:attacker' });
    expect(() => verifyCommerceOfflineLease(tampered.join('.'), 'install:1', policy, now + 1))
      .toThrow('signature');
    expect(() => verifyCommerceOfflineLease(
      lease({ key: otherKeyPair.privateKey }),
      'install:1',
      policy,
      now + 1,
    )).toThrow('signature');
    expect(() => verifyCommerceOfflineLease(lease({
      claims: { ...claims, exp: now + 72 * 60 * 60 + 1 },
    }), 'install:1', policy, now + 1)).toThrow('policy');
    expect(() => verifyCommerceOfflineLease(lease({
      claims: { ...claims, wallet: 'secret' },
    }), 'install:1', policy, now + 1)).toThrow('claims');
  });

  it('uses monotonic elapsed time and reports expiry instead of extending a rolled-back clock', async () => {
    const checkpoint = createTrustedTimeCheckpoint(now, now, 1_000);
    const valid = await evaluateCommerceOfflineLease(
      lease(),
      'install:1',
      { issuer: claims.iss, jwks: jwks() },
      checkpoint,
      now + 10,
      11_000,
    );
    expect(valid.status).toBe('valid');

    const expired = await evaluateCommerceOfflineLease(
      lease(),
      'install:1',
      { issuer: claims.iss, jwks: jwks(), clockSkewSeconds: 0 },
      checkpoint,
      now,
      72 * 60 * 60 * 1_000 + 2_000,
    );
    expect(expired.status).toBe('expired');

    const rollback = await evaluateCommerceOfflineLease(
      lease(),
      'install:1',
      { issuer: claims.iss, jwks: jwks(), maximumBackwardSkewSeconds: 120 },
      checkpoint,
      now - 121,
      2_000,
    );
    expect(rollback).toMatchObject({ status: 'reconnect-required', reason: 'clock-anomaly' });

    const reboot = await evaluateCommerceOfflineLease(
      lease(),
      'install:1',
      { issuer: claims.iss, jwks: jwks() },
      checkpoint,
      now + 60,
      999,
    );
    expect(reboot).toMatchObject({ status: 'reconnect-required', reason: 'clock-anomaly' });
  });

  it('rejects server-time rollback when refreshing the trusted checkpoint', () => {
    const previous = createTrustedTimeCheckpoint(now, now, 1_000);
    expect(() => createTrustedTimeCheckpoint(now - 1, now + 1, 2_000, previous))
      .toThrow('moved backwards');
  });
});
