import { createHash } from 'node:crypto';

import type { AssetGrant, EntitlementEvent } from '../../shared/commerce';
import type { PaymentSettlementObservation } from '../../shared/commerce-settlement';
import type {
  HostedSettlementGrantCommit,
  PostgresCheckoutLedger,
} from './postgres-checkout-ledger';

function deterministicId(prefix: string, material: string): string {
  return `${prefix}:${createHash('sha256').update(material).digest('hex').slice(0, 32)}`;
}

/**
 * Projects one exact durable settlement into the provider-neutral entitlement ledger. JWTs and
 * checkout UI never grant products; this transaction is the only paid grant authority.
 */
export class HostedPaidGrantService {
  constructor(private readonly ledger: PostgresCheckoutLedger) {}

  async commitSettlement(observation: PaymentSettlementObservation): Promise<HostedSettlementGrantCommit> {
    if (observation.status !== 'settled' || !observation.settledAt
      || !observation.providerReference) {
      throw new Error('Paid grant requires exact durable settlement evidence.');
    }
    const order = await this.ledger.getOrder(observation.orderId);
    if (!order || order.quoteId !== observation.quoteId) {
      throw new Error('Paid grant order is unavailable.');
    }
    const quote = await this.ledger.getQuote(order.quoteId);
    if (!quote || quote.accountId !== order.accountId || quote.provider !== observation.provider) {
      throw new Error('Paid grant quote is unavailable.');
    }
    const material = `${quote.accountId}:${quote.productId}:${observation.providerReference}`;
    const event: EntitlementEvent = {
      schemaVersion: 1,
      eventId: deterministicId('event:x402', material),
      accountId: quote.accountId,
      productId: quote.productId,
      type: 'grant',
      source: observation.provider,
      sourceReference: observation.providerReference,
      effectiveAt: observation.settledAt,
      reasonCode: 'verified-chain-settlement',
    };
    const grant: AssetGrant = {
      schemaVersion: 1,
      grantId: deterministicId('grant:x402', material),
      accountId: quote.accountId,
      productId: quote.productId,
      productRevision: quote.productRevision,
      avatarRevisionIds: [...quote.avatarRevisionIds],
      entitlementEventId: event.eventId,
      catalogVersion: quote.catalogVersion,
      state: 'active',
      issuedAt: observation.settledAt,
    };
    await this.ledger.commitSettledGrant({
      orderId: order.orderId,
      attemptId: observation.attemptId,
      settlementObservationId: observation.observationId,
      entitlementEvent: event,
      assetGrant: grant,
    });
    return {
      orderId: order.orderId,
      attemptId: observation.attemptId,
      settlementObservationId: observation.observationId,
      entitlementEvent: event,
      assetGrant: grant,
    };
  }
}
