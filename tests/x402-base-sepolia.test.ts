import { describe, expect, it, vi } from 'vitest';

import type { VerifiedCommerceQuote } from '../src/shared/commerce';
import {
  assertBaseSepoliaFacilitatorSupport,
  baseSepoliaNetwork,
  baseSepoliaUsdc,
  createBaseSepoliaPaymentRequirements,
  createBaseSepoliaResource,
  parseBaseSepoliaPaymentPayload,
  parseX402SettleResponse,
  parseX402VerifyResponse,
  StrictX402FacilitatorClient,
  X402FacilitatorTimeoutError,
  type BaseSepoliaX402Policy,
  type X402BasePaymentPayload,
  type X402PaymentRequirements,
} from '../src/service/commerce/x402-base-sepolia';

const merchant = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';
const payer = '0x857b06519E91e3A54538791bDbb0E22373e36b66';
const nowSeconds = 1_787_623_260;

const policy: BaseSepoliaX402Policy = {
  merchantRecipient: merchant,
  resourceOrigin: 'https://commerce.desky.example',
  facilitatorBaseUrl: 'https://x402.org/facilitator',
};

function quote(overrides: Partial<VerifiedCommerceQuote> = {}): VerifiedCommerceQuote {
  return {
    schemaVersion: 1,
    quoteId: 'quote:base:1',
    accountId: 'account:1',
    offerId: 'offer:avatar:1',
    offerRevision: 1,
    productId: 'product:avatar:1',
    productRevision: 1,
    avatarRevisionIds: ['avatar:banana:r1'],
    catalogVersion: 'catalog:1',
    provider: 'x402-base',
    releaseProfile: 'windows-direct',
    region: 'ZA',
    currency: 'USDC',
    amountAtomic: '1250000',
    network: baseSepoliaNetwork,
    asset: baseSepoliaUsdc,
    recipient: merchant,
    issuedAt: new Date((nowSeconds - 30) * 1_000).toISOString(),
    expiresAt: new Date((nowSeconds + 240) * 1_000).toISOString(),
    ...overrides,
  };
}

