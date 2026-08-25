import { createHash, randomBytes } from 'node:crypto';

import {
  parseCommerceOrder,
  parseVerifiedCommerceQuote,
  type CommerceOrder,
  type VerifiedCommerceQuote,
} from '../../shared/commerce';
import {
  canonicalCommerceCheckoutTerms,
  parseCommerceCheckoutSession,
  type CommerceCheckoutSession,
  type CreateCommerceCheckoutRequest,
} from '../../shared/commerce-checkout';
export interface CheckoutSessionClient {
  readonly serviceOrigin: string;
  createSession(
    request: CreateCommerceCheckoutRequest,
    accessToken: string,
  ): Promise<CommerceCheckoutSession>;
  getSession(
    request: { schemaVersion: 1; checkoutSessionId: string; installationId: string },
    accessToken: string,
  ): Promise<CommerceCheckoutSession>;
  cancelSession(
    request: { schemaVersion: 1; checkoutSessionId: string; installationId: string },
    accessToken: string,
  ): Promise<CommerceCheckoutSession>;
}

export interface CheckoutApprovalPrompt {
  approvalId: string;
  productId: string;
  avatarRevisionIds: string[];
  currency: 'USDC';
  amountAtomic: string;
  network: string;
  asset: string;
  recipient: string;
  quoteExpiresAt: string;
}

export interface CheckoutHumanApprover {
  confirm(prompt: CheckoutApprovalPrompt): Promise<'approved' | 'cancelled'>;
}

export interface CheckoutBrowserLauncher {
  openExternal(url: string): Promise<void>;
}

export interface StartCheckoutInput {
  approvalId: string;
  idempotencyKey: string;
  installationId: string;
  quote: VerifiedCommerceQuote;
  order: CommerceOrder;
  accessToken: string;
  now: string;
}

export class CheckoutBrowserLaunchError extends Error {
  constructor(
    readonly session: CommerceCheckoutSession,
    options?: ErrorOptions,
  ) {
    super('The approved checkout was created but its browser window could not be opened.', options);
    this.name = 'CheckoutBrowserLaunchError';
  }
}

function identifier(value: string, field: string): string {
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`Invalid checkout ${field}.`);
  }
  return value;
}

export function checkoutTermsDigest(quote: VerifiedCommerceQuote, order: CommerceOrder): string {
  const admittedQuote = parseVerifiedCommerceQuote(quote);
  const admittedOrder = parseCommerceOrder(order);
  return createHash('sha256')
    .update(canonicalCommerceCheckoutTerms(admittedQuote, admittedOrder))
    .digest('base64url');
}

export class CheckoutHandoffCoordinator {
  private readonly consumedApprovals = new Set<string>();
  private readonly browserBindings = new Map<string, string>();
  private readonly browserBindingVerifier: () => string;

  constructor(
    private readonly client: CheckoutSessionClient,
    private readonly approver: CheckoutHumanApprover,
    private readonly browser: CheckoutBrowserLauncher,
    options: { browserBindingVerifier?: () => string } = {},
  ) {
    this.browserBindingVerifier = options.browserBindingVerifier
      ?? (() => randomBytes(32).toString('base64url'));
  }

