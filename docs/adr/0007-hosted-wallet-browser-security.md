# ADR 0007 — Hosted wallet browser binding and signed-payload admission

## Status

Accepted for the provider-disabled F4x.2d foundation on 2026-08-25.

## Context

The system browser cannot receive Electron's commerce bearer token or perform an authenticated POST when it opens a checkout page. Treating a checkout identifier as a bearer secret would expose authority through access logs, referrers, history, screenshots, and copied links. A browser cookie alone does not prevent cross-site request forgery, while persisting a raw wallet signature for crash recovery creates unnecessary sensitive payment material. Checkout must also prevent the displayed terms from differing from the EIP-712 values sent to the wallet.

## Decision

- Main generates a random 256-bit browser verifier and sends only its SHA-256 challenge in the authenticated checkout-creation request. The hosted service stores the challenge, never the verifier.
- The service-issued checkout URL remains a non-secret exact HTTPS path. Main appends the verifier as the sole `#handoff=` fragment immediately before opening the system browser. Fragments are not sent in HTTP requests. The hosted page reads it once and removes it from visible history before bootstrap.
- Bootstrap requires exact same-origin request metadata and the verifier. A successful one-time exchange stores only SHA-256 credential/CSRF digests and returns a `__Host-` cookie with `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, no `Domain`, and a separate rotating CSRF token held in page memory.
- Resume and submission require the exact origin, `Sec-Fetch-Site: same-origin`, the bound cookie, and—when mutating payment state—the current CSRF token. Duplicate cookies, header injection, wrong origin, unknown fields, stale tokens, and crossed session identity fail closed.
- The page displays the same exact amount, CAIP-2 network, asset contract, recipient, session expiry, product, and avatar revisions that are used to build the x402 requirements. The client rechecks display-to-signing equality before requesting a signature.
- Wallet signing uses injected EIP-1193 only after an explicit user action. It switches to Base Sepolia and requests the exact EIP-712 `TransferWithAuthorization` for EIP-3009 USDC. Desky never requests or receives a seed phrase/private key and does not silently add a network/RPC configuration.
- Opening/bootstrap creates no payment attempt. Only a strictly admitted signed payload first records an opaque submission ID, canonical payload digest, and 15-second processing lease, then atomically prepares the order/attempt and enters verify/settle.
- Raw signatures are never persisted. An exact resubmission may reclaim an expired processing lease; a changed submission ID or payload digest is rejected. F4x.2c's durable one-shot settlement claim remains the final duplicate-charge control if processes overlap.
- Browser/ledger results project back to the authenticated desktop status route. A browser response or wallet callback alone is never payment truth.
- All modules remain hosted-service/browser-source only, unwired from Electron IPC and absent from current packaged applications.

## Consequences

- A production deployment needs a dedicated hosted web build, TLS/domain, CSP-hashed assets, rate limits, bot/abuse controls, real identity, cookie-key/secret rotation policy, and browser/wallet compatibility evidence.
- Browser crash before submission is harmless. Crash after submission requires exact payload resubmission while its authorization remains valid or manual restart with a new checkout; the settlement ledger prevents a second broadcast.
- A copied base checkout URL has no browser authority. A copied fragment remains a short-lived bearer proof and must be treated as sensitive until consumed.
- The local matrix proves protocol and lifecycle behavior with deterministic wallets/facilitators only. No funded payment or production admission is implied.