function payload(
  requirements: X402PaymentRequirements,
  overrides: Record<string, unknown> = {},
): X402BasePaymentPayload {
  return {
    x402Version: 2,
    resource: createBaseSepoliaResource('quote:base:1', policy),
    accepted: requirements,
    payload: {
      signature: `0x${'11'.repeat(65)}`,
      authorization: {
        from: payer,
        to: merchant,
        value: requirements.amount,
        validAfter: String(nowSeconds - 10),
        validBefore: String(nowSeconds + 120),
        nonce: `0x${'22'.repeat(32)}`,
        ...overrides,
      },
    },
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('Base Sepolia x402 v2 admission', () => {
  it('creates exact EIP-3009 USDC requirements from an authoritative quote', () => {
    const requirements = createBaseSepoliaPaymentRequirements(quote(), policy, nowSeconds);
    expect(requirements).toEqual({
      scheme: 'exact',
      network: 'eip155:84532',
      asset: baseSepoliaUsdc,
      amount: '1250000',
      payTo: merchant,
      maxTimeoutSeconds: 60,
      extra: { assetTransferMethod: 'eip3009', name: 'USDC', version: '2' },
    });
  });

  it.each([
    ['network', { network: 'base-sepolia' }],
    ['asset', { asset: '0x1111111111111111111111111111111111111111' }],
    ['recipient', { recipient: '0x1111111111111111111111111111111111111111' }],
    ['profile', { releaseProfile: 'windows-store' as const }],
    ['currency', { currency: 'USD' }],
    ['provider', { provider: 'x402-solana' as const }],
  ])('rejects a quote with the wrong %s', (_name, overrides) => {
    expect(() => createBaseSepoliaPaymentRequirements(quote(overrides), policy, nowSeconds))
      .toThrow('not admitted');
  });

  it('rejects expired and overlong quotes', () => {
    expect(() => createBaseSepoliaPaymentRequirements(quote({
      expiresAt: new Date(nowSeconds * 1_000).toISOString(),
    }), policy, nowSeconds)).toThrow('not admitted');
    expect(() => createBaseSepoliaPaymentRequirements(quote({
      issuedAt: new Date((nowSeconds - 400) * 1_000).toISOString(),
    }), policy, nowSeconds)).toThrow('not admitted');
  });

  it('admits only a payload that exactly echoes the quote and EIP-3009 authorization', () => {
    const requirements = createBaseSepoliaPaymentRequirements(quote(), policy, nowSeconds);
    const value = payload(requirements);
    expect(parseBaseSepoliaPaymentPayload(
      value,
      requirements,
      createBaseSepoliaResource('quote:base:1', policy),
      nowSeconds,
      nowSeconds + 240,
    )).toEqual(value);
  });

  it.each([
    ['amount', { value: '1250001' }],
    ['recipient', { to: '0x1111111111111111111111111111111111111111' }],
    ['expired', { validBefore: String(nowSeconds) }],
    ['future', { validAfter: String(nowSeconds + 121) }],
    ['late', { validBefore: String(nowSeconds + 241) }],
    ['nonce', { nonce: '0x1234' }],
  ])('rejects a mismatched %s authorization', (_name, overrides) => {
    const requirements = createBaseSepoliaPaymentRequirements(quote(), policy, nowSeconds);
    expect(() => parseBaseSepoliaPaymentPayload(
      payload(requirements, overrides),
      requirements,
      createBaseSepoliaResource('quote:base:1', policy),
      nowSeconds,
      nowSeconds + 240,
    )).toThrow();
  });

  it('rejects unknown payment fields and mutated resource identity', () => {
    const requirements = createBaseSepoliaPaymentRequirements(quote(), policy, nowSeconds);
    expect(() => parseBaseSepoliaPaymentPayload({
      ...payload(requirements),
      extensions: {},
    }, requirements, createBaseSepoliaResource('quote:base:1', policy), nowSeconds, nowSeconds + 240))
      .toThrow('payment payload');
    expect(() => parseBaseSepoliaPaymentPayload({
      ...payload(requirements),
      resource: { ...createBaseSepoliaResource('quote:base:1', policy), url: 'https://evil.example' },
    }, requirements, createBaseSepoliaResource('quote:base:1', policy), nowSeconds, nowSeconds + 240))
      .toThrow('resource');
  });

  it('requires the facilitator to advertise v2 exact on CAIP-2 Base Sepolia', () => {
    expect(assertBaseSepoliaFacilitatorSupport({
      kinds: [{ x402Version: 2, scheme: 'exact', network: baseSepoliaNetwork }],
      extensions: [],
      signers: { 'eip155:*': [merchant] },
    }).kinds).toHaveLength(1);
    expect(() => assertBaseSepoliaFacilitatorSupport({
      kinds: [{ x402Version: 1, scheme: 'exact', network: 'base-sepolia' }],
      extensions: [],
      signers: {},
    })).toThrow('does not advertise');
  });

  it('rejects contradictory verify and settle responses', () => {
    expect(() => parseX402VerifyResponse({ isValid: true, payer, invalidReason: 'bad' }))
      .toThrow('Contradictory');
    expect(() => parseX402SettleResponse({
      success: true,
      payer,
      transaction: '',
      network: baseSepoliaNetwork,
    })).toThrow('Contradictory');
    expect(parseX402SettleResponse({
      success: true,
      payer,
      transaction: `0x${'AB'.repeat(32)}`,
      network: baseSepoliaNetwork,
    }).transaction).toBe(`0x${'ab'.repeat(32)}`);
  });
});

describe('strict x402 facilitator client', () => {
  it('uses fixed paths, no redirects, server authorization, and validates payer/amount', async () => {
    const requirements = createBaseSepoliaPaymentRequirements(quote(), policy, nowSeconds);
    const payment = payload(requirements);
    const fetchImpl = vi.fn(async (input: string, init: RequestInit) => {
      expect(init.redirect).toBe('manual');
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer server-secret');
      if (input.endsWith('/supported')) return jsonResponse({
        kinds: [{ x402Version: 2, scheme: 'exact', network: baseSepoliaNetwork }],
        extensions: [], signers: {},
      });
      if (input.endsWith('/verify')) return jsonResponse({ isValid: true, payer });
      return jsonResponse({
        success: true,
        payer,
        transaction: `0x${'aa'.repeat(32)}`,
        network: baseSepoliaNetwork,
        amount: requirements.amount,
      });
    });
    const client = new StrictX402FacilitatorClient({
      baseUrl: 'https://facilitator.example/v2/x402',
      authorization: 'Bearer server-secret',
      fetchImpl,
    });
    await expect(client.getSupported()).resolves.toBeDefined();
    await expect(client.verify(payment, requirements)).resolves.toMatchObject({ isValid: true });
    await expect(client.settle(payment, requirements)).resolves.toMatchObject({ success: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('rejects redirects, wrong media type, oversized data, and wrong settlement amount', async () => {
    const requirements = createBaseSepoliaPaymentRequirements(quote(), policy, nowSeconds);
    const payment = payload(requirements);
    const responses = [
      new Response('', { status: 302, headers: { Location: 'https://evil.example' } }),
      new Response('{}', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
      new Response('x'.repeat(128 * 1_024 + 1), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }),
      jsonResponse({
        success: true, payer, transaction: `0x${'aa'.repeat(32)}`,
        network: baseSepoliaNetwork, amount: '1',
      }),
    ];
    const client = new StrictX402FacilitatorClient({
      baseUrl: 'https://facilitator.example/v2/x402',
      fetchImpl: vi.fn(async () => responses.shift()!),
    });
    await expect(client.getSupported()).rejects.toThrow('redirected');
    await expect(client.getSupported()).rejects.toThrow('media type');
    await expect(client.getSupported()).rejects.toThrow('too large');
    await expect(client.settle(payment, requirements)).rejects.toThrow('does not match');
  });

  it('classifies settle timeout as indeterminate', async () => {
    const requirements = createBaseSepoliaPaymentRequirements(quote(), policy, nowSeconds);
    const client = new StrictX402FacilitatorClient({
      baseUrl: 'https://facilitator.example/v2/x402',
      timeoutMilliseconds: 1_000,
      fetchImpl: vi.fn(async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })),
    });
    const error = await client.settle(payload(requirements), requirements).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(X402FacilitatorTimeoutError);
    expect((error as X402FacilitatorTimeoutError).indeterminate).toBe(true);
  });
});
