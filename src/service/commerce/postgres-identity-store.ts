import { createHash } from 'node:crypto';

import { parseAssetGrant, parseCommerceOrder, parsePaymentAttempt, type AssetGrant, type EntitlementEvent } from '../../shared/commerce';
import { parsePaymentAuthorizationEvidence, parsePaymentSettlementObservation } from '../../shared/commerce-settlement';
import { parseCommerceReconciliationSnapshot, type CommerceReconciliationSnapshot } from '../../shared/commerce-recovery';
import type { CommerceAuditEvent, CommerceRefreshSessionRecord } from './repository';
import type { PostgresPool, PostgresQueryable, PostgresTransactionClient } from './postgres-checkout-ledger';

export interface CommerceIdentityBootstrapRecord {
  accountId: string;
  provider: 'supabase';
  providerSubjectDigest: string;
  installationId: string;
  recoveryId: string;
  recoveryCredentialDigest: string;
  proofKeyChallenge: string;
  idempotencyKey: string;
  recoveryExpiresAt: string;
  session: CommerceRefreshSessionRecord;
  freeEntitlements: Array<{ event: EntitlementEvent; grant: AssetGrant }>;
  audit: CommerceAuditEvent;
}

export interface CommerceRecoveryCredentialRecord {
  recoveryId: string;
  accountId: string;
  credentialDigest: string;
  proofKeyChallenge: string;
  idempotencyKey: string;
  expiresAt: string;
  consumedAt?: string;
  consumedIdempotencyKey?: string;
}

export interface CommerceOperationalSnapshot {
  schemaVersion: 1;
  migrationVersion: number;
  identities: number;
  activeRefreshSessions: number;
  pendingOrders: number;
  indeterminateSettlements: number;
  oldestIndeterminateAt?: string;
  generatedAt: string;
}

export interface CommerceReconciliationQueueItem {
  attemptId: string;
  orderId: string;
  authorizationId: string;
  attemptState: 'settlement-unknown' | 'settlement-pending' | 'settled';
  observationStatus: 'unknown' | 'pending' | 'settled';
  observedAt: string;
  ageSeconds: number;
}

function rowCount(result: { rowCount: number | null; rows: unknown[] }): number {
  return result.rowCount ?? result.rows.length;
}

function text(row: Record<string, unknown> | undefined, field: string): string | undefined {
  return typeof row?.[field] === 'string' ? row[field] as string : undefined;
}

function number(row: Record<string, unknown> | undefined, field: string): number {
  const value = row?.[field];
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('Invalid commerce operational count.');
  return parsed;
}

function sessionFromRow(row: Record<string, unknown> | undefined): CommerceRefreshSessionRecord | undefined {
  const payload = text(row, 'payload_text');
  if (!payload) return undefined;
  const value = JSON.parse(payload) as CommerceRefreshSessionRecord;
  if (!value || typeof value !== 'object' || typeof value.sessionId !== 'string'
    || typeof value.accountId !== 'string' || typeof value.installationId !== 'string'
    || typeof value.credentialDigest !== 'string' || !Number.isSafeInteger(value.generation)) {
    throw new Error('Invalid stored commerce refresh session.');
  }
  return structuredClone(value);
}

