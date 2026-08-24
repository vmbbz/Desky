import {
  commerceProviderIds,
  type CommerceProviderId,
} from './commerce';

export const paymentSettlementStatuses = [
  'unknown',
  'pending',
  'settled',
  'failed',
] as const;
export type PaymentSettlementStatus = (typeof paymentSettlementStatuses)[number];

export const settlementObservationSources = [
  'facilitator-response',
  'facilitator-reconciliation',
  'chain-reconciliation',
] as const;
export type SettlementObservationSource = (typeof settlementObservationSources)[number];

export interface PaymentAuthorizationEvidence {
  schemaVersion: 1;
  authorizationId: string;
  attemptId: string;
  orderId: string;
  quoteId: string;
  provider: Exclude<CommerceProviderId, 'free' | 'support'>;
  payer: string;
  paymentIdentifier: string;
  network: string;
  asset: string;
  recipient: string;
  amountAtomic: string;
  verifiedAt: string;
  authorizationExpiresAt: string;
}

export interface PaymentSettlementObservation {
  schemaVersion: 1;
  observationId: string;
  authorizationId: string;
  attemptId: string;
  orderId: string;
  quoteId: string;
  provider: Exclude<CommerceProviderId, 'free' | 'support'>;
  status: PaymentSettlementStatus;
  source: SettlementObservationSource;
  payer: string;
  paymentIdentifier: string;
  network: string;
  asset: string;
  recipient: string;
  amountAtomic: string;
  providerReference?: string;
  observedAt: string;
  settledAt?: string;
  reasonCode: string;
  reconciliationId: string;
}

const identifierPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const atomicAmountPattern = /^[1-9][0-9]{0,38}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function exactRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid commerce ${name}.`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((field) => !fields.includes(field))) {
    throw new Error(`Invalid commerce ${name}.`);
  }
  return record;
}

function readString(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
    || value.trim() !== value) {
    throw new Error(`Invalid commerce ${field}.`);
  }
  return value;
}

function readIdentifier(value: unknown, field: string): string {
  const identifier = readString(value, field, 128);
  if (!identifierPattern.test(identifier)) throw new Error(`Invalid commerce ${field}.`);
  return identifier;
}

function readTimestamp(value: unknown, field: string): string {
  const timestamp = readString(value, field, 30);
  if (!timestampPattern.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`Invalid commerce ${field}.`);
  }
  return timestamp;
}

function readAtomicAmount(value: unknown): string {
  const amount = readString(value, 'settlement atomic amount', 39);
  if (!atomicAmountPattern.test(amount)) throw new Error('Invalid commerce settlement atomic amount.');
  return amount;
}

function readProvider(value: unknown): Exclude<CommerceProviderId, 'free' | 'support'> {
  if (typeof value !== 'string' || !commerceProviderIds.includes(value as CommerceProviderId)
    || value === 'free' || value === 'support') {
    throw new Error('Invalid commerce settlement provider.');
  }
  return value as Exclude<CommerceProviderId, 'free' | 'support'>;
}

export function parsePaymentAuthorizationEvidence(value: unknown): PaymentAuthorizationEvidence {
  const source = exactRecord(value, [
    'schemaVersion', 'authorizationId', 'attemptId', 'orderId', 'quoteId', 'provider',
    'payer', 'paymentIdentifier', 'network', 'asset', 'recipient', 'amountAtomic',
    'verifiedAt', 'authorizationExpiresAt',
  ], 'payment authorization evidence');
  if (source.schemaVersion !== 1) throw new Error('Invalid commerce payment authorization evidence.');
  const evidence: PaymentAuthorizationEvidence = {
    schemaVersion: 1,
    authorizationId: readIdentifier(source.authorizationId, 'authorization ID'),
    attemptId: readIdentifier(source.attemptId, 'payment attempt ID'),
    orderId: readIdentifier(source.orderId, 'order ID'),
    quoteId: readIdentifier(source.quoteId, 'quote ID'),
    provider: readProvider(source.provider),
    payer: readString(source.payer, 'authorization payer', 160),
    paymentIdentifier: readString(source.paymentIdentifier, 'payment identifier', 256),
    network: readString(source.network, 'authorization network', 120),
    asset: readString(source.asset, 'authorization asset', 160),
    recipient: readString(source.recipient, 'authorization recipient', 160),
    amountAtomic: readAtomicAmount(source.amountAtomic),
    verifiedAt: readTimestamp(source.verifiedAt, 'authorization verification time'),
    authorizationExpiresAt: readTimestamp(
      source.authorizationExpiresAt,
      'authorization expiry',
    ),
  };
  if (Date.parse(evidence.authorizationExpiresAt) <= Date.parse(evidence.verifiedAt)) {
    throw new Error('Commerce payment authorization expires before verification.');
  }
  return evidence;
}

export function parsePaymentSettlementObservation(value: unknown): PaymentSettlementObservation {
  const source = exactRecord(value, [
    'schemaVersion', 'observationId', 'authorizationId', 'attemptId', 'orderId', 'quoteId',
    'provider', 'status', 'source', 'payer', 'paymentIdentifier', 'network', 'asset',
    'recipient', 'amountAtomic', 'providerReference', 'observedAt', 'settledAt', 'reasonCode',
    'reconciliationId',
  ], 'payment settlement observation');
  if (source.schemaVersion !== 1
    || typeof source.status !== 'string'
    || !paymentSettlementStatuses.includes(source.status as PaymentSettlementStatus)
    || typeof source.source !== 'string'
    || !settlementObservationSources.includes(source.source as SettlementObservationSource)) {
    throw new Error('Invalid commerce payment settlement observation.');
  }
  const providerReference = source.providerReference === undefined
    ? undefined : readString(source.providerReference, 'settlement provider reference', 256);
  const observation: PaymentSettlementObservation = {
    schemaVersion: 1,
    observationId: readIdentifier(source.observationId, 'settlement observation ID'),
    authorizationId: readIdentifier(source.authorizationId, 'authorization ID'),
    attemptId: readIdentifier(source.attemptId, 'payment attempt ID'),
    orderId: readIdentifier(source.orderId, 'order ID'),
    quoteId: readIdentifier(source.quoteId, 'quote ID'),
    provider: readProvider(source.provider),
    status: source.status as PaymentSettlementStatus,
    source: source.source as SettlementObservationSource,
    payer: readString(source.payer, 'settlement payer', 160),
    paymentIdentifier: readString(source.paymentIdentifier, 'payment identifier', 256),
    network: readString(source.network, 'settlement network', 120),
    asset: readString(source.asset, 'settlement asset', 160),
    recipient: readString(source.recipient, 'settlement recipient', 160),
    amountAtomic: readAtomicAmount(source.amountAtomic),
    providerReference,
    observedAt: readTimestamp(source.observedAt, 'settlement observation time'),
    settledAt: source.settledAt === undefined
      ? undefined : readTimestamp(source.settledAt, 'settlement time'),
    reasonCode: readIdentifier(source.reasonCode, 'settlement reason code'),
    reconciliationId: readIdentifier(source.reconciliationId, 'settlement reconciliation ID'),
  };
  if ((observation.status === 'pending' || observation.status === 'settled')
    && !observation.providerReference) {
    throw new Error('Pending or settled payment requires a provider reference.');
  }
  if (observation.status === 'unknown' && observation.providerReference) {
    throw new Error('Unknown settlement cannot claim a provider reference.');
  }
  if ((observation.status === 'settled') !== (observation.settledAt !== undefined)
    || (observation.settledAt
      && Date.parse(observation.settledAt) > Date.parse(observation.observedAt))) {
    throw new Error('Settled payment requires a valid settlement time.');
  }
  return observation;
}

export function settlementStatusCanAdvance(
  current: PaymentSettlementStatus | undefined,
  next: PaymentSettlementStatus,
): boolean {
  if (current === undefined) return true;
  if (current === next) return current === 'unknown' || current === 'pending';
  if (current === 'unknown') return ['pending', 'settled', 'failed'].includes(next);
  if (current === 'pending') return next === 'settled' || next === 'failed';
  return false;
}
