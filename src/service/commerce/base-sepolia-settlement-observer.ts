import { createHash } from 'node:crypto';

import {
  parsePaymentAuthorizationEvidence,
  type PaymentAuthorizationEvidence,
  type PaymentSettlementObservation,
} from '../../shared/commerce-settlement';
import { baseSepoliaNetwork, baseSepoliaUsdc } from './x402-base-sepolia';
import type { PostgresCheckoutLedger } from './postgres-checkout-ledger';
import { HostedPaidGrantService } from './paid-grant-service';

const authorizationUsedTopic = '0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5';
const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const transactionPattern = /^0x[0-9a-f]{64}$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const noncePattern = /^0x[0-9a-fA-F]{64}$/;

interface RpcLog {
  address: string;
  blockNumber: string;
  transactionHash: string;
  topics: string[];
  data: string;
}

interface RpcBlock { number: string; timestamp: string }
interface RpcReceipt { status: string; transactionHash: string; blockNumber: string; logs: RpcLog[] }

export interface BaseSepoliaRpc {
  request(method: string, parameters: unknown[]): Promise<unknown>;
}

function exactHttpsEndpoint(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) {
    throw new Error('Invalid Base Sepolia observer endpoint.');
  }
  return value;
}

/** Strict bounded JSON-RPC transport. The public Base endpoint is acceptable only for testnet. */
export class StrictBaseSepoliaRpcClient implements BaseSepoliaRpc {
  private sequence = 0;
  private readonly endpoint: string;

  constructor(endpoint: string, private readonly timeoutMilliseconds = 10_000) {
    this.endpoint = exactHttpsEndpoint(endpoint);
    if (!Number.isSafeInteger(timeoutMilliseconds)
      || timeoutMilliseconds < 1_000 || timeoutMilliseconds > 30_000) {
      throw new Error('Invalid Base Sepolia observer timeout.');
    }
  }

  async request(method: string, parameters: unknown[]): Promise<unknown> {
    if (!/^(eth_blockNumber|eth_getBlockByNumber|eth_getLogs|eth_getTransactionReceipt)$/.test(method)) {
      throw new Error('Base Sepolia observer method is not admitted.');
    }
    const response = await fetch(this.endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.timeoutMilliseconds),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.sequence, method, params: parameters }),
    });
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      throw new Error('Base Sepolia observer RPC is unavailable.');
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > 2 * 1_024 * 1_024) {
      throw new Error('Base Sepolia observer RPC response is too large.');
    }
    const envelope = JSON.parse(text) as { jsonrpc?: unknown; result?: unknown; error?: unknown };
    if (envelope.jsonrpc !== '2.0' || envelope.error !== undefined || !('result' in envelope)) {
      throw new Error('Base Sepolia observer RPC returned an error.');
    }
    return envelope.result;
  }
}

