import { parsePaymentAttempt, type PaymentAttempt } from '../../shared/commerce';
import type {
  PaymentAuthorizationEvidence,
  PaymentSettlementObservation,
} from '../../shared/commerce-settlement';
import {
  baseSepoliaNetwork,
  parseBaseSepoliaPaymentPayload,
  parseX402PaymentRequirements,
  type X402BasePaymentPayload,
  type X402PaymentRequirements,
  type X402ResourceInfo,
  type X402SettleResponse,
  type X402VerifyResponse,
} from './x402-base-sepolia';

export interface X402CheckoutFacilitator {
  verify(
    paymentPayload: X402BasePaymentPayload,
    paymentRequirements: X402PaymentRequirements,
  ): Promise<X402VerifyResponse>;
  settle(
    paymentPayload: X402BasePaymentPayload,
    paymentRequirements: X402PaymentRequirements,
  ): Promise<X402SettleResponse>;
}

export interface X402SettlementLedger {
  getPaymentAuthorization(authorizationId: string): PaymentAuthorizationEvidence | undefined;
  getLatestSettlementObservation(
    authorizationId: string,
  ): PaymentSettlementObservation | undefined;
  advancePaymentAttempt(attemptId: string, state: 'failed'): PaymentAttempt;
  verifyPaymentAuthorization(value: unknown): {
    authorization: PaymentAuthorizationEvidence;
    attempt: PaymentAttempt;
  };
  claimSettlementDispatch(value: unknown): {
    claimed: boolean;
    observation: PaymentSettlementObservation;
    attempt: PaymentAttempt;
  };
  recordSettlementObservation(value: unknown): {
    observation: PaymentSettlementObservation;
    attempt: PaymentAttempt;
  };
}

export interface ProcessX402CheckoutInput {
  attempt: PaymentAttempt;
  paymentPayload: unknown;
  paymentRequirements: unknown;
  resource: X402ResourceInfo;
  now: string;
}

export type ProcessX402CheckoutResult =
  | { kind: 'verification-rejected'; reason?: string }
  | { kind: 'verification-unavailable' }
  | { kind: 'reconciliation-required'; observation: PaymentSettlementObservation }
  | { kind: 'settlement-recorded'; observation: PaymentSettlementObservation };

function exactTimestamp(value: string): { iso: string; seconds: number } {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error('Invalid x402 checkout processing time.');
  const iso = new Date(milliseconds).toISOString();
  if (iso !== value) throw new Error('Invalid x402 checkout processing time.');
  return { iso, seconds: Math.floor(milliseconds / 1_000) };
}

function sameAddress(left: string | undefined, right: string): boolean {
  return left?.toLowerCase() === right.toLowerCase();
}

function observation(
  authorization: PaymentAuthorizationEvidence,
  input: {
    observationId: string;
    status: 'unknown' | 'pending' | 'settled' | 'failed';
    providerReference?: string;
    observedAt: string;
    reasonCode: string;
    reconciliationId: string;
  },
): PaymentSettlementObservation {
  return {
    schemaVersion: 1,
    observationId: input.observationId,
    authorizationId: authorization.authorizationId,
    attemptId: authorization.attemptId,
    orderId: authorization.orderId,
    quoteId: authorization.quoteId,
    provider: 'x402-base',
    status: input.status,
    source: 'facilitator-response',
    payer: authorization.payer,
    paymentIdentifier: authorization.paymentIdentifier,
    network: authorization.network,
    asset: authorization.asset,
    recipient: authorization.recipient,
    amountAtomic: authorization.amountAtomic,
    providerReference: input.providerReference,
    observedAt: input.observedAt,
    settledAt: input.status === 'settled' ? input.observedAt : undefined,
    reasonCode: input.reasonCode,
    reconciliationId: input.reconciliationId,
  };
}

/**
 * Hosted-only x402 processor. Raw wallet signatures are admitted in memory, sent to the
 * facilitator, and never written to the ledger. A durable unknown observation is claimed before
 * `/settle`; an exact replay or another process therefore cannot broadcast the payment twice.
 */
export class X402CheckoutProcessor {
  constructor(
    private readonly ledger: X402SettlementLedger,
    private readonly facilitator: X402CheckoutFacilitator,
  ) {}

