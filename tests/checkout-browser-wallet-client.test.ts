import { describe, expect, it, vi } from 'vitest';

import {
  connectBaseSepoliaCheckoutWallet,
  readCheckoutHandoffVerifier,
  signBaseSepoliaCheckout,
  type Eip1193Provider,
} from '../src/service/commerce/checkout-browser-wallet-client';
import {
  baseSepoliaNetwork,
  baseSepoliaUsdc,
} from '../src/service/commerce/x402-base-sepolia';

const payer = '0x857b06519E91e3A54538791bDbb0E22373e36b66';
const merchant = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C';
const requirements = {
  scheme: 'exact', network: baseSepoliaNetwork, asset: baseSepoliaUsdc,
  amount: '1250000', payTo: merchant, maxTimeoutSeconds: 60,
  extra: { assetTransferMethod: 'eip3009', name: 'USDC', version: '2' },
} as const;
const resource = {
  url: 'https://commerce.desky.example/v1/x402/quotes/quote%3A1',
  description: 'Desky avatar entitlement', mimeType: 'application/json' as const,
};

describe('hosted Base Sepolia wallet client', () => {
  it('reads only the exact fragment verifier without treating it as a server URL credential', () => {
    expect(readCheckoutHandoffVerifier(
      `https://commerce.desky.example/checkout/checkout%3A1#handoff=${'v'.repeat(43)}`,
    )).toBe('v'.repeat(43));
    expect(() => readCheckoutHandoffVerifier(
      `https://commerce.desky.example/checkout/checkout%3A1?handoff=${'v'.repeat(43)}`,
    )).toThrow('fragment');
    expect(() => readCheckoutHandoffVerifier(
      `https://commerce.desky.example/checkout/checkout%3A1#handoff=${'v'.repeat(43)}&next=evil`,
    )).toThrow('fragment');
  });

  it('switches to Base Sepolia and requests the exact EIP-3009 typed signature', async () => {
    const request = vi.fn(async (input: { method: string; params?: unknown[] }) => {
      if (input.method === 'eth_requestAccounts') return [payer];
      if (input.method === 'wallet_switchEthereumChain') return null;
      if (input.method === 'eth_call') return '0x989680';
      if (input.method === 'eth_signTypedData_v4') return `0x${'11'.repeat(65)}`;
      throw new Error('unexpected method');
    });
    const payload = await signBaseSepoliaCheckout({
      provider: { request } satisfies Eip1193Provider,
      paymentRequirements: requirements,
      resource,
      nowSeconds: 1_787_649_600,
      expiresAtSeconds: 1_787_649_720,
      random: (bytes) => bytes.fill(0x22),
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x14a34' }],
    });
    const sign = request.mock.calls[3][0];
    expect(sign.method).toBe('eth_signTypedData_v4');
    const typed = JSON.parse((sign.params as string[])[1]) as Record<string, unknown>;
    expect(typed).toMatchObject({
      primaryType: 'TransferWithAuthorization',
      domain: { name: 'USDC', version: '2', chainId: 84532, verifyingContract: baseSepoliaUsdc },
      message: { from: payer, to: merchant, value: '1250000' },
    });
    expect(payload.payload.authorization.nonce).toBe(`0x${'22'.repeat(32)}`);
    expect(payload.payload.signature).toBe(`0x${'11'.repeat(65)}`);
  });

  it('fails closed on ambiguous accounts, expired authorization, and malformed signature', async () => {
    const provider = (accounts: string[], signature = `0x${'11'.repeat(65)}`): Eip1193Provider => ({
      request: vi.fn(async ({ method }) => {
        if (method === 'eth_requestAccounts') return accounts;
        if (method === 'wallet_switchEthereumChain') return null;
        if (method === 'eth_call') return '0x989680';
        return signature;
      }),
    });
    await expect(signBaseSepoliaCheckout({
      provider: provider([payer, merchant]), paymentRequirements: requirements, resource,
      nowSeconds: 100, expiresAtSeconds: 200, random: (bytes) => bytes.fill(1),
    })).rejects.toThrow('ambiguous');
    await expect(signBaseSepoliaCheckout({
      provider: provider([payer]), paymentRequirements: requirements, resource,
      nowSeconds: 200, expiresAtSeconds: 200, random: (bytes) => bytes.fill(1),
    })).rejects.toThrow('expired');
    await expect(signBaseSepoliaCheckout({
      provider: provider([payer], 'bad'), paymentRequirements: requirements, resource,
      nowSeconds: 100, expiresAtSeconds: 200, random: (bytes) => bytes.fill(1),
    })).rejects.toThrow('signature');
    await expect(signBaseSepoliaCheckout({
      provider: provider([merchant]), paymentRequirements: requirements, resource,
      nowSeconds: 100, expiresAtSeconds: 200, random: (bytes) => bytes.fill(1),
    })).rejects.toThrow('differ from the merchant');
  });

  it('preserves a bounded diagnostic when the user rejects wallet approval', async () => {
    const provider: Eip1193Provider = {
      request: vi.fn(async () => {
        throw Object.assign(new Error('wallet detail must not escape'), { code: 4001 });
      }),
    };
    await expect(signBaseSepoliaCheckout({
      provider, paymentRequirements: requirements, resource,
      nowSeconds: 100, expiresAtSeconds: 200, random: (bytes) => bytes.fill(1),
    })).rejects.toMatchObject({
      name: 'CheckoutWalletError', code: 'wallet-user-rejected',
    });
  });

  it('connects and checks test USDC without requesting a signature', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') return [payer];
      if (method === 'wallet_switchEthereumChain') return null;
      if (method === 'eth_call') return '0x989680';
      throw new Error('unexpected method');
    });
    await expect(connectBaseSepoliaCheckoutWallet({
      provider: { request }, paymentRequirements: requirements,
      nowSeconds: 100, expiresAtSeconds: 200,
    })).resolves.toEqual({ account: payer, balanceAtomic: '10000000', sufficient: true });
    expect(request.mock.calls.map(([input]) => input.method)).toEqual([
      'eth_requestAccounts', 'wallet_switchEthereumChain', 'eth_call',
    ]);
  });

  it('fails before signing when the connected account lacks test USDC', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') return [payer];
      if (method === 'wallet_switchEthereumChain') return null;
      if (method === 'eth_call') return '0x1';
      throw new Error('signature must not be requested');
    });
    await expect(connectBaseSepoliaCheckoutWallet({
      provider: { request }, paymentRequirements: requirements,
      nowSeconds: 100, expiresAtSeconds: 200,
    })).rejects.toMatchObject({ code: 'wallet-insufficient-usdc' });
    expect(request.mock.calls.map(([input]) => input.method)).not.toContain('eth_signTypedData_v4');
  });
});
