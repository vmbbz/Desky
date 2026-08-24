import type { DistributionProfile } from './runtime';

export const commerceProviderIds = [
  'free',
  'storekit',
  'microsoft',
  'x402-base',
  'x402-solana',
  'support',
] as const;
export type CommerceProviderId = (typeof commerceProviderIds)[number];

export const commerceReleaseProfiles = [
  'windows-direct',
  'windows-store',
  'macos-direct',
  'macos-store',
] as const;
export type CommerceReleaseProfile = (typeof commerceReleaseProfiles)[number];

export const commerceProductKinds = ['avatar', 'pack', 'catalog-pass'] as const;
export type CommerceProductKind = (typeof commerceProductKinds)[number];
export const commerceProductStates = ['draft', 'active', 'suspended', 'retired'] as const;
export type CommerceProductState = (typeof commerceProductStates)[number];

export interface CommerceProduct {
  schemaVersion: 1;
  productId: string;
  revision: number;
  kind: CommerceProductKind;
  avatarRevisionIds: string[];
  state: CommerceProductState;
}

export const commerceOfferStates = ['draft', 'active', 'paused', 'retired'] as const;
export type CommerceOfferState = (typeof commerceOfferStates)[number];

export interface CommerceOffer {
  schemaVersion: 1;
  offerId: string;
  productId: string;
  revision: number;
  releaseProfiles: CommerceReleaseProfile[];
  regions: string[];
  priceBookId: string;
  providers: CommerceProviderId[];
  startsAt: string;
  endsAt?: string;
  state: CommerceOfferState;
}

export interface VerifiedCommerceQuote {
  schemaVersion: 1;
  quoteId: string;
  accountId: string;
  offerId: string;
  offerRevision: number;
  productId: string;
  productRevision: number;
  avatarRevisionIds: string[];
  catalogVersion: string;
  provider: Exclude<CommerceProviderId, 'free' | 'support'>;
  releaseProfile: CommerceReleaseProfile;
  region: string;
  currency: string;
  amountAtomic: string;
  network?: string;
  asset?: string;
  recipient?: string;
  issuedAt: string;
  expiresAt: string;
}

export const commerceOrderStates = [
  'created',
  'awaiting-approval',
  'awaiting-settlement',
  'paid',
  'granted',
  'cancelled',
  'expired',
  'refunded',
  'disputed',
] as const;
export type CommerceOrderState = (typeof commerceOrderStates)[number];

export interface CommerceOrder {
  schemaVersion: 1;
  orderId: string;
  quoteId: string;
  accountId: string;
  offerId: string;
  offerRevision: number;
  idempotencyKey: string;
  currency: string;
  amountAtomic: string;
  state: CommerceOrderState;
  createdAt: string;
  updatedAt: string;
}

export const paymentAttemptStates = ['created', 'submitted', 'verified', 'settled', 'failed'] as const;
export type PaymentAttemptState = (typeof paymentAttemptStates)[number];

export interface PaymentAttempt {
  schemaVersion: 1;
  attemptId: string;
  orderId: string;
  quoteId: string;
  provider: CommerceProviderId;
  providerReference?: string;
  network?: string;
  asset?: string;
  recipient?: string;
  quoteExpiresAt: string;
  state: PaymentAttemptState;
}

export const entitlementEventTypes = [
  'grant',
  'revoke',
  'expire',
  'refund',
  'support-restore',
] as const;
export type EntitlementEventType = (typeof entitlementEventTypes)[number];

export interface EntitlementEvent {
  schemaVersion: 1;
  eventId: string;
  accountId: string;
  productId: string;
  type: EntitlementEventType;
  source: CommerceProviderId;
  sourceReference: string;
  effectiveAt: string;
  expiresAt?: string;
  reasonCode: string;
}

export interface EntitlementProjection {
  accountId: string;
  productId: string;
  status: 'not-granted' | 'granted' | 'expired';
  lastEventId?: string;
  source?: CommerceProviderId;
  expiresAt?: string;
}