async function reconciliationWith(
  client: PostgresQueryable,
  accountId: string,
  now: string,
): Promise<CommerceReconciliationSnapshot> {
  const grantsResult = await client.query(`
    SELECT payload_text FROM desky_commerce.asset_grants
    WHERE account_id = $1 ORDER BY grant_id ASC
  `, [accountId]);
  const grants = grantsResult.rows.map((row) => parseAssetGrant(JSON.parse(String(row.payload_text))));
  const ordersResult = await client.query(`
    SELECT payload_text FROM desky_commerce.commerce_orders
    WHERE account_id = $1 ORDER BY order_id ASC
  `, [accountId]);
  const orders = ordersResult.rows.map((row) => parseCommerceOrder(JSON.parse(String(row.payload_text))));
  const pendingOrderIds = orders.filter((order) => ![
    'granted', 'cancelled', 'expired', 'refunded',
  ].includes(order.state)).map((order) => order.orderId);
  const revokedGrantIds = grants.filter((grant) => grant.state !== 'active'
    || (grant.expiresAt !== undefined && Date.parse(grant.expiresAt) <= Date.parse(now)))
    .map((grant) => grant.grantId);
  const active = grants.filter((grant) => !revokedGrantIds.includes(grant.grantId));
  const cursorDigest = createHash('sha256').update(JSON.stringify({
    grants: grants.map((grant) => [grant.grantId, grant.state]),
    pendingOrderIds,
  })).digest('hex');
  return parseCommerceReconciliationSnapshot({
    schemaVersion: 1,
    snapshotId: `snapshot:${cursorDigest.slice(0, 32)}`,
    accountId,
    generatedAt: now,
    cursor: `cursor:${cursorDigest}`,
    grants: active,
    pendingOrderIds,
    revokedGrantIds,
  });
}

export class PostgresCommerceIdentityStore {
  constructor(private readonly pool: PostgresPool) {}

  async bootstrap(record: CommerceIdentityBootstrapRecord): Promise<void> {
    await this.transaction(async (client) => {
      await client.query(`
        INSERT INTO desky_commerce.commerce_identities (
          account_id, provider, provider_subject_digest, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $4)
        ON CONFLICT (provider_subject_digest) DO UPDATE SET updated_at = EXCLUDED.updated_at
      `, [record.accountId, record.provider, record.providerSubjectDigest, record.audit.occurredAt]);
      const identity = await client.query(`
        SELECT account_id FROM desky_commerce.commerce_identities
        WHERE provider_subject_digest = $1
      `, [record.providerSubjectDigest]);
      if (identity.rows[0]?.account_id !== record.accountId) throw new Error('Commerce identity collision.');
      await client.query(`
        INSERT INTO desky_commerce.commerce_installations (
          account_id, installation_id, created_at, last_seen_at
        ) VALUES ($1, $2, $3, $3)
        ON CONFLICT (account_id, installation_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
      `, [record.accountId, record.installationId, record.audit.occurredAt]);
      await client.query(`
        INSERT INTO desky_commerce.commerce_recovery_credentials (
          recovery_id, account_id, credential_digest, proof_key_challenge,
          idempotency_key, expires_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (account_id, idempotency_key) DO NOTHING
      `, [record.recoveryId, record.accountId, record.recoveryCredentialDigest,
        record.proofKeyChallenge, record.idempotencyKey, record.recoveryExpiresAt,
        record.audit.occurredAt]);
      const recovery = await client.query(`
        SELECT recovery_id, credential_digest, proof_key_challenge, expires_at
        FROM desky_commerce.commerce_recovery_credentials
        WHERE account_id = $1 AND idempotency_key = $2
      `, [record.accountId, record.idempotencyKey]);
      if (recovery.rows[0]?.recovery_id !== record.recoveryId
        || recovery.rows[0]?.credential_digest !== record.recoveryCredentialDigest
        || recovery.rows[0]?.proof_key_challenge !== record.proofKeyChallenge) {
        throw new Error('Commerce recovery identity collision.');
      }
      for (const item of record.freeEntitlements) {
        await client.query(`
          INSERT INTO desky_commerce.entitlement_events (
            event_id, account_id, product_id, event_type, source, source_reference, payload_text
          ) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING
        `, [item.event.eventId, item.event.accountId, item.event.productId, item.event.type,
          item.event.source, item.event.sourceReference, JSON.stringify(item.event)]);
        await client.query(`
          INSERT INTO desky_commerce.asset_grants (
            grant_id, entitlement_event_id, account_id, product_id, payload_text
          ) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING
        `, [item.grant.grantId, item.grant.entitlementEventId, item.grant.accountId,
          item.grant.productId, JSON.stringify(item.grant)]);
      }
      await this.insertRefreshWith(client, record.session);
      await this.auditWith(client, record.audit);
    });
  }

