import { CheckoutBrowserApiClient } from '../../../src/service/commerce/checkout-browser-api-client';
import type { CheckoutBrowserApiMaterial } from '../../../src/service/commerce/checkout-browser-api-client';
import {
  CheckoutWalletError,
  type Eip1193Provider,
} from '../../../src/service/commerce/checkout-browser-wallet-client';
import './browser.css';

declare global {
  interface Window { ethereum?: InjectedProvider; }
}
type InjectedProvider = Eip1193Provider & {
  isMetaMask?: boolean;
  isPhantom?: boolean;
  providers?: InjectedProvider[];
};
interface AnnouncedProvider {
  info: { uuid: string; name: string; rdns: string };
  provider: InjectedProvider;
}
const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Checkout document is missing ${id}.`);
  return found as T;
};

const title = element<HTMLHeadingElement>('checkout-title');
const lead = element<HTMLParagraphElement>('lead');
const eyebrow = element<HTMLParagraphElement>('eyebrow');
const statusMark = element<HTMLDivElement>('status-mark');
const terms = element<HTMLDListElement>('terms');
const pay = element<HTMLButtonElement>('pay');
const actionNote = element<HTMLParagraphElement>('action-note');
const sessionLabel = element<HTMLSpanElement>('session-label');
const walletRow = element<HTMLDivElement>('wallet-row');
const walletAccount = element<HTMLElement>('wallet-account');

let client: CheckoutBrowserApiClient | undefined;
let material: CheckoutBrowserApiMaterial | undefined;
let polling: number | undefined;
let connectedWallet: { name: string; provider: Eip1193Provider; account: string } | undefined;
const announcedProviders = new Map<string, AnnouncedProvider>();

window.addEventListener('eip6963:announceProvider', (event: Event) => {
  const detail = (event as CustomEvent<unknown>).detail;
  if (!detail || typeof detail !== 'object') return;
  const candidate = detail as Partial<AnnouncedProvider>;
  if (!candidate.info || typeof candidate.info.uuid !== 'string'
    || typeof candidate.info.name !== 'string' || typeof candidate.info.rdns !== 'string'
    || !candidate.provider || typeof candidate.provider.request !== 'function') return;
  announcedProviders.set(candidate.info.uuid, candidate as AnnouncedProvider);
});
window.dispatchEvent(new Event('eip6963:requestProvider'));

function preferredWallet(): { name: string; provider: Eip1193Provider } | undefined {
  const announced = [...announcedProviders.values()];
  const announcedMetaMask = announced.find(({ info }) => info.rdns === 'io.metamask')
    ?? announced.find(({ info }) => info.name.toLowerCase() === 'metamask');
  if (announcedMetaMask) {
    return { name: announcedMetaMask.info.name, provider: announcedMetaMask.provider };
  }
  const injected = window.ethereum;
  const legacy = injected?.providers ?? (injected ? [injected] : []);
  const legacyMetaMask = legacy.find((provider) => provider.isMetaMask && !provider.isPhantom);
  if (legacyMetaMask) return { name: 'MetaMask', provider: legacyMetaMask };
  if (announced.length === 1) {
    return { name: announced[0].info.name, provider: announced[0].provider };
  }
  if (legacy.length === 1) return { name: 'injected wallet', provider: legacy[0] };
  return undefined;
}

function atomicUsdc(value: string): string {
  const padded = value.padStart(7, '0');
  const whole = padded.slice(0, -6);
  const fraction = padded.slice(-6).replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''} USDC`;
}

