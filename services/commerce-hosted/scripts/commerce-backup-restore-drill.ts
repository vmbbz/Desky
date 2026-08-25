import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { newDb } from 'pg-mem';
import { Pool } from 'pg';

import { supabasePoolConfiguration } from '../src/database-config';

interface TableBackup { table: string; columns: string[]; rows: unknown[][] }
interface CommerceBackup { schemaVersion: 1; createdAt: string; migrationVersion: number; tables: TableBackup[] }

const tables = [
  'commerce_identities', 'commerce_installations', 'commerce_recovery_credentials',
  'commerce_quotes', 'commerce_orders', 'commerce_checkout_sessions', 'payment_attempts',
  'payment_authorizations', 'settlement_provider_references', 'settlement_observations',
  'entitlement_events', 'asset_grants', 'commerce_refresh_sessions', 'commerce_audit_events',
] as const;
const generatedColumns = new Set(['settlement_observations.sequence', 'entitlement_events.sequence', 'commerce_audit_events.sequence']);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function logicalDigest(backup: CommerceBackup): string {
  return createHash('sha256').update(canonical(backup.tables.map((table) => ({
    table: table.table,
    columns: table.columns.filter((column) => !generatedColumns.has(`${table.table}.${column}`)),
    rows: table.rows.map((row) => row.filter((_, index) => !generatedColumns.has(`${table.table}.${table.columns[index]}`)))
      .sort((left, right) => canonical(left).localeCompare(canonical(right))),
  })))).digest('hex');
}

function backupKey(): Buffer {
  const value = process.env.DESKY_COMMERCE_BACKUP_KEY;
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('Commerce backup key is not configured.');
  const key = Buffer.from(value, 'base64url');
  if (key.byteLength !== 32 || key.toString('base64url') !== value) throw new Error('Commerce backup key is not configured.');
  return key;
}

async function exportLive(): Promise<CommerceBackup> {
  const pool = new Pool({ ...supabasePoolConfiguration(), max: 1, application_name: 'desky-commerce-backup' });
  try {
    const version = await pool.query('SELECT COALESCE(MAX(version),0) AS version FROM desky_commerce.commerce_schema_migrations');
    const migrationVersion = Number(version.rows[0]?.version);
    if (migrationVersion !== 2) throw new Error('Commerce backup schema version is not admitted.');
    const exported: TableBackup[] = [];
    for (const table of tables) {
      const metadata = await pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'desky_commerce' AND table_name = $1 ORDER BY ordinal_position
      `, [table]);
      const columns = metadata.rows.map((row) => String(row.column_name));
      if (columns.length === 0) throw new Error(`Commerce backup table ${table} is unavailable.`);
      const result = await pool.query(`SELECT * FROM desky_commerce.${table}`);
      exported.push({
        table,
        columns,
        rows: result.rows.map((row) => columns.map((column) => row[column] instanceof Date
          ? row[column].toISOString() : row[column])),
      });
    }
    return { schemaVersion: 1, createdAt: new Date().toISOString(), migrationVersion, tables: exported };
  } finally { await pool.end(); }
}

function encrypt(backup: CommerceBackup): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', backupKey(), iv);
  const body = Buffer.from(JSON.stringify(backup), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(body), cipher.final()]);
  const envelope = {
    format: 'desky-commerce-backup+a256gcm', version: 1,
    iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
  return Buffer.from(JSON.stringify(envelope), 'utf8');
}

function decrypt(bytes: Buffer): CommerceBackup {
  const envelope = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
  if (envelope.format !== 'desky-commerce-backup+a256gcm' || envelope.version !== 1
    || typeof envelope.iv !== 'string' || typeof envelope.tag !== 'string'
    || typeof envelope.ciphertext !== 'string') throw new Error('Invalid commerce backup envelope.');
  const decipher = createDecipheriv('aes-256-gcm', backupKey(), Buffer.from(envelope.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final(),
  ]);
  const backup = JSON.parse(plaintext.toString('utf8')) as CommerceBackup;
  if (backup.schemaVersion !== 1 || backup.migrationVersion !== 2
    || backup.tables.length !== tables.length
    || backup.tables.some((table, index) => table.table !== tables[index])) {
    throw new Error('Invalid commerce backup payload.');
  }
  return backup;
}

async function isolatedRestore(backup: CommerceBackup): Promise<void> {
  const memory = newDb();
  const migrationsDirectory = resolve(process.cwd(), 'supabase', 'migrations');
  for (const name of (await readdir(migrationsDirectory)).filter((entry) => entry.endsWith('.sql')).sort()) {
    const migration = await readFile(resolve(migrationsDirectory, name), 'utf8');
    const admitted = migration.split(';').map((statement) => statement.trim())
      .filter((statement) => statement && !/^(?:CREATE ROLE|GRANT|REVOKE)\b/.test(statement)).join(';\n');
    memory.public.none(`${admitted};`);
  }
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool();
  try {
    for (const table of backup.tables) {
      const admittedIndexes = table.columns.map((column, index) => ({ column, index }))
        .filter(({ column }) => !generatedColumns.has(`${table.table}.${column}`));
      for (const row of table.rows) {
        if (admittedIndexes.length === 0) continue;
        const placeholders = admittedIndexes.map((_, index) => `$${index + 1}`).join(',');
        await pool.query(`INSERT INTO desky_commerce.${table.table} (${admittedIndexes.map(({ column }) => column).join(',')}) VALUES (${placeholders})`,
          admittedIndexes.map(({ index }) => row[index]));
      }
    }
    const restoredTables: TableBackup[] = [];
    for (const table of backup.tables) {
      const admittedColumns = table.columns.filter((column) => !generatedColumns.has(`${table.table}.${column}`));
      const result = await pool.query(`SELECT ${admittedColumns.join(',')} FROM desky_commerce.${table.table}`);
      restoredTables.push({ table: table.table, columns: admittedColumns,
        rows: result.rows.map((row: Record<string, unknown>) => admittedColumns.map((column) => row[column] instanceof Date
          ? (row[column] as Date).toISOString() : row[column])) });
    }
    const restored: CommerceBackup = { ...backup, tables: restoredTables };
    if (logicalDigest(restored) !== logicalDigest(backup)) throw new Error('Commerce backup restore digest mismatch.');
  } finally { await pool.end(); }
}

const verifyOnly = process.argv[2] === '--verify';
const output = verifyOnly ? process.argv[3] : process.argv[2];
if (!output) throw new Error('Commerce backup path is required.');
const backup = verifyOnly ? decrypt(await readFile(output)) : await exportLive();
const encrypted = verifyOnly ? await readFile(output) : encrypt(backup);
if (!verifyOnly) await writeFile(output, encrypted, { flag: 'wx', mode: 0o600 });
const restored = decrypt(encrypted);
await isolatedRestore(restored);
process.stdout.write(JSON.stringify({
  schemaVersion: backup.migrationVersion,
  encryptedBytes: encrypted.byteLength,
  encryptedSha256: createHash('sha256').update(encrypted).digest('hex'),
  logicalSha256: logicalDigest(backup),
  tables: backup.tables.map((table) => ({ table: table.table, rows: table.rows.length })),
  restore: 'verified',
}));