  async getRefreshSession(sessionId: string): Promise<CommerceRefreshSessionRecord | undefined> {
    const result = await this.pool.query(`
      SELECT payload_text FROM desky_commerce.commerce_refresh_sessions WHERE session_id = $1
    `, [sessionId]);
    return sessionFromRow(result.rows[0]);
  }

  async rotateRefreshSession(input: {
    sessionId: string;
    expectedGeneration: number;
    expectedCredentialDigest: string;
    rotationId: string;
    next: CommerceRefreshSessionRecord;
    audit: CommerceAuditEvent;
  }): Promise<CommerceRefreshSessionRecord> {
    return this.transaction(async (client) => {
      const currentResult = await client.query(`
        SELECT payload_text FROM desky_commerce.commerce_refresh_sessions
        WHERE session_id = $1 FOR UPDATE
      `, [input.sessionId]);
      const current = sessionFromRow(currentResult.rows[0]);
      if (!current) throw new Error('Commerce refresh authentication failed.');
      if (current.generation === input.next.generation
        && current.lastRotationId === input.rotationId
        && current.previousCredentialDigest === input.expectedCredentialDigest) return current;
      if (current.generation !== input.expectedGeneration
        || current.credentialDigest !== input.expectedCredentialDigest
        || current.revokedAt || Date.parse(current.expiresAt) <= Date.parse(input.audit.occurredAt)) {
        throw new Error('Commerce refresh authentication failed.');
      }
      const updated = await client.query(`
        UPDATE desky_commerce.commerce_refresh_sessions SET
          credential_digest = $1, previous_credential_digest = $2,
          generation = $3, expires_at = $4, revoked_at = $5, payload_text = $6
        WHERE session_id = $7 AND generation = $8 AND credential_digest = $9
      `, [input.next.credentialDigest, input.next.previousCredentialDigest,
        input.next.generation, input.next.expiresAt, input.next.revokedAt ?? null,
        JSON.stringify(input.next), input.sessionId, input.expectedGeneration,
        input.expectedCredentialDigest]);
      if (rowCount(updated) !== 1) throw new Error('Concurrent commerce refresh rotation.');
      await this.auditWith(client, input.audit);
      return structuredClone(input.next);
    });
  }

  async findRecovery(credentialDigest: string): Promise<CommerceRecoveryCredentialRecord | undefined> {
    const result = await this.pool.query(`
      SELECT recovery_id, account_id, credential_digest, proof_key_challenge,
        idempotency_key, expires_at, consumed_at, consumed_idempotency_key
      FROM desky_commerce.commerce_recovery_credentials WHERE credential_digest = $1
    `, [credentialDigest]);
    const row = result.rows[0];
    const recoveryId = text(row, 'recovery_id');
    if (!recoveryId) return undefined;
    return {
      recoveryId,
      accountId: String(row.account_id),
      credentialDigest: String(row.credential_digest),
      proofKeyChallenge: String(row.proof_key_challenge),
      idempotencyKey: String(row.idempotency_key),
      expiresAt: new Date(String(row.expires_at)).toISOString(),
      consumedAt: row.consumed_at ? new Date(String(row.consumed_at)).toISOString() : undefined,
      consumedIdempotencyKey: text(row, 'consumed_idempotency_key'),
    };
  }

