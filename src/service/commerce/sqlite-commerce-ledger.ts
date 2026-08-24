import { DatabaseSync } from 'node:sqlite';

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

export interface SettlementGrantCommit {
  orderId: string;
  attemptId: string;
  settlementObservationId: string;
  entitlementEvent: EntitlementEvent;
  assetGrant: AssetGrant;
}

interface PayloadRow {
  payload: string;
}

function payloadFromRow(row: unknown): string | undefined {
  if (typeof row !== 'object' || row === null || !('payload' in row)
    || typeof (row as PayloadRow).payload !== 'string') return undefined;
  return (row as PayloadRow).payload;
}

function exactReplay<T>(stored: T, candidate: T): boolean {
  return JSON.stringify(stored) === JSON.stringify(candidate);
}

/**
 * A crash-safe SQLite conformance repository for the commerce service contract.
 * It is never imported by Electron and is not the production hosted database adapter.
 */
export class SqliteCommerceLedger {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS commerce_quotes (
        quote_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        payload TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS commerce_orders (
        order_id TEXT PRIMARY KEY,
        quote_id TEXT NOT NULL REFERENCES commerce_quotes(quote_id),
        account_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE(account_id, idempotency_key)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS payment_attempts (
        attempt_id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES commerce_orders(order_id),
        quote_id TEXT NOT NULL REFERENCES commerce_quotes(quote_id),
        provider TEXT NOT NULL,
        payload TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS payment_authorizations (
        authorization_id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL UNIQUE REFERENCES payment_attempts(attempt_id),
        provider TEXT NOT NULL,
        network TEXT NOT NULL,
        payment_identifier TEXT NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE(provider, network, payment_identifier)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS settlement_provider_references (
        provider TEXT NOT NULL,
        network TEXT NOT NULL,
        provider_reference TEXT NOT NULL,
        authorization_id TEXT NOT NULL REFERENCES payment_authorizations(authorization_id),
        PRIMARY KEY(provider, network, provider_reference)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS settlement_observations (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        observation_id TEXT NOT NULL UNIQUE,
        authorization_id TEXT NOT NULL REFERENCES payment_authorizations(authorization_id),
        attempt_id TEXT NOT NULL REFERENCES payment_attempts(attempt_id),
        settlement_status TEXT NOT NULL,
        reconciliation_id TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS entitlement_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        account_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        source TEXT NOT NULL,
        source_reference TEXT NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE(account_id, product_id, event_type, source, source_reference)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS asset_grants (
        grant_id TEXT PRIMARY KEY,
        entitlement_event_id TEXT NOT NULL UNIQUE REFERENCES entitlement_events(event_id),
        account_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        payload TEXT NOT NULL
      ) STRICT;
    `);
  }

  close(): void {
    this.database.close();
  }

  storeQuote(value: unknown): VerifiedCommerceQuote {
    const quote = parseVerifiedCommerceQuote(value);
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO commerce_quotes (quote_id, account_id, expires_at, payload)
      VALUES (?, ?, ?, ?)
    `).run(quote.quoteId, quote.accountId, quote.expiresAt, JSON.stringify(quote));
    if (result.changes === 1) return quote;
    const existing = this.getQuote(quote.quoteId);
    if (existing && exactReplay(existing, quote)) return existing;
    throw new Error('Commerce quote ID collision.');
  }

  getQuote(quoteId: string): VerifiedCommerceQuote | undefined {
    const payload = payloadFromRow(this.database.prepare(
      'SELECT payload FROM commerce_quotes WHERE quote_id = ?',
    ).get(quoteId));
    return payload === undefined ? undefined : parseVerifiedCommerceQuote(JSON.parse(payload));
  }

  createOrder(value: unknown): CommerceOrder {
    const order = parseCommerceOrder(value);
    if (order.state !== 'created') throw new Error('A new commerce order must be in created state.');
    const quote = this.requireQuote(order.quoteId);
    this.assertOrderMatchesQuote(order, quote);

    const result = this.database.prepare(`
      INSERT OR IGNORE INTO commerce_orders (order_id, quote_id, account_id, idempotency_key, payload)
      VALUES (?, ?, ?, ?, ?)
    `).run(order.orderId, order.quoteId, order.accountId, order.idempotencyKey, JSON.stringify(order));
    if (result.changes === 1) return order;
    const existingById = this.getOrder(order.orderId);
    if (existingById && exactReplay(existingById, order)) return existingById;
    if (existingById) throw new Error('Commerce order ID collision.');
    const idempotentPayload = payloadFromRow(this.database.prepare(`
      SELECT payload FROM commerce_orders WHERE account_id = ? AND idempotency_key = ?
    `).get(order.accountId, order.idempotencyKey));
    if (idempotentPayload !== undefined) {
      const existing = parseCommerceOrder(JSON.parse(idempotentPayload));
      if (exactReplay(existing, order)) return existing;
    }
    throw new Error('Commerce order idempotency-key collision.');
  }

  getOrder(orderId: string): CommerceOrder | undefined {
    const payload = payloadFromRow(this.database.prepare(
      'SELECT payload FROM commerce_orders WHERE order_id = ?',
    ).get(orderId));
    return payload === undefined ? undefined : parseCommerceOrder(JSON.parse(payload));
  }

  advanceOrder(orderId: string, state: CommerceOrderState, updatedAt: string): CommerceOrder {
    const current = this.requireOrder(orderId);
    if ((state === 'cancelled' || state === 'expired')
      && this.hasUnresolvedOrSettledAttempt(orderId)) {
      throw new Error('Commerce order cannot close while settlement requires reconciliation or grant.');
    }
    const next = transitionCommerceOrder(current, state, updatedAt);
    if (next === current) return current;
    const result = this.database.prepare(`
      UPDATE commerce_orders SET payload = ? WHERE order_id = ? AND payload = ?
    `).run(JSON.stringify(next), orderId, JSON.stringify(current));
    if (result.changes !== 1) throw new Error('Concurrent commerce order transition.');
    return next;
  }

  createPaymentAttempt(value: unknown): PaymentAttempt {
    const attempt = parsePaymentAttempt(value);
    if (attempt.state !== 'created') throw new Error('A new payment attempt must be in created state.');
    const order = this.requireOrder(attempt.orderId);
    const quote = this.requireQuote(attempt.quoteId);
    this.assertAttemptMatchesOrderAndQuote(attempt, order, quote);
    const existing = this.getPaymentAttempt(attempt.attemptId);
    if (existing) {
      if (exactReplay(existing, attempt)) return existing;
      throw new Error('Payment attempt ID collision.');
    }
    if (this.hasActiveAttempt(attempt.orderId)) {
      throw new Error('Commerce order already has an active payment attempt.');
    }
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO payment_attempts (
        attempt_id, order_id, quote_id, provider, payload
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      attempt.attemptId,
      attempt.orderId,
      attempt.quoteId,
      attempt.provider,
      JSON.stringify(attempt),
    );
    if (result.changes === 1) return attempt;
    const stored = this.getPaymentAttempt(attempt.attemptId);
    if (stored && exactReplay(stored, attempt)) return stored;
    if (stored) throw new Error('Payment attempt ID collision.');
    throw new Error('Payment attempt insert failed.');
  }

  getPaymentAttempt(attemptId: string): PaymentAttempt | undefined {
    const payload = payloadFromRow(this.database.prepare(
      'SELECT payload FROM payment_attempts WHERE attempt_id = ?',
    ).get(attemptId));
    return payload === undefined ? undefined : parsePaymentAttempt(JSON.parse(payload));
  }

  advancePaymentAttempt(attemptId: string, state: PaymentAttemptState): PaymentAttempt {
    const current = this.requirePaymentAttempt(attemptId);
    if (state === 'verified' || state === 'settlement-unknown'
      || state === 'settlement-pending' || state === 'settled'
      || (state === 'failed' && !['created', 'submitted'].includes(current.state))) {
      throw new Error('Use durable authorization or settlement evidence to advance a payment attempt.');
    }
    const next = transitionPaymentAttempt(current, state);
    if (next === current) return current;
    const result = this.database.prepare(`
      UPDATE payment_attempts SET payload = ? WHERE attempt_id = ? AND payload = ?
    `).run(JSON.stringify(next), attemptId, JSON.stringify(current));
    if (result.changes !== 1) throw new Error('Concurrent payment attempt transition.');
    return next;
  }

  verifyPaymentAuthorization(value: unknown): {
    authorization: PaymentAuthorizationEvidence;
    attempt: PaymentAttempt;
  } {
    const authorization = parsePaymentAuthorizationEvidence(value);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.getPaymentAuthorization(authorization.authorizationId);
      const current = this.requirePaymentAttempt(authorization.attemptId);
      if (existing) {
        if (exactReplay(existing, authorization)) {
          this.database.exec('COMMIT');
          return { authorization: existing, attempt: current };
        }
        throw new Error('Payment authorization ID collision.');
      }
      if (current.state !== 'submitted') {
        throw new Error('Payment authorization requires a submitted attempt.');
      }
      const order = this.requireOrder(authorization.orderId);
      const quote = this.requireQuote(authorization.quoteId);
      this.assertAttemptMatchesOrderAndQuote(current, order, quote);
      this.assertAuthorizationMatches(authorization, current, order, quote);
      const insert = this.database.prepare(`
        INSERT OR IGNORE INTO payment_authorizations (
          authorization_id, attempt_id, provider, network, payment_identifier, payload
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        authorization.authorizationId,
        authorization.attemptId,
        authorization.provider,
        authorization.network,
        authorization.paymentIdentifier,
        JSON.stringify(authorization),
      );
      if (insert.changes !== 1) {
        throw new Error('Duplicate payment authorization or payment identifier.');
      }
      const next = transitionPaymentAttempt(current, 'verified');
      const update = this.database.prepare(`
        UPDATE payment_attempts SET payload = ? WHERE attempt_id = ? AND payload = ?
      `).run(JSON.stringify(next), current.attemptId, JSON.stringify(current));
      if (update.changes !== 1) throw new Error('Concurrent payment authorization transition.');
      this.database.exec('COMMIT');
      return { authorization, attempt: next };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  getPaymentAuthorization(authorizationId: string): PaymentAuthorizationEvidence | undefined {
    const payload = payloadFromRow(this.database.prepare(
      'SELECT payload FROM payment_authorizations WHERE authorization_id = ?',
    ).get(authorizationId));
    return payload === undefined
      ? undefined : parsePaymentAuthorizationEvidence(JSON.parse(payload));
  }

  recordSettlementObservation(value: unknown): {
    observation: PaymentSettlementObservation;
    attempt: PaymentAttempt;
  } {
    const observation = parsePaymentSettlementObservation(value);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.getSettlementObservation(observation.observationId);
      const current = this.requirePaymentAttempt(observation.attemptId);
      if (existing) {
        if (exactReplay(existing, observation)) {
          this.database.exec('COMMIT');
          return { observation: existing, attempt: current };
        }
        throw new Error('Settlement observation ID collision.');
      }
      const authorization = this.requirePaymentAuthorization(observation.authorizationId);
      this.assertObservationMatches(observation, authorization, current);
      const latest = this.getLatestSettlementObservation(observation.authorizationId);
      if (!settlementStatusCanAdvance(latest?.status, observation.status)) {
        throw new Error('Settlement observation would regress a terminal or pending state.');
      }
      const expectedAttemptState = latest
        ? this.attemptStateForSettlement(latest.status)
        : 'verified';
      if (current.state !== expectedAttemptState) {
        throw new Error('Payment attempt does not match its settlement history.');
      }
      if (observation.providerReference) {
        const referenceInsert = this.database.prepare(`
          INSERT OR IGNORE INTO settlement_provider_references (
            provider, network, provider_reference, authorization_id
          ) VALUES (?, ?, ?, ?)
        `).run(
          observation.provider,
          observation.network,
          observation.providerReference,
          observation.authorizationId,
        );
        if (referenceInsert.changes !== 1) {
          const row = this.database.prepare(`
            SELECT authorization_id FROM settlement_provider_references
            WHERE provider = ? AND network = ? AND provider_reference = ?
          `).get(observation.provider, observation.network, observation.providerReference);
          if (!row || (row as { authorization_id?: unknown }).authorization_id
            !== observation.authorizationId) {
            throw new Error('Settlement provider reference belongs to another authorization.');
          }
        }
      }
      const insert = this.database.prepare(`
        INSERT OR IGNORE INTO settlement_observations (
          observation_id, authorization_id, attempt_id, settlement_status,
          reconciliation_id, payload
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        observation.observationId,
        observation.authorizationId,
        observation.attemptId,
        observation.status,
        observation.reconciliationId,
        JSON.stringify(observation),
      );
      if (insert.changes !== 1) {
        throw new Error('Settlement reconciliation ID collision.');
      }
      const next = transitionPaymentAttempt(
        current,
        this.attemptStateForSettlement(observation.status),
      );
      const update = this.database.prepare(`
        UPDATE payment_attempts SET payload = ? WHERE attempt_id = ? AND payload = ?
      `).run(JSON.stringify(next), current.attemptId, JSON.stringify(current));
      if (update.changes !== 1) throw new Error('Concurrent settlement observation transition.');
      this.database.exec('COMMIT');
      return { observation, attempt: next };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  getSettlementObservation(observationId: string): PaymentSettlementObservation | undefined {
    const payload = payloadFromRow(this.database.prepare(
      'SELECT payload FROM settlement_observations WHERE observation_id = ?',
    ).get(observationId));
    return payload === undefined
      ? undefined : parsePaymentSettlementObservation(JSON.parse(payload));
  }

  getLatestSettlementObservation(
    authorizationId: string,
  ): PaymentSettlementObservation | undefined {
    const payload = payloadFromRow(this.database.prepare(`
      SELECT payload FROM settlement_observations
      WHERE authorization_id = ? ORDER BY sequence DESC LIMIT 1
    `).get(authorizationId));
    return payload === undefined
      ? undefined : parsePaymentSettlementObservation(JSON.parse(payload));
  }

  listSettlementObservations(authorizationId: string): PaymentSettlementObservation[] {
    return this.database.prepare(`
      SELECT payload FROM settlement_observations
      WHERE authorization_id = ? ORDER BY sequence ASC
    `).all(authorizationId).map((row) => {
      const payload = payloadFromRow(row);
      if (payload === undefined) throw new Error('Invalid stored settlement observation.');
      return parsePaymentSettlementObservation(JSON.parse(payload));
    });
  }

  commitSettledGrant(value: SettlementGrantCommit): {
    order: CommerceOrder;
    attempt: PaymentAttempt;
    entitlementEvent: EntitlementEvent;
    assetGrant: AssetGrant;
  } {
    const event = parseEntitlementEvent(value.entitlementEvent);
    const grant = parseAssetGrant(value.assetGrant);

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const order = this.requireOrder(value.orderId);
      const attempt = this.requirePaymentAttempt(value.attemptId);
      const quote = this.requireQuote(order.quoteId);
      const observation = this.requireSettlementObservation(value.settlementObservationId);
      const authorization = this.requirePaymentAuthorization(observation.authorizationId);
      const settledAt = observation.settledAt;
      this.assertObservationMatches(observation, authorization, attempt);
      if (observation.status !== 'settled' || !observation.providerReference || !settledAt) {
        throw new Error('Grant requires durable settled observation.');
      }

      if (order.state === 'granted' && attempt.state === 'settled') {
        const storedEvent = this.getEntitlementEvent(event.eventId);
        const storedGrant = this.getAssetGrant(grant.grantId);
        if (order.updatedAt === settledAt && storedEvent && storedGrant
          && event.sourceReference === observation.providerReference
          && exactReplay(storedEvent, event) && exactReplay(storedGrant, grant)) {
          this.database.exec('COMMIT');
          return { order, attempt, entitlementEvent: storedEvent, assetGrant: storedGrant };
        }
        throw new Error('Settled grant replay does not match the committed transaction.');
      }

      if (order.state !== 'awaiting-settlement' || attempt.state !== 'settled') {
        throw new Error('Grant requires an awaiting order and durable settled observation.');
      }
      this.assertAttemptMatchesOrderAndQuote(attempt, order, quote);
      if (event.type !== 'grant'
        || event.accountId !== order.accountId
        || event.productId !== quote.productId
        || event.source !== attempt.provider
        || event.sourceReference !== observation.providerReference) {
        throw new Error('Entitlement event does not match durable settlement evidence.');
      }
      if (grant.accountId !== event.accountId
        || grant.productId !== event.productId
        || grant.productRevision !== quote.productRevision
        || !exactReplay(grant.avatarRevisionIds, quote.avatarRevisionIds)
        || grant.catalogVersion !== quote.catalogVersion
        || grant.entitlementEventId !== event.eventId
        || grant.issuedAt !== event.effectiveAt
        || event.effectiveAt !== settledAt
        || grant.expiresAt !== event.expiresAt
        || grant.state !== 'active') {
        throw new Error('Asset grant does not match its entitlement event and quote.');
      }

      const paidOrder = transitionCommerceOrder(order, 'paid', settledAt);
      const grantedOrder = transitionCommerceOrder(paidOrder, 'granted', settledAt);
      this.insertEntitlementEvent(event);
      this.insertAssetGrant(grant);
      const orderUpdate = this.database.prepare(`
        UPDATE commerce_orders SET payload = ? WHERE order_id = ? AND payload = ?
      `).run(JSON.stringify(grantedOrder), order.orderId, JSON.stringify(order));
      if (orderUpdate.changes !== 1) {
        throw new Error('Concurrent commerce settlement transition.');
      }
      this.database.exec('COMMIT');
      return { order: grantedOrder, attempt, entitlementEvent: event, assetGrant: grant };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  getEntitlementEvent(eventId: string): EntitlementEvent | undefined {
    const payload = payloadFromRow(this.database.prepare(
      'SELECT payload FROM entitlement_events WHERE event_id = ?',
    ).get(eventId));
    return payload === undefined ? undefined : parseEntitlementEvent(JSON.parse(payload));
  }

  listEntitlementEvents(accountId: string, productId: string): EntitlementEvent[] {
    return this.database.prepare(`
      SELECT payload FROM entitlement_events
      WHERE account_id = ? AND product_id = ? ORDER BY sequence ASC
    `).all(accountId, productId).map((row) => {
      const payload = payloadFromRow(row);
      if (payload === undefined) throw new Error('Invalid stored entitlement event.');
      return parseEntitlementEvent(JSON.parse(payload));
    });
  }

  getAssetGrant(grantId: string): AssetGrant | undefined {
    const payload = payloadFromRow(this.database.prepare(
      'SELECT payload FROM asset_grants WHERE grant_id = ?',
    ).get(grantId));
    return payload === undefined ? undefined : parseAssetGrant(JSON.parse(payload));
  }

  private requireQuote(quoteId: string): VerifiedCommerceQuote {
    const quote = this.getQuote(quoteId);
    if (!quote) throw new Error('Commerce quote was not found.');
    return quote;
  }

  private requireOrder(orderId: string): CommerceOrder {
    const order = this.getOrder(orderId);
    if (!order) throw new Error('Commerce order was not found.');
    return order;
  }

  private requirePaymentAttempt(attemptId: string): PaymentAttempt {
    const attempt = this.getPaymentAttempt(attemptId);
    if (!attempt) throw new Error('Payment attempt was not found.');
    return attempt;
  }

  private requirePaymentAuthorization(authorizationId: string): PaymentAuthorizationEvidence {
    const authorization = this.getPaymentAuthorization(authorizationId);
    if (!authorization) throw new Error('Commerce payment authorization was not found.');
    return authorization;
  }

  private requireSettlementObservation(observationId: string): PaymentSettlementObservation {
    const observation = this.getSettlementObservation(observationId);
    if (!observation) throw new Error('Commerce settlement observation was not found.');
    return observation;
  }

  private assertOrderMatchesQuote(order: CommerceOrder, quote: VerifiedCommerceQuote): void {
    if (order.accountId !== quote.accountId
      || order.offerId !== quote.offerId
      || order.offerRevision !== quote.offerRevision
      || order.currency !== quote.currency
      || order.amountAtomic !== quote.amountAtomic
      || Date.parse(order.createdAt) < Date.parse(quote.issuedAt)
      || Date.parse(order.createdAt) >= Date.parse(quote.expiresAt)) {
      throw new Error('Commerce order does not match its authoritative quote.');
    }
  }

  private assertAttemptMatchesOrderAndQuote(
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

  private assertAuthorizationMatches(
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

  private assertObservationMatches(
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

  private attemptStateForSettlement(status: PaymentSettlementStatus): PaymentAttemptState {
    if (status === 'unknown') return 'settlement-unknown';
    if (status === 'pending') return 'settlement-pending';
    if (status === 'settled') return 'settled';
    return 'failed';
  }

  private hasActiveAttempt(orderId: string): boolean {
    return this.database.prepare(
      'SELECT payload FROM payment_attempts WHERE order_id = ?',
    ).all(orderId).some((row) => {
      const payload = payloadFromRow(row);
      if (payload === undefined) throw new Error('Invalid stored payment attempt.');
      return parsePaymentAttempt(JSON.parse(payload)).state !== 'failed';
    });
  }

  private hasUnresolvedOrSettledAttempt(orderId: string): boolean {
    return this.database.prepare(
      'SELECT payload FROM payment_attempts WHERE order_id = ?',
    ).all(orderId).some((row) => {
      const payload = payloadFromRow(row);
      if (payload === undefined) throw new Error('Invalid stored payment attempt.');
      return ['settlement-unknown', 'settlement-pending', 'settled']
        .includes(parsePaymentAttempt(JSON.parse(payload)).state);
    });
  }

  private insertEntitlementEvent(event: EntitlementEvent): void {
    this.database.prepare(`
      INSERT INTO entitlement_events (
        event_id, account_id, product_id, event_type, source, source_reference, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.eventId,
      event.accountId,
      event.productId,
      event.type,
      event.source,
      event.sourceReference,
      JSON.stringify(event),
    );
  }

  private insertAssetGrant(grant: AssetGrant): void {
    this.database.prepare(`
      INSERT INTO asset_grants (
        grant_id, entitlement_event_id, account_id, product_id, payload
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      grant.grantId,
      grant.entitlementEventId,
      grant.accountId,
      grant.productId,
      JSON.stringify(grant),
    );
  }
}