export const assetGrantStates = ['active', 'suspended', 'revoked', 'expired'] as const;
export type AssetGrantState = (typeof assetGrantStates)[number];

export interface AssetGrant {
  schemaVersion: 1;
  grantId: string;
  accountId: string;
  productId: string;
  productRevision: number;
  avatarRevisionIds: string[];
  entitlementEventId: string;
  catalogVersion: string;
  state: AssetGrantState;
  issuedAt: string;
  expiresAt?: string;
}

export interface CommerceRuntimePolicy {
  releaseProfile: CommerceReleaseProfile;
  providers: Record<CommerceProviderId, boolean>;
  externalCheckout: false;
  productionPayments: false;
}

const identifierPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const currencyPattern = /^[A-Z][A-Z0-9]{2,11}$/;
const regionPattern = /^[A-Z]{2}$/;
const atomicAmountPattern = /^[1-9][0-9]{0,38}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readExactRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((field) => !fields.includes(field))) {
    throw new Error(`Invalid commerce ${name}.`);
  }
  return value;
}

function readString(value: unknown, field: string, maximum = 256): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || value.trim() !== value) {
    throw new Error(`Invalid commerce ${field}.`);
  }
  return value;
}

function readIdentifier(value: unknown, field: string): string {
  const identifier = readString(value, field, 128);
  if (!identifierPattern.test(identifier)) throw new Error(`Invalid commerce ${field}.`);
  return identifier;
}

