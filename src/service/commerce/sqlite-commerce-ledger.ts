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

export interface SettlementGrantCommit {
  orderId: string;
  attemptId: string;
  settledAt: string;
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
        provider_reference TEXT,
        payload TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS payment_provider_reference
        ON payment_attempts(provider, provider_reference)
        WHERE provider_reference IS NOT NULL;

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
    if (attempt.providerReference !== undefined) {
      throw new Error('A new payment attempt cannot claim a provider reference.');
    }
    const order = this.requireOrder(attempt.orderId);
    const quote = this.requireQuote(attempt.quoteId);
    this.assertAttemptMatchesOrderAndQuote(attempt, order, quote);
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO payment_attempts (
        attempt_id, order_id, quote_id, provider, provider_reference, payload
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      attempt.attemptId,
      attempt.orderId,
      attempt.quoteId,
      attempt.provider,
      attempt.providerReference ?? null,
      JSON.stringify(attempt),
    );
    if (result.changes === 1) return attempt;
    const existing = this.getPaymentAttempt(attempt.attemptId);
    if (existing && exactReplay(existing, attempt)) return existing;
    if (existing) throw new Error('Payment attempt ID collision.');
    throw new Error('Payment provider-reference collision.');
  }

  getPaymentAttempt(attemptId: string): PaymentAttempt | undefined {
    const payload = payloadFromRow(this.database.prepare(
      'SELECT payload FROM payment_attempts WHERE attempt_id = ?',
    ).get(attemptId));
    return payload === undefined ? undefined : parsePaymentAttempt(JSON.parse(payload));
  }

  advancePaymentAttempt(attemptId: string, state: PaymentAttemptState): PaymentAttempt {
    if (state === 'verified') {
      throw new Error('Use verified payment evidence to verify a payment attempt.');
    }
    const current = this.requirePaymentAttempt(attemptId);
    const next = transitionPaymentAttempt(current, state);
    if (next === current) return current;
    const result = this.database.prepare(`
      UPDATE payment_attempts SET payload = ? WHERE attempt_id = ? AND payload = ?
    `).run(JSON.stringify(next), attemptId, JSON.stringify(current));
    if (result.changes !== 1) throw new Error('Concurrent payment attempt transition.');
    return next;
  }

  verifyPaymentAttempt(attemptId: string, providerReference: string): PaymentAttempt {
    const current = this.requirePaymentAttempt(attemptId);
    if (current.state === 'verified') {
      if (current.providerReference === providerReference) return current;
      throw new Error('Payment provider reference is immutable after verification.');
    }
    const next = parsePaymentAttempt({
      ...transitionPaymentAttempt(current, 'verified'),
      providerReference,
    });
    const result = this.database.prepare(`
      UPDATE OR IGNORE payment_attempts
      SET provider_reference = ?, payload = ?
      WHERE attempt_id = ? AND payload = ?
    `).run(providerReference, JSON.stringify(next), attemptId, JSON.stringify(current));
    if (result.changes !== 1) {
      throw new Error('Concurrent or duplicate payment provider reference.');
    }
    return next;
  }

  commitSettledGrant(value: SettlementGrantCommit): {
    order: CommerceOrder;
    attempt: PaymentAttempt;
    entitlementEvent: EntitlementEvent;
    assetGrant: AssetGrant;
  } {
    const event = parseEntitlementEvent(value.entitlementEvent);
    const grant = parseAssetGrant(value.assetGrant);
    const settledAt = new Date(value.settledAt).toISOString();
    if (settledAt !== value.settledAt) throw new Error('Invalid settlement timestamp.');

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const order = this.requireOrder(value.orderId);
      const attempt = this.requirePaymentAttempt(value.attemptId);
      const quote = this.requireQuote(order.quoteId);

      if (order.state === 'granted' && attempt.state === 'settled') {
        const storedEvent = this.getEntitlementEvent(event.eventId);
        const storedGrant = this.getAssetGrant(grant.grantId);
        if (order.updatedAt === settledAt && storedEvent && storedGrant
          && exactReplay(storedEvent, event) && exactReplay(storedGrant, grant)) {
          this.database.exec('COMMIT');
          return { order, attempt, entitlementEvent: storedEvent, assetGrant: storedGrant };
        }
        throw new Error('Settled grant replay does not match the committed transaction.');
      }

      if (order.state !== 'awaiting-settlement' || attempt.state !== 'verified') {
        throw new Error('Settlement requires an awaiting order and verified payment attempt.');
      }
      this.assertAttemptMatchesOrderAndQuote(attempt, order, quote);
      if (Date.parse(settledAt) >= Date.parse(quote.expiresAt)) {
        throw new Error('Cannot settle an expired commerce quote.');
      }
      if (!attempt.providerReference
        || event.type !== 'grant'
        || event.accountId !== order.accountId
        || event.productId !== quote.productId
        || event.source !== attempt.provider
        || event.sourceReference !== attempt.providerReference) {
        throw new Error('Entitlement event does not match verified settlement evidence.');
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

      const settledAttempt = transitionPaymentAttempt(attempt, 'settled');
      const paidOrder = transitionCommerceOrder(order, 'paid', settledAt);
      const grantedOrder = transitionCommerceOrder(paidOrder, 'granted', settledAt);
      this.insertEntitlementEvent(event);
      this.insertAssetGrant(grant);
      const attemptUpdate = this.database.prepare(`
        UPDATE payment_attempts SET payload = ? WHERE attempt_id = ? AND payload = ?
      `).run(JSON.stringify(settledAttempt), attempt.attemptId, JSON.stringify(attempt));
      const orderUpdate = this.database.prepare(`
        UPDATE commerce_orders SET payload = ? WHERE order_id = ? AND payload = ?
      `).run(JSON.stringify(grantedOrder), order.orderId, JSON.stringify(order));
      if (attemptUpdate.changes !== 1 || orderUpdate.changes !== 1) {
        throw new Error('Concurrent commerce settlement transition.');
      }
      this.database.exec('COMMIT');
      return { order: grantedOrder, attempt: settledAttempt, entitlementEvent: event, assetGrant: grant };
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
