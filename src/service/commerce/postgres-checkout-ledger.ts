import {
  parseAssetGrant,
  parseCommerceOrder,
  parseEntitlementEvent,
  parsePaymentAttempt,
  parseVerifiedCommerceQuote,
  transitionCommerceOrder,
  transitionPaymentAttempt,
  type AssetGrant,
  type CommerceOrder,
  type CommerceOrderState,
  type EntitlementEvent,
  type PaymentAttempt,
  type PaymentAttemptState,
  type VerifiedCommerceQuote,
} from '../../shared/commerce';
import {
  parsePaymentAuthorizationEvidence,
  parsePaymentSettlementObservation,
  settlementStatusCanAdvance,
  type PaymentAuthorizationEvidence,
  type PaymentSettlementObservation,
  type PaymentSettlementStatus,
} from '../../shared/commerce-settlement';
import {
  parseCommerceCheckoutSessionRecord,
  type CommerceCheckoutSessionRecord,
  type CommerceCheckoutSessionStore,
} from './checkout-session-service';
import type { BaseSepoliaCheckoutLedger } from './base-sepolia-checkout-runtime';
import type { ReconciliationCandidate } from './base-sepolia-settlement-observer';

export interface PostgresQueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
}

export interface PostgresQueryable {
  query(text: string, values?: unknown[]): Promise<PostgresQueryResult>;
}

export interface PostgresTransactionClient extends PostgresQueryable {
  release(): void;
}

export interface PostgresPool extends PostgresQueryable {
  connect(): Promise<PostgresTransactionClient>;
  end(): Promise<void>;
}

export interface HostedSettlementGrantCommit {
  orderId: string;
  attemptId: string;
  settlementObservationId: string;
  entitlementEvent: EntitlementEvent;
  assetGrant: AssetGrant;
}

function payload(row: Record<string, unknown> | undefined): string | undefined {
  return typeof row?.payload_text === 'string' ? row.payload_text : undefined;
}

function exactReplay<T>(stored: T, candidate: T): boolean {
  return JSON.stringify(stored) === JSON.stringify(candidate);
}

function rowCount(result: PostgresQueryResult): number {
  return result.rowCount ?? result.rows.length;
}

function attemptStateForSettlement(status: PaymentSettlementStatus): PaymentAttemptState {
  if (status === 'unknown') return 'settlement-unknown';
  if (status === 'pending') return 'settlement-pending';
  if (status === 'settled') return 'settled';
  return 'failed';
}

function assertAttemptMatchesOrderAndQuote(
  attempt: PaymentAttempt,
  order: CommerceOrder,
  quote: VerifiedCommerceQuote,
): void {
  if (attempt.orderId !== order.orderId
    || attempt.quoteId !== order.quoteId
    || attempt.quoteId !== quote.quoteId
    || attempt.provider !== quote.provider
    || attempt.quoteExpiresAt !== quote.expiresAt
    || attempt.network !== quote.network
    || attempt.asset !== quote.asset
    || attempt.recipient !== quote.recipient) {
    throw new Error('Payment attempt does not match its order and authoritative quote.');
  }
}

function assertAuthorizationMatches(
  authorization: PaymentAuthorizationEvidence,
  attempt: PaymentAttempt,
  order: CommerceOrder,
  quote: VerifiedCommerceQuote,
): void {
  if (authorization.attemptId !== attempt.attemptId
    || authorization.orderId !== order.orderId
    || authorization.quoteId !== quote.quoteId
    || authorization.provider !== attempt.provider
    || authorization.network !== quote.network
    || authorization.asset !== quote.asset
    || authorization.recipient !== quote.recipient
    || authorization.amountAtomic !== quote.amountAtomic
    || Date.parse(authorization.verifiedAt) < Date.parse(order.updatedAt)
    || Date.parse(authorization.verifiedAt) >= Date.parse(quote.expiresAt)
    || Date.parse(authorization.authorizationExpiresAt) > Date.parse(quote.expiresAt)) {
    throw new Error('Payment authorization does not match its attempt and authoritative quote.');
  }
}