  async consumeRecovery(input: {
    recoveryId: string;
    idempotencyKey: string;
    consumedAt: string;
    installationId: string;
    session: CommerceRefreshSessionRecord;
    audit: CommerceAuditEvent;
  }): Promise<void> {
    await this.transaction(async (client) => {
      const result = await client.query(`
        UPDATE desky_commerce.commerce_recovery_credentials SET
          consumed_at = $1, consumed_idempotency_key = $2
        WHERE recovery_id = $3 AND consumed_at IS NULL AND expires_at > $1
      `, [input.consumedAt, input.idempotencyKey, input.recoveryId]);
      if (rowCount(result) !== 1) {
        const replay = await client.query(`
          SELECT consumed_idempotency_key FROM desky_commerce.commerce_recovery_credentials
          WHERE recovery_id = $1
        `, [input.recoveryId]);
        if (replay.rows[0]?.consumed_idempotency_key !== input.idempotencyKey) {
          throw new Error('Commerce recovery authentication failed.');
        }
      }
      await client.query(`
        INSERT INTO desky_commerce.commerce_installations (
          account_id, installation_id, created_at, last_seen_at
        ) VALUES ($1, $2, $3, $3)
        ON CONFLICT (account_id, installation_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
      `, [input.session.accountId, input.installationId, input.consumedAt]);
      await this.insertRefreshWith(client, input.session);
      await this.auditWith(client, input.audit);
    });
  }

  async reconciliation(accountId: string, now: string): Promise<CommerceReconciliationSnapshot> {
    return reconciliationWith(this.pool, accountId, now);
  }

  async admitRateLimit(rateKey: string, now: string, maximum: number, windowSeconds: number): Promise<boolean> {
    const start = new Date(Math.floor(Date.parse(now) / (windowSeconds * 1_000))
      * windowSeconds * 1_000).toISOString();
    const expiresAt = new Date(Date.parse(start) + windowSeconds * 2_000).toISOString();
    return this.transaction(async (client) => {
      await client.query('DELETE FROM desky_commerce.commerce_rate_limit_windows WHERE expires_at < $1', [now]);
      const result = await client.query(`
        INSERT INTO desky_commerce.commerce_rate_limit_windows (
          rate_key, window_started_at, request_count, expires_at
        ) VALUES ($1, $2, 1, $3)
        ON CONFLICT (rate_key, window_started_at) DO UPDATE
          SET request_count = desky_commerce.commerce_rate_limit_windows.request_count + 1
        RETURNING request_count
      `, [rateKey, start, expiresAt]);
      return number(result.rows[0], 'request_count') <= maximum;
    });
  }

  async operations(now: string): Promise<CommerceOperationalSnapshot> {
    const result = await this.pool.query(`
      SELECT
        (SELECT COALESCE(MAX(version), 0) FROM desky_commerce.commerce_schema_migrations) AS migration_version,
        (SELECT COUNT(*) FROM desky_commerce.commerce_identities) AS identities,
        (SELECT COUNT(*) FROM desky_commerce.commerce_refresh_sessions WHERE revoked_at IS NULL AND expires_at > $1) AS active_sessions,
        (SELECT COUNT(*) FROM desky_commerce.commerce_orders WHERE payload_text::jsonb ->> 'state' IN ('created','awaiting-approval','awaiting-settlement','paid','disputed')) AS pending_orders,
        (SELECT COUNT(*) FROM desky_commerce.payment_attempts WHERE payload_text::jsonb ->> 'state' IN ('settlement-unknown','settlement-pending','settled')) AS indeterminate,
        (SELECT MIN((payload_text::jsonb ->> 'observedAt')::timestamptz)::text FROM desky_commerce.settlement_observations WHERE settlement_status IN ('unknown','pending')) AS oldest
    `, [now]);
    const row = result.rows[0];
    return {
      schemaVersion: 1,
      migrationVersion: number(row, 'migration_version'),
      identities: number(row, 'identities'),
      activeRefreshSessions: number(row, 'active_sessions'),
      pendingOrders: number(row, 'pending_orders'),
      indeterminateSettlements: number(row, 'indeterminate'),
      oldestIndeterminateAt: row.oldest ? new Date(String(row.oldest)).toISOString() : undefined,
      generatedAt: now,
    };
  }

