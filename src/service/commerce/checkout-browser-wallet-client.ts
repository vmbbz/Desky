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
  | 'wallet-account-changed'
  | 'wallet-network-switch'
  | 'wallet-network-add'
  | 'wallet-balance-read'
  | 'wallet-insufficient-usdc'
  | 'wallet-signature-request'
  | 'wallet-signature-invalid'
  | 'wallet-checkout-expired';

export class CheckoutWalletError extends Error {
  constructor(readonly code: CheckoutWalletFailureCode) {
    super(code === 'wallet-account-access'
      ? 'Wallet returned an invalid or ambiguous account selection.'
      : code === 'wallet-account-changed'
        ? 'The selected wallet account changed after review.'
      : code === 'wallet-checkout-expired'
        ? 'Checkout authorization has expired.'
        : code === 'wallet-insufficient-usdc'
          ? 'The selected wallet does not have enough Base Sepolia test USDC.'
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
const quantityPattern = /^0x[0-9a-fA-F]+$/;

export interface ConnectedCheckoutWallet {
  account: string;
  balanceAtomic: string;
  sufficient: true;
}

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

function balanceOfCall(account: string): string {
  return `0x70a08231${account.slice(2).toLowerCase().padStart(64, '0')}`;
}

async function requireSufficientBalance(
  provider: Eip1193Provider,
  asset: string,
  account: string,
  amountAtomic: string,
): Promise<string> {
  const value = await providerRequest(provider, {
    method: 'eth_call',
    params: [{ to: asset, data: balanceOfCall(account) }, 'latest'],
  }, 'wallet-balance-read');
  if (typeof value !== 'string' || !quantityPattern.test(value) || value.length > 66) {
    throw new CheckoutWalletError('wallet-balance-read');
  }
  let balance: bigint;
  try { balance = BigInt(value); } catch { throw new CheckoutWalletError('wallet-balance-read'); }
  if (balance < BigInt(amountAtomic)) {
    throw new CheckoutWalletError('wallet-insufficient-usdc');
  }
  return balance.toString();
}

function assertSigningWindow(
  nowSeconds: number,
  expiresAtSeconds: number,
  maxTimeoutSeconds: number,
): { validAfter: number; validBefore: number } {
  if (!Number.isSafeInteger(nowSeconds) || !Number.isSafeInteger(expiresAtSeconds)) {
    throw new Error('Checkout is not admitted for Base Sepolia signing.');
  }
  const validAfter = Math.max(0, nowSeconds - 30);
  const validBefore = Math.min(expiresAtSeconds, nowSeconds + maxTimeoutSeconds);
  if (validBefore <= nowSeconds) throw new CheckoutWalletError('wallet-checkout-expired');
  return { validAfter, validBefore };
}

/**
 * Connects and preflights the selected account without requesting a payment signature.
 * The balance read improves UX only; facilitator verification remains authoritative.
 */
export async function connectBaseSepoliaCheckoutWallet(input: {
  provider: Eip1193Provider;
  paymentRequirements: unknown;
  nowSeconds: number;
  expiresAtSeconds: number;
}): Promise<ConnectedCheckoutWallet> {
  const requirements = parseX402PaymentRequirements(input.paymentRequirements);
  if (requirements.network !== baseSepoliaNetwork) {
    throw new Error('Checkout is not admitted for Base Sepolia signing.');
  }
  assertSigningWindow(
    input.nowSeconds, input.expiresAtSeconds, requirements.maxTimeoutSeconds,
  );
  const account = readAccount(await providerRequest(
    input.provider, { method: 'eth_requestAccounts' }, 'wallet-account-access',
  ));
  if (account.toLowerCase() === requirements.payTo.toLowerCase()) {
    throw new Error('The Base Sepolia payer must differ from the merchant recipient.');
  }
  await switchToBaseSepolia(input.provider);
  const balanceAtomic = await requireSufficientBalance(
    input.provider, requirements.asset, account, requirements.amount,
  );
  return { account, balanceAtomic, sufficient: true };
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
  expectedAccount?: string;
  random?: (bytes: Uint8Array) => Uint8Array;
}): Promise<X402BasePaymentPayload> {
  const requirements = parseX402PaymentRequirements(input.paymentRequirements);
  if (requirements.network !== baseSepoliaNetwork) {
    throw new Error('Checkout is not admitted for Base Sepolia signing.');
  }
  const { validAfter, validBefore } = assertSigningWindow(
    input.nowSeconds, input.expiresAtSeconds, requirements.maxTimeoutSeconds,
  );

  const account = readAccount(await providerRequest(
    input.provider,
    { method: input.expectedAccount ? 'eth_accounts' : 'eth_requestAccounts' },
    'wallet-account-access',
  ));
  if (input.expectedAccount && account.toLowerCase() !== input.expectedAccount.toLowerCase()) {
    throw new CheckoutWalletError('wallet-account-changed');
  }
  if (account.toLowerCase() === requirements.payTo.toLowerCase()) {
    throw new Error('The Base Sepolia payer must differ from the merchant recipient.');
  }
  await switchToBaseSepolia(input.provider);
  await requireSufficientBalance(input.provider, requirements.asset, account, requirements.amount);
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
