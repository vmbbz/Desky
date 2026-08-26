import {
  parseCommerceBrowserSecret,
} from '../../shared/commerce-checkout-browser';
import {
  baseSepoliaNetwork,
  parseX402PaymentRequirements,
  type X402BasePaymentPayload,
  type X402ResourceInfo,
} from './x402-base-sepolia';

export interface Eip1193Provider {
  request(input: { method: string; params?: unknown[] }): Promise<unknown>;
}

export type CheckoutWalletFailureCode =
  | 'wallet-user-rejected'
  | 'wallet-account-access'
  | 'wallet-network-switch'
  | 'wallet-network-add'
  | 'wallet-signature-request'
  | 'wallet-signature-invalid'
  | 'wallet-checkout-expired';

export class CheckoutWalletError extends Error {
  constructor(readonly code: CheckoutWalletFailureCode) {
    super(code === 'wallet-account-access'
      ? 'Wallet returned an invalid or ambiguous account selection.'
      : code === 'wallet-checkout-expired'
        ? 'Checkout authorization has expired.'
        : code === 'wallet-signature-invalid'
          ? 'Wallet returned an invalid EIP-3009 signature.'
          : code);
    this.name = 'CheckoutWalletError';
  }
}

const baseSepoliaChainId = 84_532;
const baseSepoliaChainHex = '0x14a34';
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const signaturePattern = /^0x[0-9a-fA-F]{130}$/;

export function readCheckoutHandoffVerifier(urlValue: string): string {
  let url: URL;
  try { url = new URL(urlValue); } catch {
    throw new Error('Checkout handoff URL is invalid.');
  }
  if (url.hash.slice(1).split('&').length !== 1 || !url.hash.startsWith('#handoff=')) {
    throw new Error('Checkout handoff fragment is invalid.');
  }
  return parseCommerceBrowserSecret(
    url.hash.slice('#handoff='.length),
    'handoff verifier',
  );
}

function randomNonce(random?: (bytes: Uint8Array) => Uint8Array): string {
  const bytes = new Uint8Array(32);
  const filled = random ? random(bytes) : globalThis.crypto.getRandomValues(bytes);
  if (!(filled instanceof Uint8Array) || filled.byteLength !== 32) {
    throw new Error('Wallet nonce source is invalid.');
  }
  return `0x${[...filled].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function readAccount(value: unknown): string {
  if (!Array.isArray(value) || value.length !== 1
    || typeof value[0] !== 'string' || !addressPattern.test(value[0])) {
    throw new CheckoutWalletError('wallet-account-access');
  }
  return value[0];
}

function providerCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'number' && Number.isSafeInteger(code) ? code : undefined;
}

async function providerRequest(
  provider: Eip1193Provider,
  input: { method: string; params?: unknown[] },
  failure: CheckoutWalletFailureCode,
): Promise<unknown> {
  try { return await provider.request(input); } catch (error) {
    throw new CheckoutWalletError(providerCode(error) === 4001 ? 'wallet-user-rejected' : failure);
  }
}

async function switchToBaseSepolia(provider: Eip1193Provider): Promise<void> {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain', params: [{ chainId: baseSepoliaChainHex }],
    });
  } catch (error) {
    if (providerCode(error) !== 4902) {
      throw new CheckoutWalletError(
        providerCode(error) === 4001 ? 'wallet-user-rejected' : 'wallet-network-switch',
      );
    }
    await providerRequest(provider, {
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: baseSepoliaChainHex,
        chainName: 'Base Sepolia',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: ['https://sepolia.base.org'],
        blockExplorerUrls: ['https://sepolia.basescan.org'],
      }],
    }, 'wallet-network-add');
    await providerRequest(provider, {
      method: 'wallet_switchEthereumChain', params: [{ chainId: baseSepoliaChainHex }],
    }, 'wallet-network-switch');
  }
}

/**
 * Builds the exact EIP-3009 authorization in the hosted page. The wallet performs signing;
 * Desky never receives an account private key or seed phrase.
 */
export async function signBaseSepoliaCheckout(input: {
  provider: Eip1193Provider;
  paymentRequirements: unknown;
  resource: X402ResourceInfo;
  nowSeconds: number;
  expiresAtSeconds: number;
  random?: (bytes: Uint8Array) => Uint8Array;
}): Promise<X402BasePaymentPayload> {
  const requirements = parseX402PaymentRequirements(input.paymentRequirements);
  if (requirements.network !== baseSepoliaNetwork
    || !Number.isSafeInteger(input.nowSeconds)
    || !Number.isSafeInteger(input.expiresAtSeconds)) {
    throw new Error('Checkout is not admitted for Base Sepolia signing.');
  }
  const validAfter = Math.max(0, input.nowSeconds - 30);
  const validBefore = Math.min(
    input.expiresAtSeconds,
    input.nowSeconds + requirements.maxTimeoutSeconds,
  );
  if (validBefore <= input.nowSeconds) {
    throw new CheckoutWalletError('wallet-checkout-expired');
  }

  const account = readAccount(await providerRequest(
    input.provider, { method: 'eth_requestAccounts' }, 'wallet-account-access',
  ));
  if (account.toLowerCase() === requirements.payTo.toLowerCase()) {
    throw new Error('The Base Sepolia payer must differ from the merchant recipient.');
  }
  await switchToBaseSepolia(input.provider);
  const authorization = {
    from: account,
    to: requirements.payTo,
    value: requirements.amount,
    validAfter: String(validAfter),
    validBefore: String(validBefore),
    nonce: randomNonce(input.random),
  };
  const typedData = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    domain: {
      name: requirements.extra.name,
      version: requirements.extra.version,
      chainId: baseSepoliaChainId,
      verifyingContract: requirements.asset,
    },
    message: authorization,
  };
  const signature = await providerRequest(input.provider, {
    method: 'eth_signTypedData_v4',
    params: [account, JSON.stringify(typedData)],
  }, 'wallet-signature-request');
  if (typeof signature !== 'string' || !signaturePattern.test(signature)) {
    throw new CheckoutWalletError('wallet-signature-invalid');
  }
  return {
    x402Version: 2,
    resource: structuredClone(input.resource),
    accepted: requirements,
    payload: { signature, authorization },
  };
}
