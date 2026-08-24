import { parseAssetGrant, type AssetGrant } from './commerce';

export interface CommerceReconciliationSnapshot {
  schemaVersion: 1;
  snapshotId: string;
  accountId: string;
  generatedAt: string;
  cursor: string;
  grants: AssetGrant[];
  pendingOrderIds: string[];
  revokedGrantIds: string[];
}

export interface CommerceSessionMaterial {
  schemaVersion: 1;
  accountId: string;
  sessionId: string;
  installationId: string;
  refreshCredential: string;
  refreshGeneration: number;
  refreshExpiresAt: string;
  accessToken: string;
  offlineLease: string;
  serverTimeSeconds: number;
  reconciliation: CommerceReconciliationSnapshot;
}

export interface CleanDeviceRestoreRequest {
  schemaVersion: 1;
  installationId: string;
  recoveryCode: string;
  proofKeyVerifier: string;
  idempotencyKey: string;
}

export interface CommerceSessionRefreshRequest {
  schemaVersion: 1;
  sessionId: string;
  installationId: string;
  refreshCredential: string;
  refreshGeneration: number;
  rotationId: string;
  reconciliationCursor: string;
}

const identifierPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const opaqueCredentialPattern = /^[A-Za-z0-9_-]+$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function exactRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid commerce recovery ${name}.`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((field) => !fields.includes(field))) {
    throw new Error(`Invalid commerce recovery ${name}.`);
  }
  return record;
}

function readString(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || value.trim() !== value) {
    throw new Error(`Invalid commerce recovery ${field}.`);
  }
  return value;
}

function readIdentifier(value: unknown, field: string): string {
  const identifier = readString(value, field, 128);
  if (!identifierPattern.test(identifier)) throw new Error(`Invalid commerce recovery ${field}.`);
  return identifier;
}

function readOpaqueCredential(value: unknown, field: string): string {
  const credential = readString(value, field, 512);
  if (credential.length < 32 || !opaqueCredentialPattern.test(credential)) {
    throw new Error(`Invalid commerce recovery ${field}.`);
  }
  return credential;
}

function readTimestamp(value: unknown, field: string): string {
  const timestamp = readString(value, field, 30);
  if (!timestampPattern.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`Invalid commerce recovery ${field}.`);
  }
  return timestamp;
}

function readGeneration(value: unknown, field: string, allowZero = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`Invalid commerce recovery ${field}.`);
  }
  return value;
}

function readUniqueIdentifiers(value: unknown, field: string, maximum = 1_000): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`Invalid commerce recovery ${field}.`);
  }
  const identifiers = value.map((entry) => readIdentifier(entry, field));
  if (new Set(identifiers).size !== identifiers.length) {
    throw new Error(`Invalid commerce recovery duplicate ${field}.`);
  }
  return identifiers;
}

export function parseCommerceReconciliationSnapshot(value: unknown): CommerceReconciliationSnapshot {
  const source = exactRecord(value, [
    'schemaVersion', 'snapshotId', 'accountId', 'generatedAt', 'cursor', 'grants',
    'pendingOrderIds', 'revokedGrantIds',
  ], 'reconciliation snapshot');
  if (source.schemaVersion !== 1 || !Array.isArray(source.grants) || source.grants.length > 1_000) {
    throw new Error('Invalid commerce recovery reconciliation snapshot.');
  }
  const accountId = readIdentifier(source.accountId, 'account ID');
  const grants = source.grants.map((entry) => parseAssetGrant(entry));
  if (new Set(grants.map((grant) => grant.grantId)).size !== grants.length
    || grants.some((grant) => grant.accountId !== accountId)) {
    throw new Error('Invalid commerce recovery reconciliation grants.');
  }
  const revokedGrantIds = readUniqueIdentifiers(source.revokedGrantIds, 'revoked grant IDs');
  if (revokedGrantIds.some((grantId) => grants.some((grant) => grant.grantId === grantId))) {
    throw new Error('Invalid commerce recovery contradictory grants.');
  }
  return {
    schemaVersion: 1,
    snapshotId: readIdentifier(source.snapshotId, 'snapshot ID'),
    accountId,
    generatedAt: readTimestamp(source.generatedAt, 'snapshot time'),
    cursor: readIdentifier(source.cursor, 'reconciliation cursor'),
    grants,
    pendingOrderIds: readUniqueIdentifiers(source.pendingOrderIds, 'pending order IDs'),
    revokedGrantIds,
  };
}

export function parseCommerceSessionMaterial(value: unknown): CommerceSessionMaterial {
  const source = exactRecord(value, [
    'schemaVersion', 'accountId', 'sessionId', 'installationId', 'refreshCredential',
    'refreshGeneration', 'refreshExpiresAt', 'accessToken', 'offlineLease',
    'serverTimeSeconds', 'reconciliation',
  ], 'session material');
  if (source.schemaVersion !== 1) throw new Error('Invalid commerce recovery session material.');
  const accountId = readIdentifier(source.accountId, 'account ID');
  const reconciliation = parseCommerceReconciliationSnapshot(source.reconciliation);
  const serverTimeSeconds = readGeneration(source.serverTimeSeconds, 'server time');
  const refreshExpiresAt = readTimestamp(source.refreshExpiresAt, 'refresh expiry');
  if (reconciliation.accountId !== accountId
    || Date.parse(reconciliation.generatedAt) > serverTimeSeconds * 1_000
    || Date.parse(refreshExpiresAt) <= serverTimeSeconds * 1_000) {
    throw new Error('Invalid commerce recovery session consistency.');
  }
  return {
    schemaVersion: 1,
    accountId,
    sessionId: readIdentifier(source.sessionId, 'session ID'),
    installationId: readIdentifier(source.installationId, 'installation ID'),
    refreshCredential: readOpaqueCredential(source.refreshCredential, 'refresh credential'),
    refreshGeneration: readGeneration(source.refreshGeneration, 'refresh generation'),
    refreshExpiresAt,
    accessToken: readString(source.accessToken, 'access token', 8_192),
    offlineLease: readString(source.offlineLease, 'offline lease', 32_768),
    serverTimeSeconds,
    reconciliation,
  };
}

export function parseCleanDeviceRestoreRequest(value: unknown): CleanDeviceRestoreRequest {
  const source = exactRecord(value, [
    'schemaVersion', 'installationId', 'recoveryCode', 'proofKeyVerifier', 'idempotencyKey',
  ], 'clean-device request');
  if (source.schemaVersion !== 1) throw new Error('Invalid commerce recovery clean-device request.');
  return {
    schemaVersion: 1,
    installationId: readIdentifier(source.installationId, 'installation ID'),
    recoveryCode: readOpaqueCredential(source.recoveryCode, 'recovery code'),
    proofKeyVerifier: readOpaqueCredential(source.proofKeyVerifier, 'proof-key verifier'),
    idempotencyKey: readIdentifier(source.idempotencyKey, 'idempotency key'),
  };
}

export function parseCommerceSessionRefreshRequest(value: unknown): CommerceSessionRefreshRequest {
  const source = exactRecord(value, [
    'schemaVersion', 'sessionId', 'installationId', 'refreshCredential',
    'refreshGeneration', 'rotationId', 'reconciliationCursor',
  ], 'session refresh request');
  if (source.schemaVersion !== 1) throw new Error('Invalid commerce recovery session refresh request.');
  return {
    schemaVersion: 1,
    sessionId: readIdentifier(source.sessionId, 'session ID'),
    installationId: readIdentifier(source.installationId, 'installation ID'),
    refreshCredential: readOpaqueCredential(source.refreshCredential, 'refresh credential'),
    refreshGeneration: readGeneration(source.refreshGeneration, 'refresh generation'),
    rotationId: readIdentifier(source.rotationId, 'rotation ID'),
    reconciliationCursor: readIdentifier(source.reconciliationCursor, 'reconciliation cursor'),
  };
}
