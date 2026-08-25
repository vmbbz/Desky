import { CheckoutBrowserApiClient } from '../../../src/service/commerce/checkout-browser-api-client';
import type { CheckoutBrowserApiMaterial } from '../../../src/service/commerce/checkout-browser-api-client';
import type { Eip1193Provider } from '../../../src/service/commerce/checkout-browser-wallet-client';
import './browser.css';

declare global {
  interface Window { ethereum?: Eip1193Provider; }
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
const sessionLabel = element<HTMLSpanElement>('session-label');

let client: CheckoutBrowserApiClient | undefined;
let material: CheckoutBrowserApiMaterial | undefined;
let polling: number | undefined;

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
    stopPolling();
    return;
  }
  if (['failed', 'expired', 'cancelled'].includes(next.session.state)) {
    showFailure('This checkout can no longer continue.', 'Return to Desky to start a new checkout.');
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
    startPolling();
    return;
  }
  eyebrow.textContent = 'Terms verified';
  title.textContent = 'Complete in your wallet.';
  lead.textContent = 'Review these exact testnet terms. Your wallet will ask before signing.';
  statusMark.className = 'status-mark';
  pay.disabled = false;
  pay.textContent = 'Connect wallet and pay';
}

function showFailure(heading: string, detail: string): void {
  eyebrow.textContent = 'Checkout unavailable';
  title.textContent = heading;
  lead.textContent = detail;
  statusMark.className = 'status-mark error';
  pay.disabled = true;
  pay.textContent = 'Cannot continue';
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
  if (!client || !window.ethereum) {
    showFailure('No compatible wallet found.', 'Install or enable an EIP-1193 wallet, then reopen this checkout from Desky.');
    return;
  }
  pay.disabled = true;
  pay.textContent = 'Waiting for wallet…';
  void client.signAndSubmit({
    provider: window.ethereum,
    submissionId: `submission:${crypto.randomUUID()}`,
    nowSeconds: Math.floor(Date.now() / 1_000),
  }).then(render).catch(() => {
    eyebrow.textContent = 'Wallet did not complete';
    title.textContent = 'Nothing was approved.';
    lead.textContent = 'No entitlement was granted. You can retry while this checkout remains valid.';
    statusMark.className = 'status-mark error';
    pay.disabled = false;
    pay.textContent = 'Try wallet again';
  });
});

window.addEventListener('pagehide', stopPolling);

try {
  client = new CheckoutBrowserApiClient(location.origin);
  void client.bootstrapFromUrl(location.href).then(render).catch(() => {
    showFailure('This link is incomplete or expired.', 'Return to Desky and reopen the approved checkout.');
  });
} catch {
  showFailure('Checkout configuration is invalid.', 'Return to Desky and try again later.');
}
