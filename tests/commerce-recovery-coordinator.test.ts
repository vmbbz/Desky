import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { commerceAccessTokenType } from '../src/main/commerce/access-token';
import { RotatingCommerceJwks } from '../src/main/commerce/jwks';
import { commerceOfflineLeaseType } from '../src/main/commerce/offline-lease';
import { CommerceRecoveryCoordinator } from '../src/main/commerce/recovery-coordinator';
import { CommerceRefreshVault } from '../src/main/commerce/refresh-vault';
import {
  CommerceServiceClient,
  type CommerceApiRequest,
  type CommerceApiResponse,
  type CommerceApiTransport,
} from '../src/main/commerce/service-client';
import { SecureVault, type EncryptionProvider } from '../src/main/openclaw/secure-vault';
import type { CommerceSessionMaterial } from '../src/shared/commerce-recovery';

const directories: string[] = [];
const now = 1_787_600_000;
const issuer = 'https://commerce.desky.example';
const keyPair = generateKeyPairSync('ed25519');
const encryption: EncryptionProvider = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from([...Buffer.from(value, 'utf8')].map((byte) => byte ^ 0xa5)),
  decryptString: (value) => Buffer.from([...value].map((byte) => byte ^ 0xa5)).toString('utf8'),
};

function temporaryVault(): CommerceRefreshVault {
  const directory = mkdtempSync(join(tmpdir(), 'desky-recovery-coordinator-'));
  directories.push(directory);
  return new CommerceRefreshVault(new SecureVault(join(directory, 'vault.json'), encryption));
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signedToken(type: string, claims: Record<string, unknown>): string {
  const header = encode({ alg: 'EdDSA', kid: 'key:commerce', typ: type });
  const payload = encode(claims);
  const signature = sign(null, Buffer.from(`${header}.${payload}`, 'ascii'), keyPair.privateKey);
  return `${header}.${payload}.${signature.toString('base64url')}`;
}

function material(input: {
  generation?: number;
  credential?: string;
  serverTime?: number;
  accessSubject?: string;
  offlineSubject?: string;
  multipleCatalogs?: boolean;
} = {}): CommerceSessionMaterial {
  const generation = input.generation ?? 1;
  const serverTime = input.serverTime ?? now;
  const grant = {
    schemaVersion: 1 as const,
    grantId: 'grant:1',
    accountId: 'account:1',
    productId: 'avatar:banana',
    productRevision: 1,
    avatarRevisionIds: ['banana:revision:1'],
    entitlementEventId: 'event:1',
    catalogVersion: 'catalog:1',
    state: 'active' as const,
    issuedAt: new Date(now * 1_000).toISOString(),
  };
  const grants = input.multipleCatalogs ? [grant, {
    ...grant,
    grantId: 'grant:2',
    productId: 'avatar:toothpaste',
    avatarRevisionIds: ['toothpaste:revision:1'],
    entitlementEventId: 'event:2',
    catalogVersion: 'catalog:paid:1',
  }] : [grant];
  return {
    schemaVersion: 1,
    accountId: 'account:1',
    sessionId: 'session:1',
    installationId: 'install:1',
    refreshCredential: input.credential ?? 'r'.repeat(43),
    refreshGeneration: generation,
    refreshExpiresAt: new Date((serverTime + 30 * 86_400) * 1_000).toISOString(),
    accessToken: signedToken(commerceAccessTokenType, {
      iss: issuer,
      aud: 'desky-assets',
      sub: input.accessSubject ?? 'account:1',
      iat: serverTime,
      nbf: serverTime,
      exp: serverTime + 600,
      jti: `access:${generation}`,
      scope: ['catalog:read', 'asset:read'],
      grants: grants.map((entry) => entry.productId),
      catalogVersions: [...new Set(grants.map((entry) => entry.catalogVersion))],
    }),
    offlineLease: signedToken(commerceOfflineLeaseType, {
      iss: issuer,
      aud: 'desky-offline',
      sub: input.offlineSubject ?? 'account:1',
      installationId: 'install:1',
      iat: serverTime,
      nbf: serverTime,
      exp: serverTime + 72 * 60 * 60,
      jti: `lease:${generation}`,
      grants: grants.map((entry) => ({
        grantId: entry.grantId,
        productId: entry.productId,
        productRevision: entry.productRevision,
        avatarRevisionIds: entry.avatarRevisionIds,
        catalogVersion: entry.catalogVersion,
      })),
    }),
    serverTimeSeconds: serverTime,
    reconciliation: {
      schemaVersion: 1,
      snapshotId: `snapshot:${generation}`,
      accountId: 'account:1',
      generatedAt: new Date(serverTime * 1_000).toISOString(),
      cursor: `cursor:${generation}`,
      grants,
      pendingOrderIds: generation === 1 ? ['order:pending'] : [],
      revokedGrantIds: [],
    },
  };
}

class QueueTransport implements CommerceApiTransport {
  readonly requests: CommerceApiRequest[] = [];

  constructor(private readonly responses: CommerceSessionMaterial[]) {}

  async request(input: CommerceApiRequest): Promise<CommerceApiResponse> {
    this.requests.push(input);
    const response = this.responses.shift();
    if (!response) throw new Error('No response configured.');
    return {
      status: 200,
      finalUrl: input.url,
      contentType: 'application/json',
      body: JSON.stringify(response),
    };
  }
}

function coordinator(
  responses: CommerceSessionMaterial[],
  vault = temporaryVault(),
  jwksUnavailable = false,
): {
  coordinator: CommerceRecoveryCoordinator;
  transport: QueueTransport;
  vault: CommerceRefreshVault;
} {
  const transport = new QueueTransport(responses);
  const client = new CommerceServiceClient({ serviceOrigin: issuer, transport });
  const jwks = new RotatingCommerceJwks({
    loader: {
      load: async () => {
        if (jwksUnavailable) throw new Error('offline');
        return {
          keys: new Map([['key:commerce', keyPair.publicKey]]),
          maxAgeSeconds: 300,
        };
      },
    },
  });
  return {
    coordinator: new CommerceRecoveryCoordinator({ client, vault, jwks, issuer }),
    transport,
    vault,
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('commerce clean-device recovery coordinator', () => {
  it('verifies restore material before persisting, rotates once, and reconciles current grants', async () => {
    const test = coordinator([
      material({ multipleCatalogs: true }),
      material({ generation: 2, credential: 's'.repeat(43), serverTime: now + 60,
        multipleCatalogs: true }),
    ]);
    const restored = await test.coordinator.restoreCleanDevice({
      schemaVersion: 1,
      installationId: 'install:1',
      recoveryCode: 'c'.repeat(43),
      proofKeyVerifier: 'p'.repeat(43),
      idempotencyKey: 'restore:1',
    }, now, 1_000);
    expect(restored).toMatchObject({
      accountId: 'account:1',
      pendingOrderIds: ['order:pending'],
    });
    expect(restored.grants.map((entry) => entry.grantId)).toEqual(['grant:1', 'grant:2']);
    expect(test.vault.load()?.refreshGeneration).toBe(1);

    const refreshed = await test.coordinator.refresh(now + 60, 61_000);
    expect(refreshed.pendingOrderIds).toEqual([]);
    expect(test.vault.load()).toMatchObject({
      refreshGeneration: 2,
      refreshCredential: 's'.repeat(43),
      reconciliationCursor: 'cursor:2',
    });
    const refreshRequest = JSON.parse(test.transport.requests[1].body) as Record<string, unknown>;
    expect(refreshRequest).toMatchObject({
      refreshGeneration: 1,
      rotationId: 'rotate:session:1:2',
      reconciliationCursor: 'cursor:1',
    });

    const offline = await test.coordinator.evaluateOfflineAccess(now + 61, 62_000);
    expect(offline.status).toBe('valid');

    const restartedOffline = coordinator([], test.vault, true);
    expect((await restartedOffline.coordinator.evaluateOfflineAccess(now + 62, 63_000)).status)
      .toBe('valid');
  });

  it('does not persist a clean-device response whose signed authorization disagrees with reconciliation', async () => {
    const test = coordinator([material({ accessSubject: 'account:other' })]);
    await expect(test.coordinator.restoreCleanDevice({
      schemaVersion: 1,
      installationId: 'install:1',
      recoveryCode: 'c'.repeat(43),
      proofKeyVerifier: 'p'.repeat(43),
      idempotencyKey: 'restore:1',
    }, now, 1_000)).rejects.toThrow('does not match reconciliation');
    expect(test.vault.load()).toBeUndefined();
  });

  it('rejects stale refresh generation and leaves the last valid credential untouched', async () => {
    const test = coordinator([material(), material({ credential: 's'.repeat(43), serverTime: now + 60 })]);
    await test.coordinator.restoreCleanDevice({
      schemaVersion: 1,
      installationId: 'install:1',
      recoveryCode: 'c'.repeat(43),
      proofKeyVerifier: 'p'.repeat(43),
      idempotencyKey: 'restore:1',
    }, now, 1_000);
    await expect(test.coordinator.refresh(now + 60, 61_000)).rejects.toThrow('does not match');
    expect(test.vault.load()).toMatchObject({
      refreshGeneration: 1,
      refreshCredential: 'r'.repeat(43),
    });
  });
});
