# F4x.1c commerce recovery boundary — 2026-08-25

## Result

The provider-disabled commerce foundation now has a production-shaped hosted-service boundary, strict recovery and refresh contracts, rotating Ed25519 JWKS admission, OS-encrypted refresh state, installation-bound offline leases, reconciliation-before-persistence, and clean-device restoration. This is verified local architecture and contract evidence, not evidence of a deployed commerce service or a production payment rail.

## Implemented boundary

- The hosted service owns authoritative transactional repository ports for quotes, orders, attempts, immutable events, grants, rotating refresh-credential digests, reconciliation snapshots, and audit events.
- Its framework-neutral HTTP adapter admits only fixed versioned restore and refresh routes with exact JSON, bounded bodies, `no-store`, and sanitized errors.
- The desktop client admits one exact HTTPS service origin, fixed paths, no redirects, bounded responses, strict media type, and request timeouts.
- Access tokens and offline leases use separate exact types and audiences. Only admitted Ed25519 signing keys from strict JWKS are accepted.
- JWKS supports bounded cache lifetimes, overlap rotation, unknown-key refresh, a release revocation set, and bounded stale use during service outage.
- Refresh credentials remain in the existing Electron `safeStorage`-backed vault. Every refresh rotates the credential and generation using compare-and-swap plus a deterministic replay ID.
- A clean-device restore requires a one-time identity authorization code, PKCE verifier, installation binding, and idempotency key. Recovery proof and access tokens are not persisted.
- An online result is persisted only after the access token, signed offline lease, account, installation, catalog, exact active grants, refresh generation, and reconciliation snapshot agree.
- Offline access is limited by an installation-bound lease with a default maximum lifetime of 72 hours. The admitted lease verification key is pinned in encrypted state so a restart remains genuinely offline. Material wall-clock rollback or system-monotonic reset requires reconnection.

## Verification

- `npm test`: 66 files passed, 6 skipped; 350 tests passed, 10 skipped.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm audit --omit=dev`: zero vulnerabilities.
- `npm run package`: Windows x64 package completed.
- Webpack and packaged ASAR inspection found no hosted-service, recovery coordinator, JWKS, offline-lease, or SQLite commerce implementation in the Electron artifact.
- The full development audit still reports 31 upstream development-tool advisories: 3 low, 3 moderate, 24 high, and 1 critical.

The commerce-specific matrix covers malformed and oversized payloads, redirects, wrong content types, JWKS rotation/overlap/stale/revocation, wrong signatures and installation IDs, lease lifetime and clock anomalies, vault compare-and-swap, stale refresh responses, reconciliation mismatch, deterministic refresh replay, and offline restart while JWKS is unavailable.

## Not yet proved

- No production database adapter, schema migration, or multi-instance concurrency test has run.
- No service is deployed behind a real domain, TLS ingress, identity provider, managed signing-key custody, rate limiter, reconciliation worker, monitoring, backup, or restore drill.
- No clean-device test has run across two physical Windows installations or macOS Keychain hardware.
- No Base Sepolia transaction, facilitator, wallet, or settlement callback is connected yet.
- Commerce remains disabled in release profiles. This gate does not authorize Store or production payment exposure.

## Next gate

F4x.2 starts the isolated Base Sepolia x402 v2 pilot against these provider-neutral contracts: exact network/asset/recipient allowlists, USDC atomic amounts, expiring quotes, user-owned payment initiation, verifier/facilitator normalization, idempotent settlement ingestion, reconciliation, and grant issuance. Production and Microsoft Store exposure remain separate later gates.
