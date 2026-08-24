import type { SecureVault } from '../openclaw/secure-vault';

export interface CommerceTrustedTimeCheckpoint {
  version: 1;
  serverTimeSeconds: number;
  wallTimeSeconds: number;
  monotonicMilliseconds: number;
}

export interface StoredCommerceSession {
  version: 1;
  serviceOrigin: string;
  accountId: string;
  sessionId: string;
  installationId: string;
  refreshCredential: string;
  refreshGeneration: number;
  refreshExpiresAt: string;
  reconciliationCursor: string;
  offlineLease: string;
  offlineLeaseKeyId: string;
  offlineLeasePublicKey: string;
  trustedTime: CommerceTrustedTimeCheckpoint;
}

const commerceSessionVaultKey = 'commerce:session:v1';
const identifierPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const opaqueCredentialPattern = /^[A-Za-z0-9_-]{32,512}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function exactRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid stored commerce ${name}.`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((field) => !fields.includes(field))) {
    throw new Error(`Invalid stored commerce ${name}.`);
  }
  return record;
}

function readIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !identifierPattern.test(value)) {
    throw new Error(`Invalid stored commerce ${field}.`);
  }
  return value;
}

function readPositiveInteger(value: unknown, field: string, allowZero = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`Invalid stored commerce ${field}.`);
  }
  return value;
}

function readTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !timestampPattern.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Invalid stored commerce ${field}.`);
  }
  return value;
}

function readServiceOrigin(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid stored commerce service origin.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid stored commerce service origin.');
  }
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) {
    throw new Error('Invalid stored commerce service origin.');
  }
  return value;
}

export function parseCommerceTrustedTimeCheckpoint(value: unknown): CommerceTrustedTimeCheckpoint {
  const source = exactRecord(value, [
    'version', 'serverTimeSeconds', 'wallTimeSeconds', 'monotonicMilliseconds',
  ], 'trusted time');
  if (source.version !== 1) throw new Error('Invalid stored commerce trusted time.');
  return {
    version: 1,
    serverTimeSeconds: readPositiveInteger(source.serverTimeSeconds, 'server time'),
    wallTimeSeconds: readPositiveInteger(source.wallTimeSeconds, 'wall time'),
    monotonicMilliseconds: readPositiveInteger(
      source.monotonicMilliseconds,
      'monotonic time',
      true,
    ),
  };
}

export function parseStoredCommerceSession(value: unknown): StoredCommerceSession {
  const source = exactRecord(value, [
    'version', 'serviceOrigin', 'accountId', 'sessionId', 'installationId',
    'refreshCredential', 'refreshGeneration', 'refreshExpiresAt', 'reconciliationCursor',
    'offlineLease', 'offlineLeaseKeyId', 'offlineLeasePublicKey', 'trustedTime',
  ], 'session');
  if (source.version !== 1
    || typeof source.refreshCredential !== 'string'
    || !opaqueCredentialPattern.test(source.refreshCredential)
    || typeof source.offlineLease !== 'string'
    || source.offlineLease.length < 32
    || source.offlineLease.length > 32_768
    || typeof source.offlineLeasePublicKey !== 'string'
    || !/^[A-Za-z0-9_-]{40,512}$/.test(source.offlineLeasePublicKey)) {
    throw new Error('Invalid stored commerce session.');
  }
  return {
    version: 1,
    serviceOrigin: readServiceOrigin(source.serviceOrigin),
    accountId: readIdentifier(source.accountId, 'account ID'),
    sessionId: readIdentifier(source.sessionId, 'session ID'),
    installationId: readIdentifier(source.installationId, 'installation ID'),
    refreshCredential: source.refreshCredential,
    refreshGeneration: readPositiveInteger(source.refreshGeneration, 'refresh generation'),
    refreshExpiresAt: readTimestamp(source.refreshExpiresAt, 'refresh expiry'),
    reconciliationCursor: readIdentifier(source.reconciliationCursor, 'reconciliation cursor'),
    offlineLease: source.offlineLease,
    offlineLeaseKeyId: readIdentifier(source.offlineLeaseKeyId, 'offline lease key ID'),
    offlineLeasePublicKey: source.offlineLeasePublicKey,
    trustedTime: parseCommerceTrustedTimeCheckpoint(source.trustedTime),
  };
}

export class CommerceRefreshVault {
  constructor(private readonly vault: SecureVault) {}

  load(): StoredCommerceSession | undefined {
    const value = this.vault.get<unknown>(commerceSessionVaultKey);
    return value === undefined ? undefined : parseStoredCommerceSession(value);
  }

  replaceFromAuthenticatedRestore(value: StoredCommerceSession): StoredCommerceSession {
    const session = parseStoredCommerceSession(value);
    this.vault.set(commerceSessionVaultKey, session);
    return structuredClone(session);
  }

  commitRotation(expectedGeneration: number, value: StoredCommerceSession): StoredCommerceSession {
    const current = this.load();
    if (!current) throw new Error('Commerce refresh session is not available.');
    const next = parseStoredCommerceSession(value);
    if (current.refreshGeneration !== expectedGeneration
      || next.refreshGeneration !== expectedGeneration + 1
      || next.accountId !== current.accountId
      || next.sessionId !== current.sessionId
      || next.installationId !== current.installationId
      || next.serviceOrigin !== current.serviceOrigin
      || next.refreshCredential === current.refreshCredential
      || Date.parse(next.refreshExpiresAt) <= next.trustedTime.serverTimeSeconds * 1_000
      || next.trustedTime.serverTimeSeconds < current.trustedTime.serverTimeSeconds) {
      throw new Error('Commerce refresh rotation does not match the stored session.');
    }
    this.vault.set(commerceSessionVaultKey, next);
    return structuredClone(next);
  }

  clear(): void {
    this.vault.delete(commerceSessionVaultKey);
  }
}