  async process(input: ProcessX402CheckoutInput): Promise<ProcessX402CheckoutResult> {
    const attempt = parsePaymentAttempt(input.attempt);
    const now = exactTimestamp(input.now);
    const requirements = parseX402PaymentRequirements(input.paymentRequirements);
    const quoteExpiresAtSeconds = Math.floor(Date.parse(attempt.quoteExpiresAt) / 1_000);
    if (attempt.provider !== 'x402-base'
      || !['submitted', 'verified', 'settlement-unknown', 'settlement-pending', 'settled']
        .includes(attempt.state)
      || attempt.network !== baseSepoliaNetwork
      || !sameAddress(attempt.asset, requirements.asset)
      || !sameAddress(attempt.recipient, requirements.payTo)) {
      throw new Error('Payment attempt is not admitted for x402 checkout processing.');
    }
    const payload = parseBaseSepoliaPaymentPayload(
      input.paymentPayload,
      requirements,
      input.resource,
      now.seconds,
      quoteExpiresAtSeconds,
    );
    const authorizationId = `authorization:${attempt.attemptId}`;
    let authorization = this.ledger.getPaymentAuthorization(authorizationId);
    if (!authorization) {
      if (attempt.state !== 'submitted') {
        throw new Error('Payment attempt is missing its durable x402 authorization evidence.');
      }
      let verified: X402VerifyResponse;
      try {
        verified = await this.facilitator.verify(payload, requirements);
      } catch {
        return { kind: 'verification-unavailable' };
      }
      if (!verified.isValid || !verified.payer) {
        this.ledger.advancePaymentAttempt(attempt.attemptId, 'failed');
        return { kind: 'verification-rejected', reason: verified.invalidReason };
      }
      if (!sameAddress(verified.payer, payload.payload.authorization.from)) {
        throw new Error('Facilitator verification crossed x402 payer identity.');
      }
      authorization = this.ledger.verifyPaymentAuthorization({
        schemaVersion: 1,
        authorizationId,
        attemptId: attempt.attemptId,
        orderId: attempt.orderId,
        quoteId: attempt.quoteId,
        provider: 'x402-base',
        payer: verified.payer,
        paymentIdentifier: payload.payload.authorization.nonce,
        network: requirements.network,
        asset: requirements.asset,
        recipient: requirements.payTo,
        amountAtomic: requirements.amount,
        verifiedAt: now.iso,
        authorizationExpiresAt: new Date(
          Number(payload.payload.authorization.validBefore) * 1_000,
        ).toISOString(),
      }).authorization;
    }
    if (authorization.attemptId !== attempt.attemptId
      || authorization.orderId !== attempt.orderId
      || authorization.quoteId !== attempt.quoteId
      || authorization.provider !== 'x402-base'
      || authorization.network !== requirements.network
      || !sameAddress(authorization.asset, requirements.asset)
      || !sameAddress(authorization.recipient, requirements.payTo)
      || authorization.amountAtomic !== requirements.amount
      || authorization.paymentIdentifier !== payload.payload.authorization.nonce
      || !sameAddress(authorization.payer, payload.payload.authorization.from)) {
      throw new Error('Durable x402 authorization crossed checkout identity.');
    }

    const prior = this.ledger.getLatestSettlementObservation(authorization.authorizationId);
    if (prior) return { kind: 'reconciliation-required', observation: prior };

    const dispatch = this.ledger.claimSettlementDispatch(observation(authorization, {
      observationId: `observation:dispatch:${attempt.attemptId}`,
      status: 'unknown',
      observedAt: now.iso,
      reasonCode: 'settlement-dispatching',
      reconciliationId: `reconcile:dispatch:${attempt.attemptId}`,
    }));
    if (!dispatch.claimed) {
      return { kind: 'reconciliation-required', observation: dispatch.observation };
    }

    let settled: X402SettleResponse;
    try {
      settled = await this.facilitator.settle(payload, requirements);
    } catch {
      return { kind: 'reconciliation-required', observation: dispatch.observation };
    }

    if (!settled.success && settled.errorReason === 'settlement_pending'
      && !settled.transaction) {
      return { kind: 'reconciliation-required', observation: dispatch.observation };
    }
    let status: 'pending' | 'settled' | 'failed';
    if (settled.success) status = 'settled';
    else if (settled.errorReason === 'settlement_pending' && settled.transaction) status = 'pending';
    else status = 'failed';
    const providerReference = settled.transaction || undefined;
    const finalObservation = this.ledger.recordSettlementObservation(observation(authorization, {
      observationId: `observation:result:${attempt.attemptId}`,
      status,
      providerReference,
      observedAt: now.iso,
      reasonCode: status === 'settled'
        ? 'facilitator-settled'
        : status === 'pending'
          ? 'facilitator-pending'
          : 'facilitator-failed',
      reconciliationId: `reconcile:result:${attempt.attemptId}`,
    })).observation;
    return { kind: 'settlement-recorded', observation: finalObservation };
  }
}
