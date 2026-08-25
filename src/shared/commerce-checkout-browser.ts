export interface CommerceBrowserBootstrapRequest {
  schemaVersion: 1;
  checkoutSessionId: string;
  bindingVerifier: string;
}

export interface CommerceBrowserResumeRequest {
  schemaVersion: 1;
  checkoutSessionId: string;
}

export interface CommerceBrowserPaymentSubmission {
  schemaVersion: 1;
  checkoutSessionId: string;
  submissionId: string;
  paymentPayload: unknown;
}

export interface CommerceBrowserCheckoutView {
  schemaVersion: 1;
  checkoutSessionId: string;
  productId: string;
  avatarRevisionIds: string[];
  currency: 'USDC';
  amountAtomic: string;
  network: string;
  networkName: 'Base Sepolia';
  asset: string;
  recipient: string;
  expiresAt: string;
}

const identifierPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const secretPattern = /^[A-Za-z0-9_-]{43}$/;
const atomicPattern = /^[1-9][0-9]{0,38}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function exactRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid commerce browser ${name}.`);
  }
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((field) => !fields.includes(field))) {
    throw new Error(`Invalid commerce browser ${name}.`);
  }
  return source;
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !identifierPattern.test(value)) {
    throw new Error(`Invalid commerce browser ${field}.`);
  }
  return value;
}

function secret(value: unknown, field: string): string {
  if (typeof value !== 'string' || !secretPattern.test(value)) {
    throw new Error(`Invalid commerce browser ${field}.`);
  }
  return value;
}

export function parseCommerceBrowserBootstrapRequest(
  value: unknown,
): CommerceBrowserBootstrapRequest {
  const source = exactRecord(value, [
    'schemaVersion', 'checkoutSessionId', 'bindingVerifier',
  ], 'bootstrap request');
  if (source.schemaVersion !== 1) throw new Error('Invalid commerce browser bootstrap request.');
  return {
    schemaVersion: 1,
    checkoutSessionId: identifier(source.checkoutSessionId, 'checkout session ID'),
    bindingVerifier: secret(source.bindingVerifier, 'binding verifier'),
  };
}

export function parseCommerceBrowserResumeRequest(value: unknown): CommerceBrowserResumeRequest {
  const source = exactRecord(value, ['schemaVersion', 'checkoutSessionId'], 'resume request');
  if (source.schemaVersion !== 1) throw new Error('Invalid commerce browser resume request.');
  return {
    schemaVersion: 1,
    checkoutSessionId: identifier(source.checkoutSessionId, 'checkout session ID'),
  };
}

export function parseCommerceBrowserPaymentSubmission(
  value: unknown,
): CommerceBrowserPaymentSubmission {
  const source = exactRecord(value, [
    'schemaVersion', 'checkoutSessionId', 'submissionId', 'paymentPayload',
  ], 'payment submission');
  if (source.schemaVersion !== 1 || typeof source.paymentPayload !== 'object'
    || source.paymentPayload === null || Array.isArray(source.paymentPayload)) {
    throw new Error('Invalid commerce browser payment submission.');
  }
  return {
    schemaVersion: 1,
    checkoutSessionId: identifier(source.checkoutSessionId, 'checkout session ID'),
    submissionId: identifier(source.submissionId, 'submission ID'),
    paymentPayload: source.paymentPayload,
  };
}

export function parseCommerceBrowserCheckoutView(value: unknown): CommerceBrowserCheckoutView {
  const source = exactRecord(value, [
    'schemaVersion', 'checkoutSessionId', 'productId', 'avatarRevisionIds', 'currency',
    'amountAtomic', 'network', 'networkName', 'asset', 'recipient', 'expiresAt',
  ], 'checkout view');
  if (source.schemaVersion !== 1 || source.currency !== 'USDC'
    || source.networkName !== 'Base Sepolia'
    || typeof source.amountAtomic !== 'string' || !atomicPattern.test(source.amountAtomic)
    || typeof source.network !== 'string' || source.network.length > 120
    || typeof source.asset !== 'string' || source.asset.length > 160
    || typeof source.recipient !== 'string' || source.recipient.length > 160
    || typeof source.expiresAt !== 'string' || !timestampPattern.test(source.expiresAt)
    || !Number.isFinite(Date.parse(source.expiresAt))
    || !Array.isArray(source.avatarRevisionIds)
    || source.avatarRevisionIds.length === 0 || source.avatarRevisionIds.length > 100) {
    throw new Error('Invalid commerce browser checkout view.');
  }
  const avatarRevisionIds = source.avatarRevisionIds.map((entry) => identifier(
    entry,
    'avatar revision ID',
  ));
  if (new Set(avatarRevisionIds).size !== avatarRevisionIds.length) {
    throw new Error('Invalid commerce browser avatar revisions.');
  }
  return {
    schemaVersion: 1,
    checkoutSessionId: identifier(source.checkoutSessionId, 'checkout session ID'),
    productId: identifier(source.productId, 'product ID'),
    avatarRevisionIds,
    currency: 'USDC',
    amountAtomic: source.amountAtomic,
    network: source.network,
    networkName: 'Base Sepolia',
    asset: source.asset,
    recipient: source.recipient,
    expiresAt: source.expiresAt,
  };
}

export function parseCommerceBrowserSecret(value: unknown, field: string): string {
  return secret(value, field);
}
