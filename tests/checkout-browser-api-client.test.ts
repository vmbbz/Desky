import { describe, expect, it, vi } from 'vitest';

import { CheckoutBrowserApiClient } from '../src/service/commerce/checkout-browser-api-client';
import { baseSepoliaNetwork, baseSepoliaUsdc } from '../src/service/commerce/x402-base-sepolia';

const origin = 'https://commerce.desky.example';
const payer = '0x857b06519E91e3A54538791bDbb0E22373e36b66';
const merchant = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';

function material(state: 'awaiting-wallet' | 'settled' = 'awaiting-wallet') {
  return {
    schemaVersion: 1,
    session: {
      schemaVersion: 1, checkoutSessionId: 'checkout:1', approvalId: 'approval:1',
      accountId: 'account:1', installationId: 'install:1', orderId: 'order:1', quoteId: 'quote:1',
      checkoutUrl: `${origin}/checkout/checkout%3A1`, createdAt: '2026-08-25T10:00:00.000Z',
      expiresAt: '2026-08-25T10:02:00.000Z', state,
      settlementObservationId: state === 'settled' ? 'observation:1' : undefined,
    },
    csrfToken: 's'.repeat(43),
    view: {
      schemaVersion: 1, checkoutSessionId: 'checkout:1', productId: 'avatar:banana',
      avatarRevisionIds: ['banana:revision:1'], currency: 'USDC', amountAtomic: '1250000',
      network: baseSepoliaNetwork, networkName: 'Base Sepolia', asset: baseSepoliaUsdc,
      recipient: merchant, expiresAt: '2026-08-25T10:02:00.000Z',
    },
    paymentRequirements: {
      scheme: 'exact', network: baseSepoliaNetwork, asset: baseSepoliaUsdc,
      amount: '1250000', payTo: merchant, maxTimeoutSeconds: 60,
      extra: { assetTransferMethod: 'eip3009', name: 'USDC', version: '2' },
    },
    resource: {
      url: `${origin}/v1/x402/quotes/quote%3A1`,
      description: 'Desky avatar entitlement', mimeType: 'application/json',
    },
  };
}

