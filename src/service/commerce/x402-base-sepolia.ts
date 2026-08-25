import { parseVerifiedCommerceQuote, type VerifiedCommerceQuote } from '../../shared/commerce';

export const x402ProtocolVersion = 2 as const;
export const baseSepoliaNetwork = 'eip155:84532' as const;
export const baseSepoliaUsdc = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
export const x402ExactScheme = 'exact' as const;

export interface X402PaymentRequirements {
  scheme: 'exact';
  network: 'eip155:84532';
  asset: typeof baseSepoliaUsdc;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: {
    assetTransferMethod: 'eip3009';
    name: 'USDC';
    version: '2';
  };
}

export interface X402ResourceInfo {
  url: string;
  description: string;
  mimeType: 'application/json';
}

export interface X402BasePaymentPayload {
  x402Version: 2;
  resource: X402ResourceInfo;
  accepted: X402PaymentRequirements;
  payload: {
    signature: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
  };
}

export interface X402VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  invalidMessage?: string;
  payer?: string;
}

export interface X402SettleResponse {
  success: boolean;
  errorReason?: string;
  errorMessage?: string;
  payer?: string;
  transaction: string;
  network: 'eip155:84532';
  amount?: string;
}

export interface X402SupportedResponse {
  kinds: Array<{
    x402Version: number;
    scheme: string;
    network: string;
  }>;
  extensions: string[];
  signers: Record<string, string[]>;
}

export interface BaseSepoliaX402Policy {
  merchantRecipient: string;
  resourceOrigin: string;
  facilitatorBaseUrl: string;
  maximumQuoteLifetimeSeconds?: number;
}

const atomicPattern = /^[1-9][0-9]{0,38}$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const signaturePattern = /^0x[0-9a-fA-F]{130}$/;
const noncePattern = /^0x[0-9a-fA-F]{64}$/;
const transactionPattern = /^0x[0-9a-fA-F]{64}$/;
const numericStringPattern = /^(0|[1-9][0-9]{0,19})$/;

function exactRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid Base Sepolia x402 ${name}.`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((field) => !fields.includes(field))) {
    throw new Error(`Invalid Base Sepolia x402 ${name}.`);
  }
  return record;
}

function readString(value: unknown, field: string, maximum = 256): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
    || value.trim() !== value) {
    throw new Error(`Invalid Base Sepolia x402 ${field}.`);
  }
  return value;
}

function readAddress(value: unknown, field: string): string {
  const address = readString(value, field, 42);
  if (!addressPattern.test(address)) throw new Error(`Invalid Base Sepolia x402 ${field}.`);
  return address;
}

function readAtomic(value: unknown, field: string): string {
  const amount = readString(value, field, 39);
  if (!atomicPattern.test(amount)) throw new Error(`Invalid Base Sepolia x402 ${field}.`);
  return amount;
}

function readOrigin(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid Base Sepolia x402 ${field}.`);
  }
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) {
    throw new Error(`Invalid Base Sepolia x402 ${field}.`);
  }
  return value;
}

function readHttpsBaseUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid Base Sepolia x402 ${field}.`);
  }
  const canonical = url.pathname === '/' ? url.origin : url.toString();
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || value.endsWith('/') || canonical !== value) {
    throw new Error(`Invalid Base Sepolia x402 ${field}.`);
  }
  return value;
}

function compareAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function parseX402PaymentRequirements(value: unknown): X402PaymentRequirements {
  const source = exactRecord(value, [
    'scheme', 'network', 'asset', 'amount', 'payTo', 'maxTimeoutSeconds', 'extra',
  ], 'payment requirements');
  const extra = exactRecord(source.extra, [
    'assetTransferMethod', 'name', 'version',
  ], 'payment requirement extra');
  const asset = readAddress(source.asset, 'asset');
  if (source.scheme !== x402ExactScheme
    || source.network !== baseSepoliaNetwork
    || !compareAddress(asset, baseSepoliaUsdc)
    || typeof source.maxTimeoutSeconds !== 'number'
    || !Number.isSafeInteger(source.maxTimeoutSeconds)
    || source.maxTimeoutSeconds < 10
    || source.maxTimeoutSeconds > 300
    || extra.assetTransferMethod !== 'eip3009'
    || extra.name !== 'USDC'
    || extra.version !== '2') {
    throw new Error('Base Sepolia x402 payment requirements are not admitted.');
  }
  return {
    scheme: 'exact',
    network: baseSepoliaNetwork,
    asset: baseSepoliaUsdc,
    amount: readAtomic(source.amount, 'amount'),
    payTo: readAddress(source.payTo, 'recipient'),
    maxTimeoutSeconds: source.maxTimeoutSeconds,
    extra: { assetTransferMethod: 'eip3009', name: 'USDC', version: '2' },
  };
}

export function createBaseSepoliaPaymentRequirements(
  quote: VerifiedCommerceQuote,
  policy: BaseSepoliaX402Policy,
  nowSeconds: number,
): X402PaymentRequirements {
  const admittedQuote = parseVerifiedCommerceQuote(quote);
  readOrigin(policy.resourceOrigin, 'resource origin');
  readHttpsBaseUrl(policy.facilitatorBaseUrl, 'facilitator base URL');
  const merchantRecipient = readAddress(policy.merchantRecipient, 'merchant recipient');
  const maximumQuoteLifetimeSeconds = policy.maximumQuoteLifetimeSeconds ?? 300;
  const issuedAt = Math.floor(Date.parse(quote.issuedAt) / 1_000);
  const expiresAt = Math.floor(Date.parse(quote.expiresAt) / 1_000);
  if (!Number.isSafeInteger(nowSeconds)
    || !Number.isSafeInteger(maximumQuoteLifetimeSeconds)
    || maximumQuoteLifetimeSeconds < 30
    || maximumQuoteLifetimeSeconds > 900
    || nowSeconds < 0
    || admittedQuote.provider !== 'x402-base'
    || admittedQuote.releaseProfile !== 'windows-direct'
    || admittedQuote.currency !== 'USDC'
    || admittedQuote.network !== baseSepoliaNetwork
    || !admittedQuote.asset || !compareAddress(admittedQuote.asset, baseSepoliaUsdc)
    || !admittedQuote.recipient || !compareAddress(admittedQuote.recipient, merchantRecipient)
    || issuedAt > nowSeconds
    || expiresAt <= nowSeconds
    || expiresAt - issuedAt > maximumQuoteLifetimeSeconds) {
    throw new Error('Commerce quote is not admitted for the Base Sepolia pilot.');
  }
  return parseX402PaymentRequirements({
    scheme: 'exact',
    network: baseSepoliaNetwork,
    asset: baseSepoliaUsdc,
    amount: admittedQuote.amountAtomic,
    payTo: merchantRecipient,
    maxTimeoutSeconds: Math.max(10, Math.min(60, expiresAt - nowSeconds)),
    extra: { assetTransferMethod: 'eip3009', name: 'USDC', version: '2' },
  });
}

export function createBaseSepoliaResource(
  quoteId: string,
  policy: BaseSepoliaX402Policy,
): X402ResourceInfo {
  const origin = readOrigin(policy.resourceOrigin, 'resource origin');
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(quoteId)) {
    throw new Error('Invalid Base Sepolia x402 quote ID.');
  }
  return {
    url: `${origin}/v1/x402/quotes/${encodeURIComponent(quoteId)}`,
    description: 'Desky avatar entitlement',
    mimeType: 'application/json',
  };
}

function parseResource(value: unknown, expected: X402ResourceInfo): X402ResourceInfo {
  const source = exactRecord(value, ['url', 'description', 'mimeType'], 'resource');
  if (source.url !== expected.url || source.description !== expected.description
    || source.mimeType !== expected.mimeType) {
    throw new Error('Base Sepolia x402 resource does not match the quote.');
  }
  return structuredClone(expected);
}

function sameRequirements(left: X402PaymentRequirements, right: X402PaymentRequirements): boolean {
  return left.scheme === right.scheme
    && left.network === right.network
    && compareAddress(left.asset, right.asset)
    && left.amount === right.amount
    && compareAddress(left.payTo, right.payTo)
    && left.maxTimeoutSeconds === right.maxTimeoutSeconds
    && JSON.stringify(left.extra) === JSON.stringify(right.extra);
}

export function parseBaseSepoliaPaymentPayload(
  value: unknown,
  expectedRequirements: X402PaymentRequirements,
  expectedResource: X402ResourceInfo,
  nowSeconds: number,
  quoteExpiresAtSeconds: number,
): X402BasePaymentPayload {
  const source = exactRecord(value, [
    'x402Version', 'resource', 'accepted', 'payload',
  ], 'payment payload');
  const accepted = parseX402PaymentRequirements(source.accepted);
  const payload = exactRecord(source.payload, ['signature', 'authorization'], 'EIP-3009 payload');
  const authorization = exactRecord(payload.authorization, [
    'from', 'to', 'value', 'validAfter', 'validBefore', 'nonce',
  ], 'EIP-3009 authorization');
  const signature = readString(payload.signature, 'signature', 132);
  const from = readAddress(authorization.from, 'payer');
  const to = readAddress(authorization.to, 'authorization recipient');
  const valueAtomic = readAtomic(authorization.value, 'authorization amount');
  const validAfter = readString(authorization.validAfter, 'authorization valid-after', 20);
  const validBefore = readString(authorization.validBefore, 'authorization valid-before', 20);
  const nonce = readString(authorization.nonce, 'authorization nonce', 66);
  if (source.x402Version !== 2
    || !sameRequirements(accepted, expectedRequirements)
    || !signaturePattern.test(signature)
    || !noncePattern.test(nonce)
    || !numericStringPattern.test(validAfter)
    || !numericStringPattern.test(validBefore)
    || !compareAddress(to, expectedRequirements.payTo)
    || valueAtomic !== expectedRequirements.amount) {
    throw new Error('Base Sepolia x402 payment authorization does not match the quote.');
  }
  const validAfterNumber = Number(validAfter);
  const validBeforeNumber = Number(validBefore);
  if (!Number.isSafeInteger(nowSeconds) || !Number.isSafeInteger(quoteExpiresAtSeconds)
    || !Number.isSafeInteger(validAfterNumber) || !Number.isSafeInteger(validBeforeNumber)
    || validAfterNumber > nowSeconds + 120
    || validBeforeNumber <= nowSeconds
    || validBeforeNumber <= validAfterNumber
    || validBeforeNumber > quoteExpiresAtSeconds) {
    throw new Error('Base Sepolia x402 payment authorization lifetime is invalid.');
  }
  return {
    x402Version: 2,
    resource: parseResource(source.resource, expectedResource),
    accepted,
    payload: {
      signature,
      authorization: { from, to, value: valueAtomic, validAfter, validBefore, nonce },
    },
  };
}

function readOptionalBoundedString(value: unknown, field: string): string | undefined {
  return value === undefined || value === null ? undefined : readString(value, field, 256);
}

export function parseX402VerifyResponse(value: unknown): X402VerifyResponse {
  const source = exactRecord(value, [
    'isValid', 'invalidReason', 'invalidMessage', 'payer', 'extensions', 'extra',
  ], 'verify response');
  if (typeof source.isValid !== 'boolean') throw new Error('Invalid Base Sepolia x402 verify response.');
  const payer = source.payer === undefined || source.payer === null
    ? undefined : readAddress(source.payer, 'verify payer');
  const response = {
    isValid: source.isValid,
    invalidReason: readOptionalBoundedString(source.invalidReason, 'invalid reason'),
    invalidMessage: readOptionalBoundedString(source.invalidMessage, 'invalid message'),
    payer,
  };
  if (response.isValid && (!response.payer || response.invalidReason || response.invalidMessage)) {
    throw new Error('Contradictory Base Sepolia x402 verify response.');
  }
  return response;
}

export function parseX402SettleResponse(value: unknown): X402SettleResponse {
  const source = exactRecord(value, [
    'success', 'errorReason', 'errorMessage', 'payer', 'transaction', 'network', 'amount',
    'extensions', 'extra',
  ], 'settle response');
  if (typeof source.success !== 'boolean' || source.network !== baseSepoliaNetwork
    || typeof source.transaction !== 'string') {
    throw new Error('Invalid Base Sepolia x402 settle response.');
  }
  const payer = source.payer === undefined || source.payer === null
    ? undefined : readAddress(source.payer, 'settlement payer');
  const transaction = source.transaction.toLowerCase();
  const amount = source.amount === undefined || source.amount === null
    ? undefined : readAtomic(source.amount, 'settled amount');
  const response: X402SettleResponse = {
    success: source.success,
    errorReason: readOptionalBoundedString(source.errorReason, 'settlement error reason'),
    errorMessage: readOptionalBoundedString(source.errorMessage, 'settlement error message'),
    payer,
    transaction,
    network: baseSepoliaNetwork,
    amount,
  };
  if (response.success
    && (!payer || !transactionPattern.test(transaction) || response.errorReason || response.errorMessage)) {
    throw new Error('Contradictory Base Sepolia x402 settle response.');
  }
  if (!response.success && transaction !== '' && !transactionPattern.test(transaction)) {
    throw new Error('Invalid Base Sepolia x402 settlement transaction.');
  }
  return response;
}

export function parseX402SupportedResponse(value: unknown): X402SupportedResponse {
  const source = exactRecord(value, ['kinds', 'extensions', 'signers'], 'supported response');
  if (!Array.isArray(source.kinds) || source.kinds.length > 100
    || !Array.isArray(source.extensions) || source.extensions.length > 100
    || typeof source.signers !== 'object' || source.signers === null || Array.isArray(source.signers)) {
    throw new Error('Invalid Base Sepolia x402 supported response.');
  }
  const kinds = source.kinds.map((entry) => {
    const kind = exactRecord(entry, ['x402Version', 'scheme', 'network', 'extra'], 'supported kind');
    if (typeof kind.x402Version !== 'number' || !Number.isSafeInteger(kind.x402Version)) {
      throw new Error('Invalid Base Sepolia x402 supported kind.');
    }
    return {
      x402Version: kind.x402Version,
      scheme: readString(kind.scheme, 'supported scheme', 40),
      network: readString(kind.network, 'supported network', 120),
    };
  });
  const extensions = source.extensions.map((entry) => readString(entry, 'extension', 128));
  const signers = Object.fromEntries(Object.entries(source.signers as Record<string, unknown>)
    .map(([family, entries]) => {
      if (family.length === 0 || family.length > 120 || !Array.isArray(entries) || entries.length > 100) {
        throw new Error('Invalid Base Sepolia x402 signers.');
      }
      return [family, entries.map((entry) => readString(entry, 'signer', 160))];
    }));
  return { kinds, extensions, signers };
}

export function assertBaseSepoliaFacilitatorSupport(value: unknown): X402SupportedResponse {
  const response = parseX402SupportedResponse(value);
  if (!response.kinds.some((kind) => kind.x402Version === 2
    && kind.scheme === x402ExactScheme
    && kind.network === baseSepoliaNetwork)) {
    throw new Error('Facilitator does not advertise admitted Base Sepolia x402 v2 exact support.');
  }
  return response;
}

export type X402Fetch = (input: string, init: RequestInit) => Promise<Response>;

export class X402FacilitatorTimeoutError extends Error {
  readonly indeterminate: boolean;

  constructor(operation: 'verify' | 'settle' | 'supported') {
    super(`Base Sepolia x402 facilitator ${operation} timed out.`);
    this.name = 'X402FacilitatorTimeoutError';
    this.indeterminate = operation === 'settle';
  }
}

export class StrictX402FacilitatorClient {
  readonly baseUrl: string;
  private readonly fetchImpl: X402Fetch;
  private readonly timeoutMilliseconds: number;
  private readonly authorization?: string;

  constructor(options: {
    baseUrl: string;
    fetchImpl?: X402Fetch;
    timeoutMilliseconds?: number;
    authorization?: string;
  }) {
    this.baseUrl = readHttpsBaseUrl(options.baseUrl, 'facilitator base URL');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMilliseconds = options.timeoutMilliseconds ?? 15_000;
    if (!Number.isSafeInteger(this.timeoutMilliseconds)
      || this.timeoutMilliseconds < 1_000 || this.timeoutMilliseconds > 60_000
      || (options.authorization !== undefined
        && (options.authorization.length < 16 || options.authorization.length > 4_096
          || /[\r\n]/.test(options.authorization)))) {
      throw new Error('Invalid Base Sepolia x402 facilitator configuration.');
    }
    this.authorization = options.authorization;
  }

  async getSupported(): Promise<X402SupportedResponse> {
    return assertBaseSepoliaFacilitatorSupport(await this.request('supported'));
  }

  async verify(
    paymentPayload: X402BasePaymentPayload,
    paymentRequirements: X402PaymentRequirements,
  ): Promise<X402VerifyResponse> {
    const response = parseX402VerifyResponse(await this.request('verify', {
      x402Version: 2, paymentPayload, paymentRequirements,
    }));
    if (response.isValid && response.payer
      && !compareAddress(response.payer, paymentPayload.payload.authorization.from)) {
      throw new Error('Base Sepolia x402 verify payer does not match the authorization.');
    }
    return response;
  }

  async settle(
    paymentPayload: X402BasePaymentPayload,
    paymentRequirements: X402PaymentRequirements,
  ): Promise<X402SettleResponse> {
    const response = parseX402SettleResponse(await this.request('settle', {
      x402Version: 2, paymentPayload, paymentRequirements,
    }));
    if (response.success && response.payer
      && (!compareAddress(response.payer, paymentPayload.payload.authorization.from)
        || (response.amount !== undefined && response.amount !== paymentRequirements.amount))) {
      throw new Error('Base Sepolia x402 settlement does not match the authorization.');
    }
    return response;
  }

  private async request(
    operation: 'verify' | 'settle' | 'supported',
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMilliseconds);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/${operation}`, {
        method: body ? 'POST' : 'GET',
        redirect: 'manual',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(this.authorization ? { Authorization: this.authorization } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        throw new Error(`Base Sepolia x402 facilitator ${operation} redirected.`);
      }
      if (response.status !== 200) {
        throw new Error(`Base Sepolia x402 facilitator ${operation} failed (${response.status}).`);
      }
      const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
      if (contentType !== 'application/json') {
        throw new Error(`Base Sepolia x402 facilitator ${operation} returned the wrong media type.`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error(`Base Sepolia x402 facilitator ${operation} returned no body.`);
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > 128 * 1_024) {
          await reader.cancel();
          throw new Error(`Base Sepolia x402 facilitator ${operation} response is too large.`);
        }
        chunks.push(part.value);
      }
      const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
      try {
        return JSON.parse(bytes.toString('utf8')) as unknown;
      } catch {
        throw new Error(`Base Sepolia x402 facilitator ${operation} returned invalid JSON.`);
      }
    } catch (error) {
      if (controller.signal.aborted) throw new X402FacilitatorTimeoutError(operation);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
