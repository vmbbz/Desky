import { createHash } from 'node:crypto';

export const commerceBackupTables = [
  'commerce_identities', 'commerce_installations', 'commerce_recovery_credentials',
  'commerce_quotes', 'commerce_orders', 'commerce_checkout_sessions', 'payment_attempts',
  'payment_authorizations', 'settlement_provider_references', 'settlement_observations',
  'entitlement_events', 'asset_grants', 'commerce_refresh_sessions', 'commerce_audit_events',
] as const;

export interface CommerceTableBackup {
  table: string;
  columns: string[];
  rows: unknown[][];
}

export interface CommerceBackup {
  schemaVersion: 1;
  createdAt: string;
  migrationVersion: number;
  tables: CommerceTableBackup[];
}

const generatedColumns = new Set([
  'settlement_observations.sequence',
  'entitlement_events.sequence',
  'commerce_audit_events.sequence',
]);
const bigintColumns = new Set(['commerce_refresh_sessions.generation']);

export function isGeneratedCommerceBackupColumn(table: string, column: string): boolean {
  return generatedColumns.has(`${table}.${column}`);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function logicalValue(table: string, column: string, value: unknown): unknown {
  if (!bigintColumns.has(`${table}.${column}`)) return value;
  if (typeof value === 'bigint' && value >= 0n) return value.toString();
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value)) return value;
  throw new Error(`Invalid commerce backup bigint (${table}.${column}).`);
}

function logicalTable(table: CommerceTableBackup): Record<string, unknown> {
  const admittedIndexes = table.columns.map((column, index) => ({ column, index }))
    .filter(({ column }) => !isGeneratedCommerceBackupColumn(table.table, column));
  return {
    table: table.table,
    columns: admittedIndexes.map(({ column }) => column),
    rows: table.rows.map((row) => admittedIndexes.map(({ column, index }) => (
      logicalValue(table.table, column, row[index])
    ))).sort((left, right) => canonical(left).localeCompare(canonical(right))),
  };
}

export function commerceLogicalTableDigest(table: CommerceTableBackup): string {
  return createHash('sha256').update(canonical(logicalTable(table))).digest('hex');
}

export function commerceLogicalDigest(backup: CommerceBackup): string {
  return createHash('sha256').update(canonical(backup.tables.map(logicalTable))).digest('hex');
}
