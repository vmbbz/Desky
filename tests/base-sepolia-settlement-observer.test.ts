import { describe, expect, it } from 'vitest';

import {
  BaseSepoliaSettlementObserver,
  createBaseSepoliaReconciliationObservation,
  type BaseSepoliaRpc,
} from '../src/service/commerce/base-sepolia-settlement-observer';
import { baseSepoliaUsdc } from '../src/service/commerce/x402-base-sepolia';
import type { PaymentAuthorizationEvidence } from '../src/shared/commerce-settlement';

const authorizationTopic = '0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5';
const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const payer = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const nonce = `0x${'33'.repeat(32)}`;
const transaction = `0x${'44'.repeat(32)}`;
const baseTimestamp = 1_800_000_000;

function addressTopic(address: string): string {
  return `0x${address.slice(2).padStart(64, '0')}`;
}

const authorization: PaymentAuthorizationEvidence = {
  schemaVersion: 1,
  authorizationId: 'authorization:test',
  attemptId: 'attempt:test',
  orderId: 'order:test',
  quoteId: 'quote:test',
  provider: 'x402-base',
  payer,
  paymentIdentifier: nonce,
  network: 'eip155:84532',
  asset: baseSepoliaUsdc,
  recipient,
  amountAtomic: '100000',
  verifiedAt: new Date((baseTimestamp + 900 * 2) * 1_000).toISOString(),
  authorizationExpiresAt: new Date((baseTimestamp + 1_050 * 2) * 1_000).toISOString(),
};

function rpc(options: { latest?: number; include?: boolean; amount?: string } = {}): BaseSepoliaRpc {
  const latest = options.latest ?? 1_000;
  const used = {
    address: baseSepoliaUsdc,
    blockNumber: '0x3b6',
    transactionHash: transaction,
    topics: [authorizationTopic, addressTopic(payer), nonce],
    data: '0x',
  };
  return {
    async request(method, parameters) {
      if (method === 'eth_blockNumber') return `0x${latest.toString(16)}`;
      if (method === 'eth_getBlockByNumber') {
        const number = Number(BigInt(String(parameters[0])));
        return { number: `0x${number.toString(16)}`, timestamp: `0x${(baseTimestamp + number * 2).toString(16)}` };
      }
      if (method === 'eth_getLogs') return options.include === false ? [] : [used];
      if (method === 'eth_getTransactionReceipt') {
        return {
          status: '0x1', transactionHash: transaction, blockNumber: '0x3b6',
          logs: [used, {
            address: baseSepoliaUsdc,
            blockNumber: '0x3b6',
            transactionHash: transaction,
            topics: [transferTopic, addressTopic(payer), addressTopic(recipient)],
            data: options.amount ?? '0x186a0',
          }],
        };
      }
      throw new Error(`Unexpected RPC method ${method}`);
    },
  };
}

describe('Base Sepolia settlement observer', () => {
  it('validates AuthorizationUsed, the exact USDC transfer, receipt, and confirmations', async () => {
    const now = new Date((baseTimestamp + 1_001 * 2) * 1_000).toISOString();
    const result = await new BaseSepoliaSettlementObserver(rpc(), 3).observe(authorization, now);
    expect(result).toEqual({
      status: 'settled', transactionHash: transaction, observedAt: now,
      settledAt: new Date((baseTimestamp + 950 * 2) * 1_000).toISOString(),
      confirmations: 51,
    });
  });

  it('retains a known transaction as pending until the confirmation floor', async () => {
    const now = new Date((baseTimestamp + 952 * 2) * 1_000).toISOString();
    await expect(new BaseSepoliaSettlementObserver(rpc({ latest: 951 }), 3)
      .observe(authorization, now)).resolves.toEqual({
      status: 'pending', transactionHash: transaction, observedAt: now, confirmations: 2,
    });
  });

  it('does not infer failure from absence and rejects a mismatched transfer amount', async () => {
    const now = new Date((baseTimestamp + 1_001 * 2) * 1_000).toISOString();
    await expect(new BaseSepoliaSettlementObserver(rpc({ include: false })).observe(authorization, now))
      .resolves.toBeUndefined();
    await expect(new BaseSepoliaSettlementObserver(rpc({ amount: '0x1869f' })).observe(authorization, now))
      .rejects.toThrow(/exact USDC transfer/);
  });

  it('makes pending polls append-only while settled replay stays deterministic', () => {
    const candidate = {
      authorization,
      latestObservation: {
        schemaVersion: 1 as const, observationId: 'observation:dispatch',
        authorizationId: authorization.authorizationId, attemptId: authorization.attemptId,
        orderId: authorization.orderId, quoteId: authorization.quoteId,
        provider: 'x402-base' as const, status: 'unknown' as const,
        source: 'facilitator-response' as const, payer, paymentIdentifier: nonce,
        network: authorization.network, asset: authorization.asset, recipient,
        amountAtomic: authorization.amountAtomic, observedAt: authorization.verifiedAt,
        reasonCode: 'settlement-dispatching', reconciliationId: 'reconcile:dispatch',
      },
    };
    const firstPending = createBaseSepoliaReconciliationObservation(candidate, {
      status: 'pending', transactionHash: transaction,
      observedAt: '2027-01-15T08:31:00.000Z', confirmations: 1,
    });
    const secondPending = createBaseSepoliaReconciliationObservation(candidate, {
      status: 'pending', transactionHash: transaction,
      observedAt: '2027-01-15T08:31:02.000Z', confirmations: 2,
    });
    expect(firstPending.observationId).not.toBe(secondPending.observationId);
    const settled = {
      status: 'settled' as const, transactionHash: transaction,
      observedAt: '2027-01-15T08:32:00.000Z', settledAt: '2027-01-15T08:30:00.000Z',
      confirmations: 3,
    };
    expect(createBaseSepoliaReconciliationObservation(candidate, settled)).toEqual(
      createBaseSepoliaReconciliationObservation(candidate, {
        ...settled, observedAt: '2027-01-15T08:33:00.000Z', confirmations: 33,
      }),
    );
  });
});
