import { createHash } from 'node:crypto';

import {
  parseCommerceOrder,
  parseVerifiedCommerceQuote,
  type CommerceOrder,
  type VerifiedCommerceQuote,
} from '../../shared/commerce';
import {
  parseCommerceQuoteRequest,
  type CommerceQuoteRequest,
  type CommerceQuoteResponse,
} from '../../shared/commerce-service';
import { baseSepoliaNetwork, baseSepoliaUsdc } from './x402-base-sepolia';
import type { PostgresCheckoutLedger } from './postgres-checkout-ledger';
import { CommerceServiceError } from './http-api';
import type { HostedCommerceIdentityService } from './identity-session-service';

export interface BaseSepoliaOfferPolicy {
  schemaVersion: 1;
  offerId: string;
  offerRevision: number;
  productId: string;
  productRevision: number;
  avatarRevisionIds: string[];
  catalogVersion: string;
  regions: string[];
  currency: 'USDC';
  amountAtomic: string;
  recipient: string;
}

const idPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const regionPattern = /^[A-Z]{2}$/;

export function parseBaseSepoliaOfferPolicy(value: unknown): BaseSepoliaOfferPolicy {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Hosted commerce offer is invalid.');
  }
  const source = value as Record<string, unknown>;
  const fields = ['schemaVersion', 'offerId', 'offerRevision', 'productId', 'productRevision',
    'avatarRevisionIds', 'catalogVersion', 'regions', 'currency', 'amountAtomic', 'recipient'];
  if (Object.keys(source).some((field) => !fields.includes(field)) || source.schemaVersion !== 1
    || !idPattern.test(String(source.offerId ?? '')) || !idPattern.test(String(source.productId ?? ''))
    || !idPattern.test(String(source.catalogVersion ?? ''))
    || !Number.isSafeInteger(source.offerRevision) || Number(source.offerRevision) < 1
    || !Number.isSafeInteger(source.productRevision) || Number(source.productRevision) < 1
    || !Array.isArray(source.avatarRevisionIds) || source.avatarRevisionIds.length < 1
    || source.avatarRevisionIds.length > 100
    || source.avatarRevisionIds.some((entry) => !idPattern.test(String(entry)))
    || new Set(source.avatarRevisionIds).size !== source.avatarRevisionIds.length
    || !Array.isArray(source.regions) || source.regions.length < 1 || source.regions.length > 250
    || source.regions.some((entry) => !regionPattern.test(String(entry)))
    || new Set(source.regions).size !== source.regions.length
    || source.currency !== 'USDC'
    || typeof source.amountAtomic !== 'string' || !/^[1-9][0-9]{0,11}$/.test(source.amountAtomic)
    || typeof source.recipient !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(source.recipient)
    || /^0x0{40}$/i.test(source.recipient)) {
    throw new Error('Hosted commerce offer is invalid.');
  }
  return {
    schemaVersion: 1,
    offerId: String(source.offerId), offerRevision: Number(source.offerRevision),
    productId: String(source.productId), productRevision: Number(source.productRevision),
    avatarRevisionIds: source.avatarRevisionIds.map(String), catalogVersion: String(source.catalogVersion),
    regions: source.regions.map(String), currency: 'USDC', amountAtomic: source.amountAtomic,
    recipient: source.recipient,
  };
}

export class HostedCommerceQuoteService {
  constructor(
    private readonly ledger: PostgresCheckoutLedger,
    private readonly identity: HostedCommerceIdentityService,
    private readonly offer: BaseSepoliaOfferPolicy,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.offer = parseBaseSepoliaOfferPolicy(offer);
  }

  async createQuote(
    value: CommerceQuoteRequest,
    accessToken: string,
  ): Promise<CommerceQuoteResponse> {
    const request = parseCommerceQuoteRequest(value);
    const authenticated = await this.identity.authenticateCommerceToken(accessToken);
    if (authenticated.installationId !== request.installationId
      || request.offerId !== this.offer.offerId
      || !this.offer.regions.includes(request.region)) {
      throw new CommerceServiceError('authentication-failed');
    }
    const now = this.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Invalid quote service time.');
    const issuedAt = now.toISOString();
    const digest = createHash('sha256').update(
      `${authenticated.accountId}:${request.idempotencyKey}:${this.offer.offerId}:${this.offer.offerRevision}`,
    ).digest('hex').slice(0, 32);
    const quoteId = `quote:${digest}`;
    const orderId = `order:${digest}`;
    const [existingQuote, existingOrder] = await Promise.all([
      this.ledger.getQuote(quoteId), this.ledger.getOrder(orderId),
    ]);
    if (existingQuote || existingOrder) {
      if (!existingQuote || !existingOrder
        || existingQuote.accountId !== authenticated.accountId
        || existingQuote.offerId !== this.offer.offerId
        || existingQuote.offerRevision !== this.offer.offerRevision
        || existingOrder.accountId !== authenticated.accountId
        || existingOrder.quoteId !== existingQuote.quoteId
        || existingOrder.idempotencyKey !== request.idempotencyKey) {
        throw new CommerceServiceError('conflict');
      }
      return { schemaVersion: 1, quote: existingQuote, order: existingOrder };
    }
    const quote: VerifiedCommerceQuote = parseVerifiedCommerceQuote({
      schemaVersion: 1,
      quoteId,
      accountId: authenticated.accountId,
      offerId: this.offer.offerId,
      offerRevision: this.offer.offerRevision,
      productId: this.offer.productId,
      productRevision: this.offer.productRevision,
      avatarRevisionIds: this.offer.avatarRevisionIds,
      catalogVersion: this.offer.catalogVersion,
      provider: 'x402-base',
      releaseProfile: 'windows-direct',
      region: request.region,
      currency: this.offer.currency,
      amountAtomic: this.offer.amountAtomic,
      network: baseSepoliaNetwork,
      asset: baseSepoliaUsdc,
      recipient: this.offer.recipient,
      issuedAt,
      expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    });
    const order: CommerceOrder = parseCommerceOrder({
      schemaVersion: 1,
      orderId,
      quoteId: quote.quoteId,
      accountId: quote.accountId,
      offerId: quote.offerId,
      offerRevision: quote.offerRevision,
      idempotencyKey: request.idempotencyKey,
      currency: quote.currency,
      amountAtomic: quote.amountAtomic,
      state: 'created',
      createdAt: issuedAt,
      updatedAt: issuedAt,
    });
    const storedQuote = await this.ledger.storeQuote(quote);
    const storedOrder = await this.ledger.createOrder(order);
    return { schemaVersion: 1, quote: storedQuote, order: storedOrder };
  }
}
