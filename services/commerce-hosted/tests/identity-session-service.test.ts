import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { newDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';

import { verifyCommerceAccessToken } from '../../../src/main/commerce/access-token';
import { verifyCommerceOfflineLease } from '../../../src/main/commerce/offline-lease';
import { getBundledMarketplaceCatalog } from '../../../src/main/marketplace-catalog';
import { HostedCommerceIdentityService } from '../../../src/service/commerce/identity-session-service';
import { PostgresCommerceIdentityStore } from '../../../src/service/commerce/postgres-identity-store';
import { PostgresCheckoutLedger, type PostgresPool } from '../../../src/service/commerce/postgres-checkout-ledger';
import { HostedCommerceQuoteService } from '../../../src/service/commerce/quote-service';
import { baseSepoliaUsdc } from '../../../src/service/commerce/x402-base-sepolia';
import { CommerceTokenIssuer } from '../../../src/service/commerce/token-issuer';

const hostedRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(hostedRoot, '..', '..');
const origin = 'https://desky-checkout-testnet.netlify.app';
const now = new Date('2026-08-25T14:00:00.456Z');

async function stores(): Promise<{ identityStore: PostgresCommerceIdentityStore; ledger: PostgresCheckoutLedger }> {
  const memory = newDb();
  const migrationsDirectory = resolve(repositoryRoot, 'supabase', 'migrations');
  const migrations = (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort();
  for (const migrationName of migrations) {
    const migration = await readFile(resolve(migrationsDirectory, migrationName), 'utf8');
    const admitted = migration.split(';').map((statement) => statement.trim())
      .filter((statement) => statement && !/^(?:CREATE ROLE|GRANT|REVOKE)\b/.test(statement))
      .join(';\n');
    memory.public.none(`${admitted};`);
  }
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool();
  const admitted = pool as unknown as PostgresPool;
  return { identityStore: new PostgresCommerceIdentityStore(admitted), ledger: new PostgresCheckoutLedger(admitted) };
}

async function service() {
  const { identityStore, ledger } = await stores();
  const pair = generateKeyPairSync('ed25519');
  const tokens = new CommerceTokenIssuer({ issuer: origin, keyId: 'key:2026-08', privateKey: pair.privateKey });
  const identity = new HostedCommerceIdentityService(identityStore, {
    authenticate: async () => ({ provider: 'supabase', subject: 'd9428888-122b-11e1-b85c-61cd3cbb3210' }),
  }, tokens, {
    credentialPepper: Buffer.alloc(32, 0x5a),
    catalogVersion: 'desky-foundation:2',
    freeAvatars: getBundledMarketplaceCatalog().avatars,
    now: () => new Date(now),
  });
  return { identityStore, ledger, identity, tokens };
}

describe('hosted authenticated identity and recovery lifecycle', () => {
  it('issues access and offline authorization across multiple admitted catalog revisions', () => {
    const pair = generateKeyPairSync('ed25519');
    const tokens = new CommerceTokenIssuer({
      issuer: origin, keyId: 'key:multi-catalog', privateKey: pair.privateKey,
    });
    const issued = tokens.issue({
      accountId: 'account:multi', installationId: 'install:multi', sessionId: 'session:multi',
      nowSeconds: Math.floor(now.getTime() / 1_000),
      reconciliation: {
        schemaVersion: 1, snapshotId: 'snapshot:multi', accountId: 'account:multi',
        generatedAt: now.toISOString(), cursor: 'cursor:multi', pendingOrderIds: [],
        revokedGrantIds: [], grants: [
          {
            schemaVersion: 1, grantId: 'grant:free', accountId: 'account:multi',
            productId: 'avatar.milk', productRevision: 1, avatarRevisionIds: ['milk:revision:1'],
            entitlementEventId: 'event:free', catalogVersion: 'desky-foundation:2',
            state: 'active', issuedAt: now.toISOString(),
          },
          {
            schemaVersion: 1, grantId: 'grant:paid', accountId: 'account:multi',
            productId: 'avatar.toothpaste', productRevision: 1,
            avatarRevisionIds: ['toothpaste:revision:1'], entitlementEventId: 'event:paid',
            catalogVersion: 'desky-paid-pilot:1', state: 'active', issuedAt: now.toISOString(),
          },
        ],
      },
    });
    const access = verifyCommerceAccessToken(issued.accessToken, {
      issuer: origin, audience: 'desky-assets', keys: new Map([[tokens.keyId, tokens.publicKey]]),
    }, Math.floor(now.getTime() / 1_000));
    expect(access.grants).toEqual(['avatar.milk', 'avatar.toothpaste']);
    expect(access.catalogVersions).toEqual(['desky-foundation:2', 'desky-paid-pilot:1']);
    const lease = verifyCommerceOfflineLease(issued.offlineLease, 'install:multi', {
      issuer: origin, audience: 'desky-offline', keys: new Map([[tokens.keyId, tokens.publicKey]]),
    }, Math.floor(now.getTime() / 1_000));
    expect(lease.grants.map((grant) => grant.catalogVersion).sort())
      .toEqual(['desky-foundation:2', 'desky-paid-pilot:1']);
  });

  it('issues verified free grants, replays identity safely, rotates refresh, and consumes recovery once', async () => {
    const test = await service();
    const verifier = 'v'.repeat(43);
    const request = {
      schemaVersion: 1 as const,
      installationId: 'install:primary',
      proofKeyChallenge: createHash('sha256').update(verifier).digest('base64url'),
      idempotencyKey: 'identity:primary',
    };
    const first = await test.identity.createIdentitySession(request, 't'.repeat(64), 'correlation:1');
    const replay = await test.identity.createIdentitySession(request, 't'.repeat(64), 'correlation:2');
    expect(replay.recoveryCode).toBe(first.recoveryCode);
    expect(replay.session.refreshCredential).toBe(first.session.refreshCredential);
    expect(first.session.reconciliation.grants).toHaveLength(3);
    const access = verifyCommerceAccessToken(first.session.accessToken, {
      issuer: origin, audience: 'desky-assets', keys: new Map([[test.tokens.keyId, test.tokens.publicKey]]),
    }, Math.floor(now.getTime() / 1_000));
    expect(access.scope).toContain('commerce:write');
    expect([...access.grants].sort()).toEqual(['avatar.milk', 'avatar.cool-banana', 'avatar.astronaut'].sort());
    expect(verifyCommerceOfflineLease(first.session.offlineLease, 'install:primary', {
      issuer: origin, audience: 'desky-offline', keys: new Map([[test.tokens.keyId, test.tokens.publicKey]]),
    }, first.session.serverTimeSeconds).grants).toHaveLength(3);

    const refreshed = await test.identity.refreshSession({
      schemaVersion: 1, sessionId: first.session.sessionId, installationId: 'install:primary',
      refreshCredential: first.session.refreshCredential, refreshGeneration: 1,
      rotationId: 'rotate:primary:2', reconciliationCursor: first.session.reconciliation.cursor,
    });
    expect(refreshed.refreshGeneration).toBe(2);
    const refreshReplay = await test.identity.refreshSession({
      schemaVersion: 1, sessionId: first.session.sessionId, installationId: 'install:primary',
      refreshCredential: first.session.refreshCredential, refreshGeneration: 1,
      rotationId: 'rotate:primary:2', reconciliationCursor: first.session.reconciliation.cursor,
    });
    expect(refreshReplay.refreshCredential).toBe(refreshed.refreshCredential);

    const restored = await test.identity.restoreCleanDevice({
      schemaVersion: 1, installationId: 'install:restored', recoveryCode: first.recoveryCode,
      proofKeyVerifier: verifier, idempotencyKey: 'restore:clean:1',
    });
    expect(restored.installationId).toBe('install:restored');
    await expect(test.identity.restoreCleanDevice({
      schemaVersion: 1, installationId: 'install:attacker', recoveryCode: first.recoveryCode,
      proofKeyVerifier: verifier, idempotencyKey: 'restore:clean:2',
    })).rejects.toThrow('authentication-failed');
  });

  it('enforces a durable request window without retaining the raw client key', async () => {
    const test = await service();
    expect(await test.identityStore.admitRateLimit('http:hashed', now.toISOString(), 2, 60)).toBe(true);
    expect(await test.identityStore.admitRateLimit('http:hashed', now.toISOString(), 2, 60)).toBe(true);
    expect(await test.identityStore.admitRateLimit('http:hashed', now.toISOString(), 2, 60)).toBe(false);
  });

  it('creates an authenticated server-authoritative quote/order and replays it exactly', async () => {
    const test = await service();
    const session = await test.identity.createIdentitySession({
      schemaVersion: 1, installationId: 'install:quote', proofKeyChallenge: 'p'.repeat(43),
      idempotencyKey: 'identity:quote',
    }, 't'.repeat(64), 'correlation:quote');
    const quotes = new HostedCommerceQuoteService(test.ledger, test.identity, {
      schemaVersion: 1, offerId: 'offer:pilot', offerRevision: 1,
      productId: 'avatar:pilot', productRevision: 1,
      avatarRevisionIds: ['pilot:revision:1'], catalogVersion: 'catalog:pilot:1',
      regions: ['ZA'], currency: 'USDC', amountAtomic: '10000',
      recipient: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
    }, () => new Date(now));
    const request = {
      schemaVersion: 1 as const, installationId: 'install:quote', offerId: 'offer:pilot',
      region: 'ZA', idempotencyKey: 'quote:pilot:1',
    };
    const first = await quotes.createQuote(request, session.session.accessToken);
    const replay = await quotes.createQuote(request, session.session.accessToken);
    expect(replay).toEqual(first);
    expect(first.quote).toMatchObject({
      amountAtomic: '10000', asset: baseSepoliaUsdc, region: 'ZA',
      releaseProfile: 'windows-direct', provider: 'x402-base',
    });
    expect(first.order.state).toBe('created');
  });
});