  async reconciliationQueue(now: string): Promise<CommerceReconciliationQueueItem[]> {
    const result = await this.pool.query(`
      SELECT payload_text FROM desky_commerce.payment_attempts
      WHERE payload_text::jsonb ->> 'state' IN ('settlement-unknown','settlement-pending','settled')
      ORDER BY attempt_id ASC LIMIT 101
    `);
    if (result.rows.length > 100) throw new Error('Commerce reconciliation queue exceeds its operator bound.');
    const items: CommerceReconciliationQueueItem[] = [];
    for (const row of result.rows) {
      const attempt = parsePaymentAttempt(JSON.parse(String(row.payload_text)));
      if (!['settlement-unknown', 'settlement-pending', 'settled'].includes(attempt.state)) continue;
      const authorizationResult = await this.pool.query(`
        SELECT payload_text FROM desky_commerce.payment_authorizations WHERE attempt_id = $1
      `, [attempt.attemptId]);
      const authorizationPayload = text(authorizationResult.rows[0], 'payload_text');
      if (!authorizationPayload) throw new Error('Commerce reconciliation authorization is missing.');
      const authorization = parsePaymentAuthorizationEvidence(JSON.parse(authorizationPayload));
      const observationResult = await this.pool.query(`
        SELECT payload_text FROM desky_commerce.settlement_observations
        WHERE authorization_id = $1 ORDER BY sequence DESC LIMIT 1
      `, [authorization.authorizationId]);
      const observationPayload = text(observationResult.rows[0], 'payload_text');
      if (!observationPayload) throw new Error('Commerce reconciliation observation is missing.');
      const observation = parsePaymentSettlementObservation(JSON.parse(observationPayload));
      if (!['unknown', 'pending', 'settled'].includes(observation.status)) continue;
      items.push({
        attemptId: attempt.attemptId, orderId: attempt.orderId,
        authorizationId: authorization.authorizationId,
        attemptState: attempt.state as CommerceReconciliationQueueItem['attemptState'],
        observationStatus: observation.status as CommerceReconciliationQueueItem['observationStatus'],
        observedAt: observation.observedAt,
        ageSeconds: Math.max(0, Math.floor((Date.parse(now) - Date.parse(observation.observedAt)) / 1_000)),
      });
    }
    return items;
  }

  private async insertRefreshWith(client: PostgresQueryable, session: CommerceRefreshSessionRecord): Promise<void> {
    const result = await client.query(`
      INSERT INTO desky_commerce.commerce_refresh_sessions (
        session_id, account_id, installation_id, credential_digest,
        previous_credential_digest, generation, expires_at, revoked_at, payload_text
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING
    `, [session.sessionId, session.accountId, session.installationId, session.credentialDigest,
      session.previousCredentialDigest ?? null, session.generation, session.expiresAt,
      session.revokedAt ?? null, JSON.stringify(session)]);
    if (rowCount(result) === 1) return;
    const existingResult = await client.query(`
      SELECT payload_text FROM desky_commerce.commerce_refresh_sessions WHERE session_id = $1
    `, [session.sessionId]);
    const existing = sessionFromRow(existingResult.rows[0]);
    if (JSON.stringify(existing) !== JSON.stringify(session)) throw new Error('Commerce session collision.');
  }

  private async auditWith(client: PostgresQueryable, event: CommerceAuditEvent): Promise<void> {
    const result = await client.query(`
      INSERT INTO desky_commerce.commerce_audit_events (
        event_id, account_id, subject_id, occurred_at, correlation_id, payload_text
      ) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING
    `, [event.eventId, event.accountId ?? null, event.subjectId, event.occurredAt,
      event.correlationId, JSON.stringify(event)]);
    if (rowCount(result) === 1) return;
    const existing = await client.query(`
      SELECT payload_text FROM desky_commerce.commerce_audit_events WHERE event_id = $1
    `, [event.eventId]);
    if (text(existing.rows[0], 'payload_text') !== JSON.stringify(event)) {
      throw new Error('Commerce audit event collision.');
    }
  }

  private async transaction<T>(operation: (client: PostgresTransactionClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve original */ }
      throw error;
    } finally {
      client.release();
    }
  }
}