function jsonResponse(url: string, value: unknown): Response {
  const response = new Response(JSON.stringify(value), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

describe('hosted checkout page API client', () => {
  it('invokes the native fetch implementation with its required global receiver', async () => {
    const nativeLikeFetch = vi.fn(function (this: unknown, url: string, _init: RequestInit) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(jsonResponse(url, material()));
    });
    vi.stubGlobal('fetch', nativeLikeFetch);
    try {
      const client = new CheckoutBrowserApiClient(origin);
      await expect(client.bootstrapFromUrl(
        `${origin}/checkout/checkout%3A1#handoff=${'v'.repeat(43)}`,
      )).resolves.toMatchObject({ session: { checkoutSessionId: 'checkout:1' } });
      expect(nativeLikeFetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('bootstraps from a fragment while keeping the verifier out of the request URL', async () => {
    const fetchImpl = vi.fn(async (url: string, _init: RequestInit) => jsonResponse(url, material()));
    const client = new CheckoutBrowserApiClient(origin, fetchImpl);
    const verifier = 'v'.repeat(43);
    expect(await client.bootstrapFromUrl(
      `${origin}/checkout/checkout%3A1#handoff=${verifier}`,
    )).toMatchObject({ session: { checkoutSessionId: 'checkout:1' } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${origin}/v1/browser/bootstrap`);
    expect(url).not.toContain(verifier);
    expect(JSON.parse(init.body as string)).toMatchObject({ bindingVerifier: verifier });
    expect(init).toMatchObject({ credentials: 'include', redirect: 'error', cache: 'no-store' });
  });

  it('resumes a previously bound checkout when the sanitized URL is reloaded', async () => {
    const fetchImpl = vi.fn(async (url: string, _init: RequestInit) => jsonResponse(url, material()));
    const client = new CheckoutBrowserApiClient(origin, fetchImpl);
    expect(await client.bootstrapFromUrl(
      `${origin}/checkout/checkout%3A1`,
    )).toMatchObject({ session: { checkoutSessionId: 'checkout:1' } });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toBe(`${origin}/v1/browser/resume`);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string)).toEqual({
      schemaVersion: 1,
      checkoutSessionId: 'checkout:1',
    });
  });

  it('recovers through the bound cookie when bootstrap response handling is interrupted', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (url: string, _init: RequestInit) => {
      calls += 1;
      if (calls === 1) throw new TypeError('simulated response interruption');
      return jsonResponse(url, material());
    });
    const client = new CheckoutBrowserApiClient(origin, fetchImpl);
    expect(await client.bootstrapFromUrl(
      `${origin}/checkout/checkout%3A1#handoff=${'v'.repeat(43)}`,
    )).toMatchObject({ session: { checkoutSessionId: 'checkout:1' } });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      `${origin}/v1/browser/bootstrap`,
      `${origin}/v1/browser/resume`,
    ]);
  });

  it('signs only after explicit invocation and submits with the in-memory CSRF token', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (url: string, _init: RequestInit) => {
      calls += 1;
      return jsonResponse(url, calls === 1 ? material() : material('settled'));
    });
    const client = new CheckoutBrowserApiClient(origin, fetchImpl);
    await client.bootstrapFromUrl(`${origin}/checkout/checkout%3A1#handoff=${'v'.repeat(43)}`);
    const wallet = {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === 'eth_requestAccounts') return [payer];
        if (method === 'wallet_switchEthereumChain') return null;
        return `0x${'11'.repeat(65)}`;
      }),
    };
    expect((await client.signAndSubmit({
      provider: wallet,
      submissionId: 'submission:1',
      nowSeconds: Math.floor(Date.parse('2026-08-25T10:00:00.000Z') / 1_000),
      random: (bytes) => bytes.fill(0x22),
    })).session.state).toBe('settled');
    const [, submit] = fetchImpl.mock.calls[1];
    expect((submit.headers as Record<string, string>)['X-Desky-CSRF']).toBe('s'.repeat(43));
    expect(JSON.parse(submit.body as string)).toMatchObject({
      checkoutSessionId: 'checkout:1', submissionId: 'submission:1',
      paymentPayload: { x402Version: 2 },
    });
    expect(wallet.request).toHaveBeenCalledTimes(3);
  });

  it('admits Base Sepolia through the wallet when the network is missing', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (url: string, _init: RequestInit) => {
      calls += 1;
      return jsonResponse(url, calls === 1 ? material() : material('settled'));
    });
    const client = new CheckoutBrowserApiClient(origin, fetchImpl);
    await client.bootstrapFromUrl(`${origin}/checkout/checkout%3A1#handoff=${'v'.repeat(43)}`);
    let switchCalls = 0;
    const wallet = {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === 'eth_requestAccounts') return [payer];
        if (method === 'wallet_switchEthereumChain' && switchCalls++ === 0) {
          throw Object.assign(new Error('missing chain'), { code: 4902 });
        }
        if (method === 'wallet_addEthereumChain' || method === 'wallet_switchEthereumChain') return null;
        return `0x${'11'.repeat(65)}`;
      }),
    };
    await expect(client.signAndSubmit({
      provider: wallet, submissionId: 'submission:multi',
      nowSeconds: Math.floor(Date.parse('2026-08-25T10:00:00.000Z') / 1_000),
      random: (bytes) => bytes.fill(0x33),
    })).resolves.toMatchObject({ session: { state: 'settled' } });
    expect(wallet.request.mock.calls.map(([input]) => input.method)).toEqual([
      'eth_requestAccounts', 'wallet_switchEthereumChain', 'wallet_addEthereumChain',
      'wallet_switchEthereumChain', 'eth_signTypedData_v4',
    ]);
    const submitted = JSON.parse(fetchImpl.mock.calls[1][1].body as string);
    expect(submitted.paymentPayload.payload.authorization.from).toBe(payer);
  });

  it('rejects redirect/final URL drift and crossed response identity', async () => {
    const redirected = new CheckoutBrowserApiClient(origin, async () => jsonResponse(
      'https://evil.example/bootstrap', material(),
    ));
    await expect(redirected.bootstrapFromUrl(
      `${origin}/checkout/checkout%3A1#handoff=${'v'.repeat(43)}`,
    )).rejects.toThrow('request failed');
    const crossed = new CheckoutBrowserApiClient(origin, async (url) => jsonResponse(url, {
      ...material(), view: { ...material().view, checkoutSessionId: 'checkout:other' },
    }));
    await expect(crossed.bootstrapFromUrl(
      `${origin}/checkout/checkout%3A1#handoff=${'v'.repeat(43)}`,
    )).rejects.toThrow('crossed identity');
  });
});
