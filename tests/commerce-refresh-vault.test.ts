import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CommerceRefreshVault, type StoredCommerceSession } from '../src/main/commerce/refresh-vault';
import { SecureVault, type EncryptionProvider } from '../src/main/openclaw/secure-vault';

const directories: string[] = [];
const now = 1_787_600_000;
const encryption: EncryptionProvider = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from([...Buffer.from(value, 'utf8')].map((byte) => byte ^ 0x5a)),
  decryptString: (value) => Buffer.from([...value].map((byte) => byte ^ 0x5a)).toString('utf8'),
};

function path(): string {
  const directory = mkdtempSync(join(tmpdir(), 'desky-commerce-vault-'));
  directories.push(directory);
  return join(directory, 'vault.json');
}

function session(overrides: Partial<StoredCommerceSession> = {}): StoredCommerceSession {
  return {
    version: 1,
    serviceOrigin: 'https://commerce.desky.example',
    accountId: 'account:1',
    sessionId: 'session:1',
    installationId: 'install:1',
    refreshCredential: 'r'.repeat(43),
    refreshGeneration: 1,
    refreshExpiresAt: new Date((now + 86_400) * 1_000).toISOString(),
    reconciliationCursor: 'cursor:1',
    offlineLease: 'l'.repeat(64),
    offlineLeaseKeyId: 'key:lease',
    offlineLeasePublicKey: Buffer.alloc(44, 1).toString('base64url'),
    trustedTime: {
      version: 1,
      serverTimeSeconds: now,
      wallTimeSeconds: now,
      monotonicMilliseconds: 1_000,
    },
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('commerce refresh vault', () => {
  it('stores only encrypted session material and performs compare-and-swap rotation', () => {
    const filePath = path();
    const vault = new CommerceRefreshVault(new SecureVault(filePath, encryption));
    vault.replaceFromAuthenticatedRestore(session());
    expect(vault.load()).toEqual(session());
    expect(readFileSync(filePath, 'utf8')).not.toContain('r'.repeat(43));
    const rotated = session({
      refreshCredential: 's'.repeat(43),
      refreshGeneration: 2,
      reconciliationCursor: 'cursor:2',
      trustedTime: {
        version: 1,
        serverTimeSeconds: now + 10,
        wallTimeSeconds: now + 10,
        monotonicMilliseconds: 11_000,
      },
    });
    expect(vault.commitRotation(1, rotated)).toEqual(rotated);
    expect(vault.load()?.refreshGeneration).toBe(2);
  });

  it('rejects stale generation, identity drift, credential reuse, and server-time rollback', () => {
    const vault = new CommerceRefreshVault(new SecureVault(path(), encryption));
    vault.replaceFromAuthenticatedRestore(session());
    expect(() => vault.commitRotation(0, session({
      refreshCredential: 's'.repeat(43),
      refreshGeneration: 1,
    }))).toThrow('rotation');
    expect(() => vault.commitRotation(1, session({
      accountId: 'account:other',
      refreshCredential: 's'.repeat(43),
      refreshGeneration: 2,
    }))).toThrow('rotation');
    expect(() => vault.commitRotation(1, session({ refreshGeneration: 2 }))).toThrow('rotation');
    expect(() => vault.commitRotation(1, session({
      refreshCredential: 's'.repeat(43),
      refreshGeneration: 2,
      trustedTime: {
        version: 1,
        serverTimeSeconds: now - 1,
        wallTimeSeconds: now,
        monotonicMilliseconds: 2_000,
      },
    }))).toThrow('rotation');
  });

  it('clears the stored recovery session', () => {
    const vault = new CommerceRefreshVault(new SecureVault(path(), encryption));
    vault.replaceFromAuthenticatedRestore(session());
    vault.clear();
    expect(vault.load()).toBeUndefined();
  });
});
