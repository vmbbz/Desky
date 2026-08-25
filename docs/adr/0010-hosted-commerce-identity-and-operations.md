# ADR 0010: Hosted commerce identity and operations boundary

Date: 2026-08-25

## Decision

Use Supabase Auth only as the external human identity proof. The hosted Desky service validates the Supabase bearer against the exact project Auth endpoint, maps the provider subject to an opaque Desky account ID, and then issues Desky-owned Ed25519 authorization. Supabase tokens never become entitlement, quote, payment, or asset authority.

Desky session material consists of a ten-minute access JWT, a maximum-72-hour installation-bound offline lease, a rotating refresh credential, and a full reconciliation snapshot. The service persists only keyed credential digests. Initial recovery and refresh secrets are deterministic HMAC outputs under a 256-bit server pepper so an identical idempotent request can recover the identical response without storing plaintext. Recovery also requires the separate S256 proof-key verifier and is consumable once.

The three admitted foundation avatars are granted transactionally when an identity is first created. A paid quote is emitted only when a separately deployed, exact server offer policy exists. The quote binds the account, installation session, region, offer/product/catalog/avatar revisions, five-minute expiry, Base Sepolia network, USDC contract, atomic amount, and merchant recipient. No paid offer is currently configured.

Operational access uses a distinct rotating bearer unavailable to public clients. Fixed endpoints expose bounded health, reconciliation-queue facts, and an AES-256-GCM logical backup. Backups contain an explicit table allowlist and schema version, never health/rate-limit ephemera or wallet signatures. The active pilot key is also protected locally with Windows DPAPI; production requires independent off-device key escrow.

A scheduled Netlify Function evaluates migration state, pending orders, indeterminate settlement count, and maximum reconciliation age every fifteen minutes and writes structured severity events to immutable deploy logs. This is pilot monitoring, not a production paging system.

## Consequences

- Electron continues to verify Desky JWKS, access JWT, offline lease, installation, catalog, and exact grants before persisting refresh state.
- Supabase Data API roles remain unable to access `desky_commerce`; the hosted service retains the least-privilege PostgreSQL login.
- Identity, quote, checkout, restore, refresh, JWKS, operator status, reconciliation queue, backup, browser, liveness, and readiness are separate fixed routes.
- Database-backed per-client/path rate limits work across serverless instances and retain only a SHA-256 client key.
- x402 v2 has no admitted standard settlement-status endpoint. The operator queue can identify and age unknown/pending work, but an automated terminal transition still requires a reviewed facilitator status contract or Base chain observer. The one-shot `/settle` claim is never replayed merely to reconcile.
- A real Supabase user session is still required for the first live identity exchange. Local tests prove the authenticated lifecycle through an injected identity verifier; a forged live bearer is rejected.
- The funded Base Sepolia matrix remains disabled until an owner-approved product/price/regions, merchant recipient, funded test wallet, and facilitator are admitted.

## Rejected alternatives

- Treating a Supabase JWT as a purchase or grant.
- Persisting plaintext recovery or refresh credentials to make retries easy.
- Letting catalog presentation data authorize a charge.
- Retrying `/settle` after an unknown response.
- Public database dumps, unencrypted backup downloads, or a backup key stored only beside its archive.
- Claiming Netlify logs are a production on-call/paging system.