function readRevision(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid commerce ${field}.`);
  }
  return value;
}

function readTimestamp(value: unknown, field: string): string {
  const timestamp = readString(value, field, 30);
  if (!timestampPattern.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`Invalid commerce ${field}.`);
  }
  return timestamp;
}

function readOptionalTimestamp(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : readTimestamp(value, field);
}

function readUniqueIdentifiers(value: unknown, field: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    throw new Error(`Invalid commerce ${field}.`);
  }
  const identifiers = value.map((entry) => readIdentifier(entry, field));
  if (new Set(identifiers).size !== identifiers.length) throw new Error(`Invalid commerce ${field}.`);
  return identifiers;
}

function readEnum<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new Error(`Invalid commerce ${field}.`);
  }
  return value as T;
}

function readEnumArray<T extends string>(
  value: unknown,
  values: readonly T[],
  field: string,
): T[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > values.length) {
    throw new Error(`Invalid commerce ${field}.`);
  }
  const entries = value.map((entry) => readEnum(entry, values, field));
  if (new Set(entries).size !== entries.length) throw new Error(`Invalid commerce ${field}.`);
  return entries;
}

export function parseCommerceProduct(value: unknown): CommerceProduct {
  const source = readExactRecord(value, [
    'schemaVersion', 'productId', 'revision', 'kind', 'avatarRevisionIds', 'state',
  ], 'product');
  if (source.schemaVersion !== 1) throw new Error('Invalid commerce product.');
  const product: CommerceProduct = {
    schemaVersion: 1,
    productId: readIdentifier(source.productId, 'product ID'),
    revision: readRevision(source.revision, 'product revision'),
    kind: readEnum(source.kind, commerceProductKinds, 'product kind'),
    avatarRevisionIds: readUniqueIdentifiers(source.avatarRevisionIds, 'avatar revision IDs', 1_000),
    state: readEnum(source.state, commerceProductStates, 'product state'),
  };
  if (product.kind === 'avatar' && product.avatarRevisionIds.length !== 1) {
    throw new Error('An avatar product must grant exactly one avatar revision.');
  }
  return product;
}

export function parseCommerceOffer(value: unknown): CommerceOffer {
  const source = readExactRecord(value, [
    'schemaVersion', 'offerId', 'productId', 'revision', 'releaseProfiles', 'regions',
    'priceBookId', 'providers', 'startsAt', 'endsAt', 'state',
  ], 'offer');
  if (source.schemaVersion !== 1 || !Array.isArray(source.regions)
    || source.regions.length < 1 || source.regions.length > 250) {
    throw new Error('Invalid commerce offer.');
  }
  const regions = source.regions.map((entry) => readString(entry, 'offer region', 2));
  if (regions.some((region) => !regionPattern.test(region)) || new Set(regions).size !== regions.length) {
    throw new Error('Invalid commerce offer regions.');
  }
  const offer: CommerceOffer = {
    schemaVersion: 1,
    offerId: readIdentifier(source.offerId, 'offer ID'),
    productId: readIdentifier(source.productId, 'product ID'),
    revision: readRevision(source.revision, 'offer revision'),
    releaseProfiles: readEnumArray(source.releaseProfiles, commerceReleaseProfiles, 'release profiles'),
    regions,
    priceBookId: readIdentifier(source.priceBookId, 'price book ID'),
    providers: readEnumArray(source.providers, commerceProviderIds, 'offer providers'),
    startsAt: readTimestamp(source.startsAt, 'offer start'),
    endsAt: readOptionalTimestamp(source.endsAt, 'offer end'),
    state: readEnum(source.state, commerceOfferStates, 'offer state'),
  };
  if (offer.providers.some((provider) => provider === 'free' || provider === 'support')) {
    throw new Error('A paid offer cannot use a non-payment entitlement source.');
  }
  if (offer.endsAt && Date.parse(offer.endsAt) <= Date.parse(offer.startsAt)) {
    throw new Error('Commerce offer end must be after its start.');
  }
  return offer;
}

export function parseVerifiedCommerceQuote(value: unknown): VerifiedCommerceQuote {
  const source = readExactRecord(value, [
    'schemaVersion', 'quoteId', 'accountId', 'offerId', 'offerRevision', 'productId',
    'productRevision', 'avatarRevisionIds', 'catalogVersion', 'provider', 'releaseProfile', 'region',
    'currency', 'amountAtomic',
    'network', 'asset', 'recipient', 'issuedAt', 'expiresAt',
  ], 'verified quote');
  if (source.schemaVersion !== 1) throw new Error('Invalid commerce verified quote.');
  const provider = readEnum(source.provider, commerceProviderIds, 'quote provider');
  if (provider === 'free' || provider === 'support') {
    throw new Error('A verified quote requires a payment provider.');
  }
  const region = readString(source.region, 'quote region', 2);
  const currency = readString(source.currency, 'quote currency', 12);
  const amountAtomic = readString(source.amountAtomic, 'quote atomic amount', 39);
  const quote: VerifiedCommerceQuote = {
    schemaVersion: 1,
    quoteId: readIdentifier(source.quoteId, 'quote ID'),
    accountId: readIdentifier(source.accountId, 'account ID'),
    offerId: readIdentifier(source.offerId, 'offer ID'),
    offerRevision: readRevision(source.offerRevision, 'offer revision'),
    productId: readIdentifier(source.productId, 'product ID'),
    productRevision: readRevision(source.productRevision, 'product revision'),
    avatarRevisionIds: readUniqueIdentifiers(source.avatarRevisionIds, 'quote avatar revision IDs', 1_000),
    catalogVersion: readIdentifier(source.catalogVersion, 'catalog version'),
    provider,
    releaseProfile: readEnum(source.releaseProfile, commerceReleaseProfiles, 'release profile'),
    region,
    currency,
    amountAtomic,
    network: source.network === undefined ? undefined : readString(source.network, 'quote network', 120),
    asset: source.asset === undefined ? undefined : readString(source.asset, 'quote asset', 160),
    recipient: source.recipient === undefined
      ? undefined : readString(source.recipient, 'quote recipient', 160),
    issuedAt: readTimestamp(source.issuedAt, 'quote issue timestamp'),
    expiresAt: readTimestamp(source.expiresAt, 'quote expiry'),
  };
  if (!regionPattern.test(quote.region)
    || !currencyPattern.test(quote.currency)
    || !atomicAmountPattern.test(quote.amountAtomic)) {
    throw new Error('Invalid commerce verified quote amount or region.');
  }
  if (Date.parse(quote.expiresAt) <= Date.parse(quote.issuedAt)) {
    throw new Error('Commerce quote expiry must be after issue time.');
  }
  const hasChainTerms = quote.network !== undefined
    || quote.asset !== undefined
    || quote.recipient !== undefined;
  if (quote.provider === 'x402-base' || quote.provider === 'x402-solana') {
    if (!quote.network || !quote.asset || !quote.recipient) {
      throw new Error('An x402 quote requires exact network, asset, and recipient terms.');
    }
  } else if (hasChainTerms) {
    throw new Error('A native-store quote cannot contain x402 settlement terms.');
  }
  return quote;
}

export function parseCommerceOrder(value: unknown): CommerceOrder {
  const source = readExactRecord(value, [
    'schemaVersion', 'orderId', 'quoteId', 'accountId', 'offerId', 'offerRevision', 'idempotencyKey',
    'currency', 'amountAtomic', 'state', 'createdAt', 'updatedAt',
  ], 'order');
  if (source.schemaVersion !== 1) throw new Error('Invalid commerce order.');
  const currency = readString(source.currency, 'order currency', 12);
  const amountAtomic = readString(source.amountAtomic, 'order atomic amount', 39);
  if (!currencyPattern.test(currency) || !atomicAmountPattern.test(amountAtomic)) {
    throw new Error('Invalid commerce order amount.');
  }
  const order: CommerceOrder = {
    schemaVersion: 1,
    orderId: readIdentifier(source.orderId, 'order ID'),
    quoteId: readIdentifier(source.quoteId, 'quote ID'),
    accountId: readIdentifier(source.accountId, 'account ID'),
    offerId: readIdentifier(source.offerId, 'offer ID'),
    offerRevision: readRevision(source.offerRevision, 'offer revision'),
    idempotencyKey: readIdentifier(source.idempotencyKey, 'idempotency key'),
    currency,
    amountAtomic,
    state: readEnum(source.state, commerceOrderStates, 'order state'),
    createdAt: readTimestamp(source.createdAt, 'order creation timestamp'),
    updatedAt: readTimestamp(source.updatedAt, 'order update timestamp'),
  };
  if (Date.parse(order.updatedAt) < Date.parse(order.createdAt)) {
    throw new Error('Commerce order update precedes creation.');
  }
  return order;
}

export function parsePaymentAttempt(value: unknown): PaymentAttempt {
  const source = readExactRecord(value, [
    'schemaVersion', 'attemptId', 'orderId', 'quoteId', 'provider', 'providerReference', 'network',
    'asset', 'recipient', 'quoteExpiresAt', 'state',
  ], 'payment attempt');
  if (source.schemaVersion !== 1) throw new Error('Invalid commerce payment attempt.');
  const provider = readEnum(source.provider, commerceProviderIds, 'payment provider');
  if (provider === 'free' || provider === 'support') {
    throw new Error('A payment attempt requires a payment provider.');
  }
  return {
    schemaVersion: 1,
    attemptId: readIdentifier(source.attemptId, 'attempt ID'),
    orderId: readIdentifier(source.orderId, 'order ID'),
    quoteId: readIdentifier(source.quoteId, 'quote ID'),
    provider,
    providerReference: source.providerReference === undefined
      ? undefined : readString(source.providerReference, 'provider reference', 256),
    network: source.network === undefined ? undefined : readString(source.network, 'network', 120),
    asset: source.asset === undefined ? undefined : readString(source.asset, 'asset', 160),
    recipient: source.recipient === undefined ? undefined : readString(source.recipient, 'recipient', 160),
    quoteExpiresAt: readTimestamp(source.quoteExpiresAt, 'quote expiry'),
    state: readEnum(source.state, paymentAttemptStates, 'payment attempt state'),
  };
}

export function parseEntitlementEvent(value: unknown): EntitlementEvent {
  const source = readExactRecord(value, [
    'schemaVersion', 'eventId', 'accountId', 'productId', 'type', 'source',
    'sourceReference', 'effectiveAt', 'expiresAt', 'reasonCode',
  ], 'entitlement event');
  if (source.schemaVersion !== 1) throw new Error('Invalid commerce entitlement event.');
  const event: EntitlementEvent = {
    schemaVersion: 1,
    eventId: readIdentifier(source.eventId, 'event ID'),
    accountId: readIdentifier(source.accountId, 'account ID'),
    productId: readIdentifier(source.productId, 'product ID'),
    type: readEnum(source.type, entitlementEventTypes, 'entitlement event type'),
    source: readEnum(source.source, commerceProviderIds, 'entitlement source'),
    sourceReference: readIdentifier(source.sourceReference, 'source reference'),
    effectiveAt: readTimestamp(source.effectiveAt, 'entitlement effective timestamp'),
    expiresAt: readOptionalTimestamp(source.expiresAt, 'entitlement expiry'),
    reasonCode: readIdentifier(source.reasonCode, 'reason code'),
  };
  if (event.type === 'support-restore' && event.source !== 'support') {
    throw new Error('Only support can issue a support restore.');
  }
  if (event.type === 'refund' && !['storekit', 'microsoft', 'x402-base', 'x402-solana'].includes(event.source)) {
    throw new Error('A refund must reference a payment provider.');
  }
  if (event.expiresAt && Date.parse(event.expiresAt) <= Date.parse(event.effectiveAt)) {
    throw new Error('Entitlement expiry must be after its effective time.');
  }
  return event;
}

export function parseAssetGrant(value: unknown): AssetGrant {
  const source = readExactRecord(value, [
    'schemaVersion', 'grantId', 'accountId', 'productId', 'productRevision',
    'avatarRevisionIds', 'entitlementEventId', 'catalogVersion', 'state', 'issuedAt', 'expiresAt',
  ], 'asset grant');
  if (source.schemaVersion !== 1) throw new Error('Invalid commerce asset grant.');
  const grant: AssetGrant = {
    schemaVersion: 1,
    grantId: readIdentifier(source.grantId, 'grant ID'),
    accountId: readIdentifier(source.accountId, 'account ID'),
    productId: readIdentifier(source.productId, 'product ID'),
    productRevision: readRevision(source.productRevision, 'product revision'),
    avatarRevisionIds: readUniqueIdentifiers(source.avatarRevisionIds, 'avatar revision IDs', 1_000),
    entitlementEventId: readIdentifier(source.entitlementEventId, 'entitlement event ID'),
    catalogVersion: readIdentifier(source.catalogVersion, 'catalog version'),
    state: readEnum(source.state, assetGrantStates, 'asset grant state'),
    issuedAt: readTimestamp(source.issuedAt, 'asset grant issue timestamp'),
    expiresAt: readOptionalTimestamp(source.expiresAt, 'asset grant expiry'),
  };
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.parse(grant.issuedAt)) {
    throw new Error('Asset grant expiry must be after issue time.');
  }
  return grant;
}

const orderTransitions: Record<CommerceOrderState, readonly CommerceOrderState[]> = {
  created: ['awaiting-approval', 'cancelled', 'expired'],
  'awaiting-approval': ['awaiting-settlement', 'cancelled', 'expired'],
  'awaiting-settlement': ['paid', 'cancelled', 'expired'],
  paid: ['granted', 'refunded', 'disputed'],
  granted: ['refunded', 'disputed'],
  cancelled: [],
  expired: [],
  refunded: [],
  disputed: ['granted', 'refunded'],
};

export function transitionCommerceOrder(
  order: CommerceOrder,
  state: CommerceOrderState,
  updatedAt: string,
): CommerceOrder {
  const parsedUpdatedAt = readTimestamp(updatedAt, 'order transition timestamp');
  if (state === order.state) return order;
  if (!orderTransitions[order.state].includes(state)
    || Date.parse(parsedUpdatedAt) < Date.parse(order.updatedAt)) {
    throw new Error(`Invalid commerce order transition: ${order.state} -> ${state}.`);
  }
  return { ...order, state, updatedAt: parsedUpdatedAt };
}

const attemptTransitions: Record<PaymentAttemptState, readonly PaymentAttemptState[]> = {
  created: ['submitted', 'failed'],
  submitted: ['verified', 'failed'],
  verified: ['settled', 'failed'],
  settled: [],
  failed: [],
};

export function transitionPaymentAttempt(
  attempt: PaymentAttempt,
  state: PaymentAttemptState,
): PaymentAttempt {
  if (state === attempt.state) return attempt;
  if (!attemptTransitions[attempt.state].includes(state)) {
    throw new Error(`Invalid payment attempt transition: ${attempt.state} -> ${state}.`);
  }
  return { ...attempt, state };
}

export function appendEntitlementEvent(
  ledger: readonly EntitlementEvent[],
  event: EntitlementEvent,
): EntitlementEvent[] {
  const sameId = ledger.find((entry) => entry.eventId === event.eventId);
  if (sameId) {
    if (JSON.stringify(sameId) === JSON.stringify(event)) return [...ledger];
    throw new Error('Entitlement event ID collision.');
  }
  const duplicateSourceEvent = ledger.some((entry) => entry.accountId === event.accountId
    && entry.productId === event.productId
    && entry.type === event.type
    && entry.source === event.source
    && entry.sourceReference === event.sourceReference);
  if (duplicateSourceEvent) throw new Error('Duplicate entitlement source event.');
  return [...ledger, structuredClone(event)];
}

export function projectEntitlement(
  ledger: readonly EntitlementEvent[],
  accountId: string,
  productId: string,
  at: string,
): EntitlementProjection {
  const parsedAccountId = readIdentifier(accountId, 'account ID');
  const parsedProductId = readIdentifier(productId, 'product ID');
  const projectionTime = readTimestamp(at, 'projection timestamp');
  let projection: EntitlementProjection = {
    accountId: parsedAccountId,
    productId: parsedProductId,
    status: 'not-granted',
  };
  for (const event of ledger) {
    if (event.accountId !== parsedAccountId
      || event.productId !== parsedProductId
      || Date.parse(event.effectiveAt) > Date.parse(projectionTime)) continue;
    const granted = event.type === 'grant' || event.type === 'support-restore';
    projection = {
      accountId: parsedAccountId,
      productId: parsedProductId,
      status: granted ? 'granted' : 'not-granted',
      lastEventId: event.eventId,
      source: event.source,
      expiresAt: granted ? event.expiresAt : undefined,
    };
  }
  if (projection.status === 'granted'
    && projection.expiresAt
    && Date.parse(projection.expiresAt) <= Date.parse(projectionTime)) {
    return { ...projection, status: 'expired' };
  }
  return projection;
}

export function resolveCommerceRuntimePolicy(
  distributionProfile: DistributionProfile,
  platform: NodeJS.Platform,
): CommerceRuntimePolicy {
  if (platform !== 'win32' && platform !== 'darwin') {
    throw new Error('Commerce is unavailable on this platform.');
  }
  const releaseProfile: CommerceReleaseProfile = platform === 'darwin'
    ? distributionProfile === 'store' ? 'macos-store' : 'macos-direct'
    : distributionProfile === 'store' ? 'windows-store' : 'windows-direct';
  return {
    releaseProfile,
    providers: {
      free: true,
      storekit: false,
      microsoft: false,
      'x402-base': false,
      'x402-solana': false,
      support: false,
    },
    externalCheckout: false,
    productionPayments: false,
  };
}