function quantity(value: unknown, field: string): number {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) {
    throw new Error(`Invalid Base Sepolia observer ${field}.`);
  }
  const parsed = Number(BigInt(value));
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid Base Sepolia observer ${field}.`);
  }
  return parsed;
}

function topicAddress(value: string): string {
  if (!addressPattern.test(value)) throw new Error('Invalid Base Sepolia observer address.');
  return `0x${value.slice(2).toLowerCase().padStart(64, '0')}`;
}

function log(value: unknown): RpcLog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Base Sepolia observer log.');
  }
  const source = value as Record<string, unknown>;
  if (typeof source.address !== 'string' || !addressPattern.test(source.address)
    || typeof source.blockNumber !== 'string'
    || typeof source.transactionHash !== 'string'
    || !transactionPattern.test(source.transactionHash.toLowerCase())
    || !Array.isArray(source.topics) || source.topics.some((topic) => typeof topic !== 'string')
    || typeof source.data !== 'string' || !/^0x[0-9a-f]*$/i.test(source.data)) {
    throw new Error('Invalid Base Sepolia observer log.');
  }
  quantity(source.blockNumber, 'log block');
  return {
    address: source.address.toLowerCase(), blockNumber: source.blockNumber,
    transactionHash: source.transactionHash.toLowerCase(),
    topics: (source.topics as string[]).map((topic) => topic.toLowerCase()),
    data: source.data.toLowerCase(),
  };
}

function block(value: unknown): RpcBlock {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Base Sepolia observer block.');
  }
  const source = value as Record<string, unknown>;
  quantity(source.number, 'block number');
  quantity(source.timestamp, 'block timestamp');
  return { number: String(source.number), timestamp: String(source.timestamp) };
}

function receipt(value: unknown): RpcReceipt | undefined {
  if (value === null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Base Sepolia observer receipt.');
  }
  const source = value as Record<string, unknown>;
  if (source.status !== '0x1' || typeof source.transactionHash !== 'string'
    || !transactionPattern.test(source.transactionHash.toLowerCase())
    || typeof source.blockNumber !== 'string' || !Array.isArray(source.logs)) {
    throw new Error('Base Sepolia settlement receipt is not successful.');
  }
  quantity(source.blockNumber, 'receipt block');
  return {
    status: '0x1', transactionHash: source.transactionHash.toLowerCase(),
    blockNumber: source.blockNumber, logs: source.logs.map(log),
  };
}

export interface ChainSettlementResult {
  status: 'pending' | 'settled';
  transactionHash: string;
  observedAt: string;
  settledAt?: string;
  confirmations: number;
}

/** Finds EIP-3009 AuthorizationUsed and independently validates the exact USDC Transfer receipt. */
export class BaseSepoliaSettlementObserver {
  constructor(
    private readonly rpc: BaseSepoliaRpc,
    private readonly minimumConfirmations = 3,
    private readonly logRange = 2_000,
  ) {
    if (!Number.isSafeInteger(minimumConfirmations) || minimumConfirmations < 1
      || minimumConfirmations > 100 || !Number.isSafeInteger(logRange)
      || logRange < 100 || logRange > 10_000) {
      throw new Error('Invalid Base Sepolia settlement observer policy.');
    }
  }

  async healthCheck(): Promise<{ network: typeof baseSepoliaNetwork; headBlock: number }> {
    return {
      network: baseSepoliaNetwork,
      headBlock: quantity(await this.rpc.request('eth_blockNumber', []), 'head block'),
    };
  }

  async observe(value: PaymentAuthorizationEvidence, now: string): Promise<ChainSettlementResult | undefined> {
    const authorization = parsePaymentAuthorizationEvidence(value);
    if (authorization.network !== baseSepoliaNetwork
      || authorization.asset.toLowerCase() !== baseSepoliaUsdc.toLowerCase()
      || !addressPattern.test(authorization.payer)
      || !addressPattern.test(authorization.recipient)
      || !noncePattern.test(authorization.paymentIdentifier)) {
      throw new Error('Payment authorization is not admitted by the Base Sepolia observer.');
    }
    if (new Date(Date.parse(now)).toISOString() !== now) {
      throw new Error('Invalid Base Sepolia observer time.');
    }
    const latest = quantity(await this.rpc.request('eth_blockNumber', []), 'head block');
    const verifiedSeconds = Math.floor(Date.parse(authorization.verifiedAt) / 1_000);
    const first = Math.max(0, (await this.firstBlockAtOrAfter(verifiedSeconds, latest)) - 8);
    const payerTopic = topicAddress(authorization.payer);
    const nonceTopic = authorization.paymentIdentifier.toLowerCase();
    const matches: RpcLog[] = [];
    for (let from = first; from <= latest; from += this.logRange) {
      const to = Math.min(latest, from + this.logRange - 1);
      const result = await this.rpc.request('eth_getLogs', [{
        address: baseSepoliaUsdc,
        fromBlock: `0x${from.toString(16)}`,
        toBlock: `0x${to.toString(16)}`,
        topics: [authorizationUsedTopic, payerTopic, nonceTopic],
      }]);
      if (!Array.isArray(result)) throw new Error('Invalid Base Sepolia observer log response.');
      matches.push(...result.map(log));
      if (matches.length > 1) throw new Error('Base Sepolia authorization appeared more than once.');
    }
    if (matches.length === 0) return undefined;
    const used = matches[0];
    const observedReceipt = receipt(await this.rpc.request(
      'eth_getTransactionReceipt', [used.transactionHash],
    ));
    if (!observedReceipt || observedReceipt.transactionHash !== used.transactionHash
      || quantity(observedReceipt.blockNumber, 'receipt block') !== quantity(used.blockNumber, 'log block')) {
      throw new Error('Base Sepolia authorization receipt is unavailable or inconsistent.');
    }
    const exactTransfer = observedReceipt.logs.filter((entry) => entry.address === baseSepoliaUsdc.toLowerCase()
      && entry.topics[0] === transferTopic
      && entry.topics[1] === payerTopic
      && entry.topics[2] === topicAddress(authorization.recipient)
      && BigInt(entry.data) === BigInt(authorization.amountAtomic));
    if (exactTransfer.length !== 1) {
      throw new Error('Base Sepolia settlement receipt does not contain one exact USDC transfer.');
    }
    const settlementBlock = quantity(observedReceipt.blockNumber, 'settlement block');
    const confirmations = latest - settlementBlock + 1;
    if (confirmations < 1) throw new Error('Base Sepolia settlement is ahead of the observed chain head.');
    if (confirmations < this.minimumConfirmations) {
      return { status: 'pending', transactionHash: used.transactionHash, observedAt: now, confirmations };
    }
    const mined = block(await this.rpc.request('eth_getBlockByNumber', [observedReceipt.blockNumber, false]));
    return {
      status: 'settled', transactionHash: used.transactionHash, observedAt: now,
      settledAt: new Date(quantity(mined.timestamp, 'settlement timestamp') * 1_000).toISOString(),
      confirmations,
    };
  }

  private async firstBlockAtOrAfter(timestamp: number, latest: number): Promise<number> {
    let low = 0;
    let high = latest;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = block(await this.rpc.request('eth_getBlockByNumber', [`0x${middle.toString(16)}`, false]));
      if (quantity(candidate.timestamp, 'block timestamp') < timestamp) low = middle + 1;
      else high = middle;
    }
    return low;
  }
}

export interface ReconciliationCandidate {
  authorization: PaymentAuthorizationEvidence;
  latestObservation: PaymentSettlementObservation;
}

export function createBaseSepoliaReconciliationObservation(
  candidate: ReconciliationCandidate,
  result: ChainSettlementResult,
): PaymentSettlementObservation {
  const effectiveObservedAt = result.status === 'settled' ? result.settledAt : result.observedAt;
  if (!effectiveObservedAt) throw new Error('Settled chain observation is missing its mined time.');
  const digest = createHash('sha256').update(
    `${candidate.authorization.authorizationId}:${result.transactionHash}:${result.status}:${
      result.status === 'pending' ? effectiveObservedAt : ''}`,
  ).digest('hex').slice(0, 32);
  return {
    schemaVersion: 1,
    observationId: `observation:chain:${digest}`,
    authorizationId: candidate.authorization.authorizationId,
    attemptId: candidate.authorization.attemptId,
    orderId: candidate.authorization.orderId,
    quoteId: candidate.authorization.quoteId,
    provider: candidate.authorization.provider,
    status: result.status,
    source: 'chain-reconciliation',
    payer: candidate.authorization.payer,
    paymentIdentifier: candidate.authorization.paymentIdentifier,
    network: candidate.authorization.network,
    asset: candidate.authorization.asset,
    recipient: candidate.authorization.recipient,
    amountAtomic: candidate.authorization.amountAtomic,
    providerReference: result.transactionHash,
    observedAt: effectiveObservedAt,
    settledAt: result.settledAt,
    reasonCode: result.status === 'settled' ? 'chain-confirmed' : 'chain-confirming',
    reconciliationId: `reconcile:chain:${digest}`,
  };
}

export interface ChainReconciliationSummary {
  inspected: number;
  unresolved: number;
  pending: number;
  settled: number;
  granted: number;
  errors: number;
}

/** Bounded worker: observe, append monotonic evidence, then atomically grant settled products. */
export class BaseSepoliaReconciliationWorker {
  private readonly grants: HostedPaidGrantService;

  constructor(
    private readonly ledger: PostgresCheckoutLedger,
    private readonly observer: BaseSepoliaSettlementObserver,
  ) {
    this.grants = new HostedPaidGrantService(ledger);
  }

  async healthCheck(): Promise<{ network: typeof baseSepoliaNetwork; headBlock: number }> {
    return this.observer.healthCheck();
  }

  async run(now: string): Promise<ChainReconciliationSummary> {
    const candidates = await this.ledger.listReconciliationCandidates(25);
    const summary: ChainReconciliationSummary = {
      inspected: candidates.length, unresolved: 0, pending: 0, settled: 0, granted: 0, errors: 0,
    };
    for (const candidate of candidates) {
      try {
        let observation = candidate.latestObservation;
        if (observation.status !== 'settled') {
          const result = await this.observer.observe(candidate.authorization, now);
          if (!result) { summary.unresolved += 1; continue; }
          observation = (await this.ledger.recordSettlementObservation(
            createBaseSepoliaReconciliationObservation(candidate, result),
          )).observation;
          if (observation.status === 'pending') summary.pending += 1;
          else summary.settled += 1;
        }
        if (observation.status === 'settled') {
          await this.grants.commitSettlement(observation);
          summary.granted += 1;
        }
      } catch {
        summary.errors += 1;
      }
    }
    return summary;
  }
}