function shortAddress(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function render(next: CheckoutBrowserApiMaterial): void {
  material = next;
  element('product').textContent = next.view.productId;
  element('amount').textContent = atomicUsdc(next.view.amountAtomic);
  element('network').textContent = next.view.networkName;
  element('recipient').textContent = shortAddress(next.view.recipient);
  element('expires').textContent = new Date(next.view.expiresAt).toLocaleString();
  terms.hidden = false;
  sessionLabel.textContent = next.session.checkoutSessionId;

  if (next.session.state === 'settled') {
    eyebrow.textContent = 'Payment confirmed';
    title.textContent = 'Your avatar is ready.';
    lead.textContent = 'Return to Desky. It will verify the grant from the authoritative service.';
    statusMark.className = 'status-mark';
    pay.disabled = true;
    pay.textContent = 'Payment confirmed';
    actionNote.textContent = 'The service verified settlement and granted the entitlement.';
    stopPolling();
    return;
  }
  if (['failed', 'expired', 'cancelled'].includes(next.session.state)) {
    showFailure('This checkout can no longer continue.',
      'It cannot be retried or signed. Return to Desky to start a new checkout.');
    stopPolling();
    return;
  }
  if (['signature-submitted', 'authorization-verified', 'settlement-unknown', 'settlement-pending']
    .includes(next.session.state)) {
    eyebrow.textContent = 'Payment processing';
    title.textContent = 'Confirming on Base…';
    lead.textContent = 'Keep this page open. Desky will rely on the service ledger, not this browser, for the final result.';
    statusMark.className = 'status-mark pending';
    pay.disabled = true;
    pay.textContent = 'Confirmation pending';
    actionNote.textContent = 'Do not sign again. Desky is reconciling the submitted authorization.';
    startPolling();
    return;
  }
  eyebrow.textContent = connectedWallet ? 'Ready for approval' : 'Terms verified';
  title.textContent = connectedWallet ? 'Review, then sign.' : 'Connect your wallet.';
  lead.textContent = connectedWallet
    ? 'Check the exact item, total, network, recipient, and paying account. The next action asks MetaMask for a payment signature.'
    : 'Connection reveals only the selected public account and test-USDC balance. It does not approve payment.';
  statusMark.className = 'status-mark';
  pay.disabled = false;
  pay.textContent = connectedWallet
    ? `Sign ${atomicUsdc(next.view.amountAtomic)}`
    : 'Connect MetaMask';
  actionNote.textContent = connectedWallet
    ? 'This is the payment step. MetaMask will show a signature approval request.'
    : 'Connecting a wallet does not approve or send payment.';
  walletRow.hidden = !connectedWallet;
  walletAccount.textContent = connectedWallet ? shortAddress(connectedWallet.account) : '—';
}

function showFailure(heading: string, detail: string): void {
  eyebrow.textContent = 'Checkout unavailable';
  title.textContent = heading;
  lead.textContent = detail;
  statusMark.className = 'status-mark error';
  pay.disabled = true;
  pay.textContent = 'Cannot continue';
  actionNote.textContent = 'No payment or entitlement was created by this page state.';
}

function bootstrapFailureCode(error: unknown): string {
  if (!(error instanceof Error)) return 'client-unknown';
  if (error.message.includes('page URL')) return 'checkout-url';
  if (error.message.includes('handoff URL')) return 'handoff-url';
  if (error.message.includes('handoff fragment')) return 'handoff-fragment';
  if (error.message.includes('request failed')) return 'bootstrap-http';
  if (error.message.includes('response')) return 'bootstrap-response';
  if (error.name === 'TypeError' || error.message.toLowerCase().includes('network')) {
    return 'bootstrap-network';
  }
  if (error.name === 'SecurityError') return 'browser-history';
  return 'client-runtime';
}

function stopPolling(): void {
  if (polling !== undefined) window.clearInterval(polling);
  polling = undefined;
}

function startPolling(): void {
  if (polling !== undefined || !material || !client) return;
  polling = window.setInterval(() => {
    if (!material || !client) return;
    void client.resume(material.session.checkoutSessionId).then(render).catch(() => undefined);
  }, 2_500);
}

pay.addEventListener('click', () => {
  const wallet = preferredWallet();
  if (!client || !wallet) {
    showFailure('No unambiguous compatible wallet found.',
      'Enable MetaMask, then reopen this checkout from Desky. Desky will not guess between multiple wallets.');
    return;
  }
  if (!connectedWallet) {
    pay.disabled = true;
    pay.textContent = `Connecting ${wallet.name}…`;
    actionNote.textContent = 'MetaMask may ask which public account to share. This is not payment approval.';
    void client.connectWallet({
      provider: wallet.provider,
      nowSeconds: Math.floor(Date.now() / 1_000),
    }).then((connected) => {
      connectedWallet = { name: wallet.name, provider: wallet.provider, account: connected.account };
      if (material) render(material);
    }).catch(showWalletFailure);
    return;
  }
  pay.disabled = true;
  pay.textContent = `Waiting for ${connectedWallet.name} signature…`;
  actionNote.textContent = 'Approve only if MetaMask shows the exact testnet payment you reviewed.';
  void client.signAndSubmit({
    provider: connectedWallet.provider,
    expectedAccount: connectedWallet.account,
    submissionId: `submission:${crypto.randomUUID()}`,
    nowSeconds: Math.floor(Date.now() / 1_000),
  }).then(render).catch(showWalletFailure);
});

function showWalletFailure(error: unknown): void {
    const failure = error instanceof CheckoutWalletError ? error.code : 'wallet-client-runtime';
    if (failure === 'wallet-checkout-expired') {
      showFailure('This checkout expired before approval.',
        'It cannot be retried or signed. Return to Desky to start a new checkout.');
      return;
    }
    if (failure === 'wallet-insufficient-usdc') {
      eyebrow.textContent = 'Insufficient test USDC';
      title.textContent = 'This wallet cannot cover the total.';
      lead.textContent = 'No signature was requested and no entitlement was granted. Select a funded Base Sepolia account, then reconnect.';
      statusMark.className = 'status-mark error';
      connectedWallet = undefined;
      walletRow.hidden = true;
      pay.disabled = false;
      pay.textContent = 'Reconnect wallet';
      actionNote.textContent = 'A wallet connection is not payment approval.';
      return;
    }
    eyebrow.textContent = 'Wallet did not complete';
    title.textContent = failure === 'wallet-user-rejected'
      ? 'Signature request cancelled.' : 'Wallet action did not complete.';
    lead.textContent = failure === 'wallet-user-rejected'
      ? 'No payment was submitted and no entitlement was granted.'
      : `No entitlement was granted. Safe diagnostic: ${failure}.`;
    statusMark.className = 'status-mark error';
    pay.disabled = false;
    pay.textContent = connectedWallet ? 'Review and sign again' : 'Reconnect wallet';
    actionNote.textContent = connectedWallet
      ? 'Retrying will open a new MetaMask signature request; it will not submit automatically.'
      : 'Connecting a wallet does not approve or send payment.';
}

window.addEventListener('pagehide', stopPolling);

try {
  client = new CheckoutBrowserApiClient(location.origin);
  void client.bootstrapFromUrl(location.href).then(render).catch((error: unknown) => {
    showFailure('This link is incomplete or expired.',
      `Return to Desky and reopen the approved checkout. Diagnostic: ${bootstrapFailureCode(error)}.`);
  });
} catch {
  showFailure('Checkout configuration is invalid.', 'Return to Desky and try again later.');
}
