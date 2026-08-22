import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SecureVault, type EncryptionProvider } from '../src/main/openclaw/secure-vault';

const temporaryDirectories: string[] = [];

const encryption: EncryptionProvider = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
  decryptString: (value) => value.toString('utf8').replace(/^encrypted:/, ''),
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('SecureVault', () => {
  it('persists encrypted JSON without plaintext secrets', () => {
    const directory = mkdtempSync(join(tmpdir(), 'desky-vault-test-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'vault.json');
    const vault = new SecureVault(path, encryption);
    vault.set('profile', { token: 'super-secret-token' });

    expect(vault.get('profile')).toEqual({ token: 'super-secret-token' });
    expect(readFileSync(path, 'utf8')).not.toContain('super-secret-token');
  });

  it('fails closed when operating-system encryption is unavailable', () => {
    const directory = mkdtempSync(join(tmpdir(), 'desky-vault-test-'));
    temporaryDirectories.push(directory);
    const vault = new SecureVault(join(directory, 'vault.json'), {
      ...encryption,
      isEncryptionAvailable: () => false,
    });
    expect(() => vault.set('profile', { token: 'secret' })).toThrow(/unavailable/);
  });
});