  async start(input: StartCheckoutInput): Promise<CommerceCheckoutSession | undefined> {
    const quote = parseVerifiedCommerceQuote(input.quote);
    const order = parseCommerceOrder(input.order);
    const approvalId = identifier(input.approvalId, 'approval ID');
    const installationId = identifier(input.installationId, 'installation ID');
    const idempotencyKey = identifier(input.idempotencyKey, 'idempotency key');
    const parsedNow = Date.parse(input.now);
    if (!Number.isFinite(parsedNow)) throw new Error('Invalid checkout approval time.');
    const now = new Date(parsedNow).toISOString();
    if (now !== input.now || this.consumedApprovals.has(approvalId)
      || quote.provider !== 'x402-base' || quote.releaseProfile !== 'windows-direct'
      || quote.currency !== 'USDC' || !quote.network || !quote.asset || !quote.recipient
      || order.state !== 'awaiting-approval'
      || order.quoteId !== quote.quoteId || order.accountId !== quote.accountId
      || order.offerId !== quote.offerId || order.offerRevision !== quote.offerRevision
      || order.currency !== quote.currency || order.amountAtomic !== quote.amountAtomic
      || Date.parse(now) >= Date.parse(quote.expiresAt)) {
      throw new Error('Checkout approval does not match an active authoritative order.');
    }
    this.consumedApprovals.add(approvalId);
    const decision = await this.approver.confirm({
      approvalId,
      productId: quote.productId,
      avatarRevisionIds: [...quote.avatarRevisionIds],
      currency: 'USDC',
      amountAtomic: quote.amountAtomic,
      network: quote.network,
      asset: quote.asset,
      recipient: quote.recipient,
      quoteExpiresAt: quote.expiresAt,
    });
    if (decision !== 'approved') return undefined;
    const approvalExpiresAt = new Date(Math.min(
      Date.parse(now) + 2 * 60 * 1_000,
      Date.parse(quote.expiresAt),
    )).toISOString();
    const bindingVerifier = this.browserBindingVerifier();
    if (!/^[A-Za-z0-9_-]{43}$/.test(bindingVerifier)) {
      throw new Error('Checkout browser binding verifier is invalid.');
    }
    const request: CreateCommerceCheckoutRequest = {
      schemaVersion: 1,
      approvalId,
      accountId: quote.accountId,
      installationId,
      orderId: order.orderId,
      quoteId: quote.quoteId,
      termsDigest: checkoutTermsDigest(quote, order),
      approvedAt: now,
      approvalExpiresAt,
      idempotencyKey,
      browserBindingChallenge: createHash('sha256')
        .update(bindingVerifier, 'utf8')
        .digest('base64url'),
    };
    const session = parseCommerceCheckoutSession(
      await this.client.createSession(request, input.accessToken),
    );
    if (session.approvalId !== approvalId || session.accountId !== quote.accountId
      || session.installationId !== installationId || session.orderId !== order.orderId
      || session.quoteId !== quote.quoteId || session.state !== 'ready'
      || Date.parse(session.expiresAt) > Date.parse(quote.expiresAt)) {
      throw new Error('Commerce checkout session does not match human-approved terms.');
    }
    this.assertHostedUrl(session);
    this.browserBindings.set(session.checkoutSessionId, bindingVerifier);
    try {
      await this.openBoundBrowser(session);
    } catch (cause) {
      throw new CheckoutBrowserLaunchError(session, { cause });
    }
    return session;
  }

  async reopen(session: CommerceCheckoutSession): Promise<void> {
    const admitted = parseCommerceCheckoutSession(session);
    this.assertHostedUrl(admitted);
    if (['settled', 'failed', 'expired', 'cancelled'].includes(admitted.state)) {
      throw new Error('Commerce checkout is no longer openable.');
    }
    await this.openBoundBrowser(admitted);
  }

  async refresh(
    session: CommerceCheckoutSession,
    accessToken: string,
  ): Promise<CommerceCheckoutSession> {
    const admitted = parseCommerceCheckoutSession(session);
    const current = await this.client.getSession({
      schemaVersion: 1,
      checkoutSessionId: admitted.checkoutSessionId,
      installationId: admitted.installationId,
    }, accessToken);
    if (current.checkoutSessionId !== admitted.checkoutSessionId
      || current.accountId !== admitted.accountId || current.orderId !== admitted.orderId
      || current.quoteId !== admitted.quoteId || current.installationId !== admitted.installationId) {
      throw new Error('Commerce checkout status crossed session identity.');
    }
    this.assertHostedUrl(current);
    if (['settled', 'failed', 'expired', 'cancelled'].includes(current.state)) {
      this.browserBindings.delete(current.checkoutSessionId);
    }
    return current;
  }

  async cancel(
    session: CommerceCheckoutSession,
    accessToken: string,
  ): Promise<CommerceCheckoutSession> {
    const admitted = parseCommerceCheckoutSession(session);
    const current = await this.client.cancelSession({
      schemaVersion: 1,
      checkoutSessionId: admitted.checkoutSessionId,
      installationId: admitted.installationId,
    }, accessToken);
    if (current.checkoutSessionId !== admitted.checkoutSessionId
      || current.accountId !== admitted.accountId || current.orderId !== admitted.orderId
      || current.quoteId !== admitted.quoteId || current.installationId !== admitted.installationId
      || current.state !== 'cancelled') {
      throw new Error('Commerce checkout cancellation crossed session identity.');
    }
    this.assertHostedUrl(current);
    this.browserBindings.delete(current.checkoutSessionId);
    return current;
  }

  private async openBoundBrowser(session: CommerceCheckoutSession): Promise<void> {
    const bindingVerifier = this.browserBindings.get(session.checkoutSessionId);
    if (!bindingVerifier) throw new Error('Commerce checkout browser binding is unavailable.');
    const url = new URL(session.checkoutUrl);
    url.hash = `handoff=${bindingVerifier}`;
    await this.browser.openExternal(url.toString());
  }

  private assertHostedUrl(session: CommerceCheckoutSession): void {
    const url = new URL(session.checkoutUrl);
    if (url.origin !== this.client.serviceOrigin
      || url.pathname !== `/checkout/${encodeURIComponent(session.checkoutSessionId)}`) {
      throw new Error('Commerce checkout URL does not match its hosted session.');
    }
  }
}
