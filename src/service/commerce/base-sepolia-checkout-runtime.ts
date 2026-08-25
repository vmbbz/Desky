import { createHash } from 'node:crypto';

import {
  parseCommerceBrowserCheckoutView,
} from '../../shared/commerce-checkout-browser';
import type { PaymentAttempt, VerifiedCommerceQuote } from '../../shared/commerce';
import type { PaymentSettlementObservation } from '../../shared/commerce-settlement';
import type {
  AdmittedBrowserPayment,
  CheckoutRuntimeProjection,
  HostedCheckoutWalletRuntime,
  PreparedBrowserCheckout,
} from './checkout-browser-service';
import type { CommerceCheckoutSessionRecord } from './checkout-session-service';
import {
  createBaseSepoliaPaymentRequirements,
  createBaseSepoliaResource,
  parseBaseSepoliaPaymentPayload,
  type BaseSepoliaX402Policy,
} from './x402-base-sepolia';
import {
  X402CheckoutProcessor,
  type X402CheckoutFacilitator,
  type X402SettlementLedger,
} from './x402-checkout-processor';

export interface BaseSepoliaCheckoutLedger extends X402SettlementLedger {
  getQuote(quoteId: string): VerifiedCommerceQuote | undefined;
  getPaymentAttempt(attemptId: string): PaymentAttempt | undefined;
  prepareCheckoutPayment(
    orderId: string,
    attempt: PaymentAttempt,
    updatedAt: string,
  ): { attempt: PaymentAttempt };
}

function projection(
  attempt: PaymentAttempt,
  observation: PaymentSettlementObservation | undefined,
): CheckoutRuntimeProjection | undefined {
  if (observation) {
    return {
      state: observation.status === 'unknown'
        ? 'settlement-unknown'
        : observation.status === 'pending'
          ? 'settlement-pending'
          : observation.status,
      settlementObservationId: observation.observationId,
    };
  }
  if (attempt.state === 'verified') return { state: 'authorization-verified' };
  if (attempt.state === 'failed') return { state: 'failed' };
  return undefined;
}

/** Concrete provider-disabled Base Sepolia wallet runtime for the hosted checkout service. */
export class BaseSepoliaCheckoutRuntime implements HostedCheckoutWalletRuntime {
  private readonly processor: X402CheckoutProcessor;

  constructor(
    private readonly ledger: BaseSepoliaCheckoutLedger,
    facilitator: X402CheckoutFacilitator,
    private readonly policy: BaseSepoliaX402Policy,
  ) {
    this.processor = new X402CheckoutProcessor(ledger, facilitator);
  }

  async prepare(
    record: CommerceCheckoutSessionRecord,
    now: string,
  ): Promise<PreparedBrowserCheckout> {
    const quote = this.ledger.getQuote(record.session.quoteId);
    if (!quote || quote.accountId !== record.session.accountId
      || quote.provider !== 'x402-base' || quote.releaseProfile !== 'windows-direct') {
      throw new Error('Hosted Base Sepolia checkout quote is unavailable.');
    }
    const nowSeconds = Math.floor(Date.parse(now) / 1_000);
    const paymentRequirements = createBaseSepoliaPaymentRequirements(
      quote,
      this.policy,
      nowSeconds,
    );
    const resource = createBaseSepoliaResource(quote.quoteId, this.policy);
    const attemptId = `attempt:${record.session.checkoutSessionId}`;
    const attempt: PaymentAttempt = {
      schemaVersion: 1,
      attemptId,
      orderId: record.session.orderId,
      quoteId: quote.quoteId,
      provider: 'x402-base',
      network: quote.network,
      asset: quote.asset,
      recipient: quote.recipient,
      quoteExpiresAt: quote.expiresAt,
      state: 'created',
    };
    return {
      attemptId,
      attempt,
      view: parseCommerceBrowserCheckoutView({
        schemaVersion: 1,
        checkoutSessionId: record.session.checkoutSessionId,
        productId: quote.productId,
        avatarRevisionIds: quote.avatarRevisionIds,
        currency: 'USDC',
        amountAtomic: quote.amountAtomic,
        network: quote.network,
        networkName: 'Base Sepolia',
        asset: quote.asset,
        recipient: quote.recipient,
        expiresAt: record.session.expiresAt,
      }),
      paymentRequirements,
      resource,
    };
  }

  admitPayment(
    prepared: PreparedBrowserCheckout,
    paymentPayload: unknown,
    now: string,
  ): AdmittedBrowserPayment {
    const payload = parseBaseSepoliaPaymentPayload(
      paymentPayload,
      prepared.paymentRequirements,
      prepared.resource,
      Math.floor(Date.parse(now) / 1_000),
      Math.floor(Date.parse(prepared.view.expiresAt) / 1_000),
    );
    return {
      payload,
      payloadDigest: createHash('sha256')
        .update(JSON.stringify(payload), 'utf8')
        .digest('base64url'),
    };
  }

  async process(
    prepared: PreparedBrowserCheckout,
    payment: AdmittedBrowserPayment,
    now: string,
  ) {
    const attempt = this.ledger.prepareCheckoutPayment(
      prepared.attempt.orderId,
      prepared.attempt,
      now,
    ).attempt;
    return this.processor.process({
      attempt,
      paymentPayload: payment.payload,
      paymentRequirements: prepared.paymentRequirements,
      resource: prepared.resource,
      now,
    });
  }

  async project(
    record: CommerceCheckoutSessionRecord,
  ): Promise<CheckoutRuntimeProjection | undefined> {
    if (!record.attemptId) return undefined;
    const attempt = this.ledger.getPaymentAttempt(record.attemptId);
    if (!attempt) return undefined;
    const observation = this.ledger.getLatestSettlementObservation(
      `authorization:${record.attemptId}`,
    );
    return projection(attempt, observation);
  }
}