function assertObservationMatches(
  observation: PaymentSettlementObservation,
  authorization: PaymentAuthorizationEvidence,
  attempt: PaymentAttempt,
): void {
  if (observation.authorizationId !== authorization.authorizationId
    || observation.attemptId !== authorization.attemptId
    || observation.orderId !== authorization.orderId
    || observation.quoteId !== authorization.quoteId
    || observation.attemptId !== attempt.attemptId
    || observation.provider !== authorization.provider
    || observation.payer !== authorization.payer
    || observation.paymentIdentifier !== authorization.paymentIdentifier
    || observation.network !== authorization.network
    || observation.asset !== authorization.asset
    || observation.recipient !== authorization.recipient
    || observation.amountAtomic !== authorization.amountAtomic
    || Date.parse(observation.observedAt) < Date.parse(authorization.verifiedAt)
    || (observation.settledAt
      && Date.parse(observation.settledAt) < Date.parse(authorization.verifiedAt))) {
    throw new Error('Settlement observation does not match verified payment authorization.');
  }
}

/**
 * PostgreSQL implementation of the checkout/session/settlement invariants. Every compound state
 * transition locks its order or attempt and commits in one database transaction; serverless
 * process memory is never treated as durable payment state.
 */
export class PostgresCheckoutLedger
implements CommerceCheckoutSessionStore, BaseSepoliaCheckoutLedger {
  constructor(private readonly pool: PostgresPool) {}

  async close(): Promise<void> { await this.pool.end(); }

  async healthCheck(): Promise<{ writable: boolean; migrationVersion: number }> {
    return this.transaction(async (client) => {
      await client.query(`
        INSERT INTO desky_commerce.commerce_health_probe (probe_key, checked_at)
        VALUES ('primary', now())
        ON CONFLICT (probe_key) DO UPDATE SET checked_at = EXCLUDED.checked_at
      `);
      const result = await client.query(
        'SELECT COALESCE(MAX(version), 0) AS migration_version FROM desky_commerce.commerce_schema_migrations',
      );
      const version = result.rows[0]?.migration_version;
      const migrationVersion = typeof version === 'number' ? version : Number(version);
      return { writable: true, migrationVersion };
    });
  }

  async storeQuote(value: unknown): Promise<VerifiedCommerceQuote> {
    const quote = parseVerifiedCommerceQuote(value);
    const inserted = await this.pool.query(`
      INSERT INTO desky_commerce.commerce_quotes (quote_id, account_id, expires_at, payload_text)
      VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING
    `, [quote.quoteId, quote.accountId, quote.expiresAt, JSON.stringify(quote)]);
    if (rowCount(inserted) === 1) return quote;
    const stored = await this.getQuote(quote.quoteId);
    if (stored && exactReplay(stored, quote)) return stored;
    throw new Error('Commerce quote ID collision.');
  }

  async createOrder(value: unknown): Promise<CommerceOrder> {
    const order = parseCommerceOrder(value);
    if (order.state !== 'created') throw new Error('A new commerce order must be in created state.');
    const quote = await this.getQuote(order.quoteId);
    if (!quote || order.accountId !== quote.accountId
      || order.offerId !== quote.offerId || order.offerRevision !== quote.offerRevision
      || order.currency !== quote.currency || order.amountAtomic !== quote.amountAtomic
      || Date.parse(order.createdAt) < Date.parse(quote.issuedAt)
      || Date.parse(order.createdAt) >= Date.parse(quote.expiresAt)) {
      throw new Error('Commerce order does not match its authoritative quote.');
    }
    const inserted = await this.pool.query(`
      INSERT INTO desky_commerce.commerce_orders (order_id, quote_id, account_id, idempotency_key, payload_text)
      VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING
    `, [order.orderId, order.quoteId, order.accountId, order.idempotencyKey, JSON.stringify(order)]);
    if (rowCount(inserted) === 1) return order;
    const result = await this.pool.query(`
      SELECT payload_text FROM desky_commerce.commerce_orders
      WHERE order_id = $1 OR (account_id = $2 AND idempotency_key = $3)
      ORDER BY CASE WHEN order_id = $1 THEN 0 ELSE 1 END LIMIT 1
    `, [order.orderId, order.accountId, order.idempotencyKey]);
    const storedPayload = payload(result.rows[0]);
    const stored = storedPayload ? parseCommerceOrder(JSON.parse(storedPayload)) : undefined;
    if (stored && exactReplay(stored, order)) return stored;
    throw new Error('Commerce order identity collision.');
  }

  async getQuote(quoteId: string): Promise<VerifiedCommerceQuote | undefined> {
    const result = await this.pool.query(
      'SELECT payload_text FROM desky_commerce.commerce_quotes WHERE quote_id = $1', [quoteId],
    );
    const value = payload(result.rows[0]);
    return value ? parseVerifiedCommerceQuote(JSON.parse(value)) : undefined;
  }

  async getOrder(orderId: string): Promise<CommerceOrder | undefined> {
    return this.getOrderWith(this.pool, orderId);
  }

  async advanceOrder(
    orderId: string,
    state: CommerceOrderState,
    updatedAt: string,
  ): Promise<CommerceOrder> {
    return this.transaction(async (client) => {
      const current = await this.requireOrder(client, orderId, true);
      const next = transitionCommerceOrder(current, state, updatedAt);
      if (next === current) return current;
      const updated = await client.query(`
        UPDATE desky_commerce.commerce_orders SET payload_text = $1
        WHERE order_id = $2 AND payload_text = $3
      `, [JSON.stringify(next), orderId, JSON.stringify(current)]);
      if (rowCount(updated) !== 1) throw new Error('Concurrent commerce order transition.');
      return next;
    });
  }

  async approveOrder(orderId: string, updatedAt: string): Promise<CommerceOrder> {
    return this.advanceOrder(orderId, 'awaiting-approval', updatedAt);
  }

  async expireUnstartedOrders(updatedAt: string, limit = 100): Promise<number> {
    const parsed = new Date(updatedAt);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== updatedAt
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Invalid unstarted commerce order expiry policy.');
    }
    return this.transaction(async (client) => {
      const result = await client.query(`
        SELECT o.payload_text
        FROM desky_commerce.commerce_orders o
        JOIN desky_commerce.commerce_quotes q ON q.quote_id = o.quote_id
        WHERE q.expires_at <= $1
          AND o.payload_text::jsonb ->> 'state' IN ('created', 'awaiting-approval')
        ORDER BY q.expires_at ASC, o.order_id ASC
        LIMIT $2
        FOR UPDATE
      `, [updatedAt, limit]);
      let expired = 0;
      for (const row of result.rows) {
        const currentPayload = payload(row);
        if (!currentPayload) throw new Error('Invalid unstarted commerce order payload.');
        const current = parseCommerceOrder(JSON.parse(currentPayload));
        const checkout = await client.query(`
          SELECT checkout_session_id FROM desky_commerce.commerce_checkout_sessions
          WHERE order_id = $1 LIMIT 1
        `, [current.orderId]);
        if (checkout.rows.length > 0) continue;
        const next = transitionCommerceOrder(current, 'expired', updatedAt);
        const update = await client.query(`
          UPDATE desky_commerce.commerce_orders SET payload_text = $1
          WHERE order_id = $2 AND payload_text = $3
        `, [JSON.stringify(next), current.orderId, currentPayload]);
        if (rowCount(update) !== 1) throw new Error('Concurrent unstarted commerce order expiry.');
        expired += 1;
      }
      return expired;
    });
  }

  async getPaymentAttempt(attemptId: string): Promise<PaymentAttempt | undefined> {
    return this.getAttemptWith(this.pool, attemptId);
  }

  async getPaymentAuthorization(
    authorizationId: string,
  ): Promise<PaymentAuthorizationEvidence | undefined> {
    return this.getAuthorizationWith(this.pool, authorizationId);
  }

  async getLatestSettlementObservation(
    authorizationId: string,
  ): Promise<PaymentSettlementObservation | undefined> {
    return this.getLatestObservationWith(this.pool, authorizationId);
  }

  async listReconciliationCandidates(limit: number): Promise<ReconciliationCandidate[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Invalid commerce reconciliation candidate limit.');
    }
    const result = await this.pool.query(`
      SELECT a.payload_text AS authorization_payload, o.payload_text AS observation_payload
      FROM desky_commerce.payment_authorizations a
      JOIN desky_commerce.payment_attempts p ON p.attempt_id = a.attempt_id
      JOIN desky_commerce.commerce_orders c ON c.order_id = p.order_id
      JOIN desky_commerce.settlement_observations o ON o.authorization_id = a.authorization_id
      WHERE p.payload_text::jsonb ->> 'state' IN ('settlement-unknown','settlement-pending','settled')
        AND c.payload_text::jsonb ->> 'state' <> 'granted'
      ORDER BY a.authorization_id ASC, o.sequence DESC LIMIT 1001
    `);
    if (result.rows.length > 1_000) {
      throw new Error('Commerce reconciliation observation scan exceeds its bound.');
    }
    const candidates: ReconciliationCandidate[] = [];
    const seen = new Set<string>();
    for (const row of result.rows) {
      const authorizationPayload = typeof row.authorization_payload === 'string'
        ? row.authorization_payload : undefined;
      const observationPayload = typeof row.observation_payload === 'string'
        ? row.observation_payload : undefined;
      if (!authorizationPayload || !observationPayload) {
        throw new Error('Invalid commerce reconciliation candidate.');
      }
      const authorization = parsePaymentAuthorizationEvidence(JSON.parse(authorizationPayload));
      if (seen.has(authorization.authorizationId)) continue;
      seen.add(authorization.authorizationId);
      candidates.push({
        authorization,
        latestObservation: parsePaymentSettlementObservation(JSON.parse(observationPayload)),
      });
      if (candidates.length === limit) break;
    }
    return candidates;
  }

  async getCheckoutSession(
    checkoutSessionId: string,
  ): Promise<CommerceCheckoutSessionRecord | undefined> {
    const result = await this.pool.query(`
      SELECT payload_text FROM desky_commerce.commerce_checkout_sessions WHERE checkout_session_id = $1
    `, [checkoutSessionId]);
    return this.checkoutRecord(result.rows[0]);
  }

  async getCheckoutSessionByApproval(
    approvalId: string,
  ): Promise<CommerceCheckoutSessionRecord | undefined> {
    const result = await this.pool.query(`
      SELECT payload_text FROM desky_commerce.commerce_checkout_sessions WHERE approval_id = $1
    `, [approvalId]);
    return this.checkoutRecord(result.rows[0]);
  }

  async getCheckoutSessionByIdempotency(
    accountId: string,
    idempotencyKey: string,
  ): Promise<CommerceCheckoutSessionRecord | undefined> {
    const result = await this.pool.query(`
      SELECT payload_text FROM desky_commerce.commerce_checkout_sessions
      WHERE account_id = $1 AND idempotency_key = $2
    `, [accountId, idempotencyKey]);
    return this.checkoutRecord(result.rows[0]);
  }

  async insertCheckoutSession(
    value: CommerceCheckoutSessionRecord,
  ): Promise<'inserted' | 'exact-replay'> {
    const record = parseCommerceCheckoutSessionRecord(value);
    const inserted = await this.pool.query(`
      INSERT INTO desky_commerce.commerce_checkout_sessions (
        checkout_session_id, approval_id, account_id, installation_id,
        idempotency_key, order_id, expires_at, payload_text
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING
    `, [
      record.session.checkoutSessionId, record.session.approvalId, record.session.accountId,
      record.session.installationId, record.request.idempotencyKey, record.session.orderId,
      record.session.expiresAt, JSON.stringify(record),
    ]);
    if (rowCount(inserted) === 1) return 'inserted';
    const result = await this.pool.query(`
      SELECT payload_text FROM desky_commerce.commerce_checkout_sessions
      WHERE checkout_session_id = $1 OR approval_id = $2
        OR (account_id = $3 AND idempotency_key = $4)
      ORDER BY CASE WHEN checkout_session_id = $1 THEN 0 WHEN approval_id = $2 THEN 1 ELSE 2 END
      LIMIT 1
    `, [record.session.checkoutSessionId, record.session.approvalId,
      record.session.accountId, record.request.idempotencyKey]);
    const stored = this.checkoutRecord(result.rows[0]);
    if (stored && exactReplay(stored, record)) return 'exact-replay';
    throw new Error('Commerce checkout session identity collision.');
  }

  async updateCheckoutSession(
    expectedValue: CommerceCheckoutSessionRecord,
    nextValue: CommerceCheckoutSessionRecord,
    closeOrderState?: 'cancelled' | 'expired',
  ): Promise<void> {
    const expected = parseCommerceCheckoutSessionRecord(expectedValue);
    const next = parseCommerceCheckoutSessionRecord(nextValue);
    if (expected.session.checkoutSessionId !== next.session.checkoutSessionId
      || expected.request.approvalId !== next.request.approvalId
      || expected.request.idempotencyKey !== next.request.idempotencyKey) {
      throw new Error('Commerce checkout session identity is immutable.');
    }
    if (closeOrderState && next.session.state !== closeOrderState) {
      throw new Error('Commerce checkout order closure does not match the session state.');
    }
    await this.transaction(async (client) => {
      if (!exactReplay(expected, next)) {
        const updated = await client.query(`
          UPDATE desky_commerce.commerce_checkout_sessions SET payload_text = $1, expires_at = $2
          WHERE checkout_session_id = $3 AND payload_text = $4
        `, [JSON.stringify(next), next.session.expiresAt,
          expected.session.checkoutSessionId, JSON.stringify(expected)]);
        if (rowCount(updated) !== 1) throw new Error('Concurrent commerce checkout session update.');
      }
      if (closeOrderState) {
        const order = await this.requireOrder(client, next.session.orderId, true);
        const closed = transitionCommerceOrder(order, closeOrderState, next.updatedAt);
        if (closed !== order) {
          const updatedOrder = await client.query(`
            UPDATE desky_commerce.commerce_orders SET payload_text = $1
            WHERE order_id = $2 AND payload_text = $3
          `, [JSON.stringify(closed), order.orderId, JSON.stringify(order)]);
          if (rowCount(updatedOrder) !== 1) throw new Error('Concurrent commerce order closure.');
        }
      }
    });
  }

  async prepareCheckoutPayment(
    orderId: string,
    value: PaymentAttempt,
    updatedAt: string,
  ): Promise<{ order: CommerceOrder; attempt: PaymentAttempt }> {
    const candidate = parsePaymentAttempt(value);
    if (candidate.state !== 'created' || candidate.orderId !== orderId) {
      throw new Error('Checkout payment preparation requires a created matching attempt.');
    }
    return this.transaction(async (client) => {
      const order = await this.requireOrder(client, orderId, true);
      const quote = await this.requireQuote(client, order.quoteId);
      assertAttemptMatchesOrderAndQuote(candidate, order, quote);
      const existing = await this.getAttemptWith(client, candidate.attemptId, true);
      if (existing) {
        if (!['awaiting-settlement', 'paid', 'granted'].includes(order.state)
          || !exactReplay({ ...existing, state: 'created' }, candidate)) {
          throw new Error('Checkout payment preparation replay does not match durable state.');
        }
        return { order, attempt: existing };
      }
      if (order.state !== 'awaiting-approval') {
        throw new Error('Checkout payment preparation requires an approved order without an attempt.');
      }
      const nextOrder = transitionCommerceOrder(order, 'awaiting-settlement', updatedAt);
      const nextAttempt = transitionPaymentAttempt(candidate, 'submitted');
      const orderUpdate = await client.query(`
        UPDATE desky_commerce.commerce_orders SET payload_text = $1 WHERE order_id = $2 AND payload_text = $3
      `, [JSON.stringify(nextOrder), orderId, JSON.stringify(order)]);
      if (rowCount(orderUpdate) !== 1) throw new Error('Concurrent checkout order preparation.');
      await client.query(`
        INSERT INTO desky_commerce.payment_attempts (
          attempt_id, order_id, quote_id, provider, payload_text
        )
        VALUES ($1, $2, $3, $4, $5)
      `, [nextAttempt.attemptId, nextAttempt.orderId, nextAttempt.quoteId,
        nextAttempt.provider, JSON.stringify(nextAttempt)]);
      return { order: nextOrder, attempt: nextAttempt };
    });
  }

  async advancePaymentAttempt(
    attemptId: string,
    state: 'failed',
  ): Promise<PaymentAttempt> {
    return this.transaction(async (client) => {
      const current = await this.requireAttempt(client, attemptId, true);
      const next = transitionPaymentAttempt(current, state);
      if (next === current) return current;
      const result = await client.query(`
        UPDATE desky_commerce.payment_attempts SET payload_text = $1
        WHERE attempt_id = $2 AND payload_text = $3
      `, [JSON.stringify(next), attemptId, JSON.stringify(current)]);
      if (rowCount(result) !== 1) throw new Error('Concurrent payment attempt transition.');
      return next;
    });
  }

  async verifyPaymentAuthorization(value: unknown): Promise<{
    authorization: PaymentAuthorizationEvidence;
    attempt: PaymentAttempt;
  }> {
    const authorization = parsePaymentAuthorizationEvidence(value);
    return this.transaction(async (client) => {
      const current = await this.requireAttempt(client, authorization.attemptId, true);
      const existing = await this.getAuthorizationWith(client, authorization.authorizationId);
      if (existing) {
        if (exactReplay(existing, authorization)) return { authorization: existing, attempt: current };
        throw new Error('Payment authorization ID collision.');
      }
      if (current.state !== 'submitted') {
        throw new Error('Payment authorization requires a submitted attempt.');
      }
      const order = await this.requireOrder(client, authorization.orderId);
      const quote = await this.requireQuote(client, authorization.quoteId);
      assertAttemptMatchesOrderAndQuote(current, order, quote);
      assertAuthorizationMatches(authorization, current, order, quote);
      await client.query(`
        INSERT INTO desky_commerce.payment_authorizations (
          authorization_id, attempt_id, provider, network, payment_identifier, payload_text
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [authorization.authorizationId, authorization.attemptId, authorization.provider,
        authorization.network, authorization.paymentIdentifier, JSON.stringify(authorization)]);
      const next = transitionPaymentAttempt(current, 'verified');
      const update = await client.query(`
        UPDATE desky_commerce.payment_attempts SET payload_text = $1
        WHERE attempt_id = $2 AND payload_text = $3
      `, [JSON.stringify(next), current.attemptId, JSON.stringify(current)]);
      if (rowCount(update) !== 1) throw new Error('Concurrent payment authorization transition.');
      return { authorization, attempt: next };
    });
  }

  async claimSettlementDispatch(value: unknown): Promise<{
    claimed: boolean;
    observation: PaymentSettlementObservation;
    attempt: PaymentAttempt;
  }> {
    const observation = parsePaymentSettlementObservation(value);
    if (observation.status !== 'unknown' || observation.source !== 'facilitator-response'
      || observation.reasonCode !== 'settlement-dispatching') {
      throw new Error('Settlement dispatch claim requires a durable facilitator unknown observation.');
    }
    return this.recordObservation(observation);
  }

  async recordSettlementObservation(value: unknown): Promise<{
    observation: PaymentSettlementObservation;
    attempt: PaymentAttempt;
  }> {
    const result = await this.recordObservation(parsePaymentSettlementObservation(value));
    return { observation: result.observation, attempt: result.attempt };
  }

  async commitSettledGrant(value: HostedSettlementGrantCommit): Promise<{
    order: CommerceOrder;
    attempt: PaymentAttempt;
    entitlementEvent: EntitlementEvent;
    assetGrant: AssetGrant;
  }> {
    const event = parseEntitlementEvent(value.entitlementEvent);
    const grant = parseAssetGrant(value.assetGrant);
    return this.transaction(async (client) => {
      const order = await this.requireOrder(client, value.orderId, true);
      const attempt = await this.requireAttempt(client, value.attemptId, true);
      const quote = await this.requireQuote(client, order.quoteId);
      const observation = await this.requireObservation(client, value.settlementObservationId);
      const authorization = await this.requireAuthorization(client, observation.authorizationId);
      assertObservationMatches(observation, authorization, attempt);
      const settledAt = observation.settledAt;
      if (observation.status !== 'settled' || !observation.providerReference || !settledAt) {
        throw new Error('Grant requires durable settled observation.');
      }
      const existingEvent = await this.getEventWith(client, event.eventId);
      const existingGrant = await this.getGrantWith(client, grant.grantId);
      if (order.state === 'granted' && attempt.state === 'settled') {
        if (order.updatedAt === settledAt && existingEvent && existingGrant
          && event.sourceReference === observation.providerReference
          && exactReplay(existingEvent, event) && exactReplay(existingGrant, grant)) {
          return { order, attempt, entitlementEvent: existingEvent, assetGrant: existingGrant };
        }
        throw new Error('Settled grant replay does not match the committed transaction.');
      }
      if (order.state !== 'awaiting-settlement' || attempt.state !== 'settled') {
        throw new Error('Grant requires an awaiting order and durable settled observation.');
      }
      assertAttemptMatchesOrderAndQuote(attempt, order, quote);
      if (event.type !== 'grant' || event.accountId !== order.accountId
        || event.productId !== quote.productId || event.source !== attempt.provider
        || event.sourceReference !== observation.providerReference
        || grant.accountId !== event.accountId || grant.productId !== event.productId
        || grant.productRevision !== quote.productRevision
        || !exactReplay(grant.avatarRevisionIds, quote.avatarRevisionIds)
        || grant.catalogVersion !== quote.catalogVersion
        || grant.entitlementEventId !== event.eventId || grant.issuedAt !== event.effectiveAt
        || event.effectiveAt !== settledAt || grant.expiresAt !== event.expiresAt
        || grant.state !== 'active') {
        throw new Error('Asset grant does not match durable settlement and quote.');
      }
      await client.query(`
        INSERT INTO desky_commerce.entitlement_events (
          event_id, account_id, product_id, event_type, source, source_reference, payload_text
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [event.eventId, event.accountId, event.productId, event.type,
        event.source, event.sourceReference, JSON.stringify(event)]);
      await client.query(`
        INSERT INTO desky_commerce.asset_grants (
          grant_id, entitlement_event_id, account_id, product_id, payload_text
        ) VALUES ($1, $2, $3, $4, $5)
      `, [grant.grantId, grant.entitlementEventId, grant.accountId,
        grant.productId, JSON.stringify(grant)]);
      const nextOrder = transitionCommerceOrder(
        transitionCommerceOrder(order, 'paid', settledAt), 'granted', settledAt,
      );
      const update = await client.query(`
        UPDATE desky_commerce.commerce_orders SET payload_text = $1
        WHERE order_id = $2 AND payload_text = $3
      `, [JSON.stringify(nextOrder), order.orderId, JSON.stringify(order)]);
      if (rowCount(update) !== 1) throw new Error('Concurrent commerce settlement transition.');
      return { order: nextOrder, attempt, entitlementEvent: event, assetGrant: grant };
    });
  }

  async listEntitlementEvents(accountId: string, productId?: string): Promise<EntitlementEvent[]> {
    const result = productId
      ? await this.pool.query(`
          SELECT payload_text FROM desky_commerce.entitlement_events
          WHERE account_id = $1 AND product_id = $2 ORDER BY sequence ASC
        `, [accountId, productId])
      : await this.pool.query(`
          SELECT payload_text FROM desky_commerce.entitlement_events
          WHERE account_id = $1 ORDER BY sequence ASC
        `, [accountId]);
    return result.rows.map((row) => {
      const value = payload(row);
      if (!value) throw new Error('Invalid stored entitlement event.');
      return parseEntitlementEvent(JSON.parse(value));
    });
  }

  async listAssetGrants(accountId: string): Promise<AssetGrant[]> {
    const result = await this.pool.query(`
      SELECT payload_text FROM desky_commerce.asset_grants
      WHERE account_id = $1 ORDER BY grant_id ASC
    `, [accountId]);
    return result.rows.map((row) => {
      const value = payload(row);
      if (!value) throw new Error('Invalid stored asset grant.');
      return parseAssetGrant(JSON.parse(value));
    });
  }

  private async recordObservation(observation: PaymentSettlementObservation): Promise<{
    claimed: boolean;
    observation: PaymentSettlementObservation;
    attempt: PaymentAttempt;
  }> {
    return this.transaction(async (client) => {
      const current = await this.requireAttempt(client, observation.attemptId, true);
      const existingResult = await client.query(`
        SELECT payload_text FROM desky_commerce.settlement_observations WHERE observation_id = $1
      `, [observation.observationId]);
      const existingPayload = payload(existingResult.rows[0]);
      if (existingPayload) {
        const existing = parsePaymentSettlementObservation(JSON.parse(existingPayload));
        if (exactReplay(existing, observation)) {
          return { claimed: false, observation: existing, attempt: current };
        }
        throw new Error('Settlement observation ID collision.');
      }
      const authorization = await this.requireAuthorization(client, observation.authorizationId);
      assertObservationMatches(observation, authorization, current);
      const latest = await this.getLatestObservationWith(client, observation.authorizationId, true);
      if (!settlementStatusCanAdvance(latest?.status, observation.status)) {
        throw new Error('Settlement observation would regress a terminal or pending state.');
      }
      const expectedState = latest ? attemptStateForSettlement(latest.status) : 'verified';
      if (current.state !== expectedState) {
        throw new Error('Payment attempt does not match its settlement history.');
      }
      if (observation.providerReference) {
        await client.query(`
          INSERT INTO desky_commerce.settlement_provider_references (
            provider, network, provider_reference, authorization_id
          ) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING
        `, [observation.provider, observation.network,
          observation.providerReference, observation.authorizationId]);
        const owner = await client.query(`
          SELECT authorization_id FROM desky_commerce.settlement_provider_references
          WHERE provider = $1 AND network = $2 AND provider_reference = $3
        `, [observation.provider, observation.network, observation.providerReference]);
        if (owner.rows[0]?.authorization_id !== observation.authorizationId) {
          throw new Error('Settlement provider reference belongs to another authorization.');
        }
      }
      await client.query(`
        INSERT INTO desky_commerce.settlement_observations (
          observation_id, authorization_id, attempt_id, settlement_status,
          reconciliation_id, payload_text
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [observation.observationId, observation.authorizationId, observation.attemptId,
        observation.status, observation.reconciliationId, JSON.stringify(observation)]);
      const next = transitionPaymentAttempt(current, attemptStateForSettlement(observation.status));
      const update = await client.query(`
        UPDATE desky_commerce.payment_attempts SET payload_text = $1
        WHERE attempt_id = $2 AND payload_text = $3
      `, [JSON.stringify(next), current.attemptId, JSON.stringify(current)]);
      if (rowCount(update) !== 1) throw new Error('Concurrent settlement observation transition.');
      return { claimed: true, observation, attempt: next };
    });
  }

  private checkoutRecord(row: Record<string, unknown> | undefined) {
    const value = payload(row);
    return value ? parseCommerceCheckoutSessionRecord(JSON.parse(value)) : undefined;
  }

  private async transaction<T>(operation: (client: PostgresTransactionClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* retain the original error */ }
      throw error;
    } finally {
      client.release();
    }
  }

  private async getOrderWith(client: PostgresQueryable, id: string, lock = false) {
    const result = await client.query(
      `SELECT payload_text FROM desky_commerce.commerce_orders WHERE order_id = $1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    const value = payload(result.rows[0]);
    return value ? parseCommerceOrder(JSON.parse(value)) : undefined;
  }

  private async getAttemptWith(client: PostgresQueryable, id: string, lock = false) {
    const result = await client.query(
      `SELECT payload_text FROM desky_commerce.payment_attempts WHERE attempt_id = $1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    const value = payload(result.rows[0]);
    return value ? parsePaymentAttempt(JSON.parse(value)) : undefined;
  }

  private async getAuthorizationWith(client: PostgresQueryable, id: string) {
    const result = await client.query(
      'SELECT payload_text FROM desky_commerce.payment_authorizations WHERE authorization_id = $1', [id],
    );
    const value = payload(result.rows[0]);
    return value ? parsePaymentAuthorizationEvidence(JSON.parse(value)) : undefined;
  }

  private async getLatestObservationWith(
    client: PostgresQueryable,
    authorizationId: string,
    lock = false,
  ) {
    const result = await client.query(`
      SELECT payload_text FROM desky_commerce.settlement_observations
      WHERE authorization_id = $1 ORDER BY sequence DESC LIMIT 1${lock ? ' FOR UPDATE' : ''}
    `, [authorizationId]);
    const value = payload(result.rows[0]);
    return value ? parsePaymentSettlementObservation(JSON.parse(value)) : undefined;
  }

  private async getEventWith(client: PostgresQueryable, id: string) {
    const result = await client.query(
      'SELECT payload_text FROM desky_commerce.entitlement_events WHERE event_id = $1', [id],
    );
    const value = payload(result.rows[0]);
    return value ? parseEntitlementEvent(JSON.parse(value)) : undefined;
  }

  private async getGrantWith(client: PostgresQueryable, id: string) {
    const result = await client.query(
      'SELECT payload_text FROM desky_commerce.asset_grants WHERE grant_id = $1', [id],
    );
    const value = payload(result.rows[0]);
    return value ? parseAssetGrant(JSON.parse(value)) : undefined;
  }

  private async requireQuote(client: PostgresQueryable, id: string) {
    const result = await client.query(
      'SELECT payload_text FROM desky_commerce.commerce_quotes WHERE quote_id = $1', [id],
    );
    const value = payload(result.rows[0]);
    if (!value) throw new Error('Commerce quote was not found.');
    return parseVerifiedCommerceQuote(JSON.parse(value));
  }

  private async requireOrder(client: PostgresQueryable, id: string, lock = false) {
    const value = await this.getOrderWith(client, id, lock);
    if (!value) throw new Error('Commerce order was not found.');
    return value;
  }

  private async requireAttempt(client: PostgresQueryable, id: string, lock = false) {
    const value = await this.getAttemptWith(client, id, lock);
    if (!value) throw new Error('Payment attempt was not found.');
    return value;
  }

  private async requireAuthorization(client: PostgresQueryable, id: string) {
    const value = await this.getAuthorizationWith(client, id);
    if (!value) throw new Error('Commerce payment authorization was not found.');
    return value;
  }

  private async requireObservation(client: PostgresQueryable, id: string) {
    const result = await client.query(
      'SELECT payload_text FROM desky_commerce.settlement_observations WHERE observation_id = $1', [id],
    );
    const value = payload(result.rows[0]);
    if (!value) throw new Error('Commerce settlement observation was not found.');
    return parsePaymentSettlementObservation(JSON.parse(value));
  }
}
