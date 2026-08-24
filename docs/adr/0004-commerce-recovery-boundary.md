# ADR 0004 — Commerce recovery and authorization boundary

## Status

Accepted for the provider-disabled F4x.1 foundation on 2026-08-25.

## Context

Paid companion access must survive an app restart, refresh-key rotation, device replacement, temporary service outage, refund/revocation reconciliation, and signing-key rotation without treating a JWT, renderer cache, wallet callback, or local database as the purchase ledger. Commerce service dependencies must not inflate or create payment authority inside the Electron package.

## Decision

- Hosted service code is isolated under `src/service/commerce` and is absent from Electron's import graph. A framework-neutral HTTP boundary admits only fixed versioned restore/refresh routes. A production repository port requires transactions, compare-and-swap, immutable events, credential digests, reconciliation snapshots, and audit events; a deployment chooses the actual supported database later.
- Main calls one pinned HTTPS origin with fixed paths, no redirects, bounded request/response sizes, exact JSON, `no-store`, and no renderer exposure.
- Clean-device recovery uses a one-time identity-provider authorization code plus PKCE verifier and an idempotency key. The proof is never persisted.
- Refresh credentials rotate on every successful refresh, live only in OS-encrypted storage, and use a deterministic rotation ID. The hosted implementation retains only current/previous digests and the last rotation ID so a crash after server commit can safely replay without storing plaintext.
- Access and offline tokens use separate exact audiences/types. Ed25519 keys arrive through strict HTTPS JWKS with bounded cache/stale windows, overlap rotation, and a release revocation set.
- The signed offline lease is installation-bound, revision-exact, and initially limited to 72 hours. The already verified lease public key is pinned in OS-encrypted state so restart does not require network JWKS. Server time plus system-monotonic elapsed time prevents observed same-boot rollback. A monotonic reset or material wall-clock rollback requires reconnection; Desky does not claim a tamper-proof clock across offline reboot.
- An online response is committed only after access token, lease, account, installation, catalog, exact grants, refresh generation, and reconciliation snapshot agree.

## Consequences

- No checkout, payment provider, merchant secret, wallet key, paid renderer IPC, or authoritative local entitlement is added by this decision.
- A real hosted deployment still needs an identity provider, TLS/domain, production database adapter and migrations, key custody/rotation, backups and restore drills, rate limiting, reconciliation workers, monitoring, incident procedures, and clean-device hardware evidence.
- Base Sepolia work may build against these provider-neutral contracts, but no production or Store commerce becomes reachable until the remaining operational gates pass.
