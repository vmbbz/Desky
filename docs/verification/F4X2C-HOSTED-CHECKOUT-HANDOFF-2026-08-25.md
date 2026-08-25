# F4x.2c hosted checkout and non-custodial handoff — 2026-08-25

## Result

Desky now has a provider-disabled, service-first checkout boundary that preserves human authority and wallet non-custody. A single exact-terms approval can create one short-lived, authenticated hosted session and open one exact system-browser URL. The service reloads the authoritative quote/order and independently verifies their canonical digest. Signed x402 payloads remain ephemeral service inputs, and only the atomic winner of a durable pre-settlement claim may call the facilitator `/settle` operation.

No paid provider, wallet page, renderer/main commerce IPC, funded payment, or Store commerce capability was enabled.

## Implemented invariants

- Exact versioned checkout create/status/cancel/session parsers reject unknown fields, malformed identities, approval lifetime over two minutes, session lifetime over ten minutes, credential-bearing/query/fragment URLs, and inconsistent terminal state.
- The main coordinator admits only an active authoritative `windows-direct` x402 Base USDC quote and matching `awaiting-approval` order. Its prompt contains the exact amount, network, asset, recipient, grant revisions, and expiry.
- Approval IDs are process-single-use even after cancellation. Checkout creation receives a canonical SHA-256 quote/order terms digest and a separate access token; the token never enters the request body, URL, session, or stored record.
- The client uses fixed HTTPS JSON routes, no redirect acceptance, bounded responses, exact same-origin `/checkout/{sessionId}` URLs, and header-injection rejection.
- Browser failure returns a typed recoverable error carrying the already-created non-secret session. Explicit reopen does not recreate approval or order state.
- The hosted service re-authenticates account and installation, reloads quote/order, recomputes the terms digest, enforces approval/quote expiry, and persists uniqueness over session ID, approval ID, and account/idempotency key.
- Status and cancellation are account/installation-bound. Cancellation is accepted only before authorization; expired pre-authorization sessions project to `expired` on read.
- The x402 processor strictly re-admits requirements and payload, verifies through the facilitator, and persists only immutable authorization facts—not the wallet signature.
- Before `/settle`, SQLite atomically records a deterministic `settlement-dispatching` unknown observation and returns a one-shot dispatch claim. Exact replay or another claimant receives no second claim.
- Timeout, crash, malformed/incomplete pending result, or other exception after dispatch remains unknown for reconciliation. Explicit invalid verification fails before dispatch. Referenced pending and exact settled results append monotonically through the F4x.2b ledger.

## Verification

- Focused checkout/commerce/x402 matrix: 7 files, 31 tests passed.
- `npm test`: 73 files passed, 6 skipped; 403 tests passed, 10 skipped.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm audit --omit=dev`: zero vulnerabilities.
- `npm run package`: Windows x64 package completed.
- Webpack and packaged ASAR content inspection found no checkout route, checkout client/coordinator, hosted session service, x402 processor, or `settlement-dispatching` marker in Electron.

ADR 0006 records the non-custodial checkout and one-shot dispatch decision.

## Not yet proved

- There is no deployed hosted API, production database adapter, TLS/domain, real identity provider, native approval presenter, or direct-build capability admission.
- There is no hosted wallet page, CSRF/session-cookie implementation, reviewed wallet adapter, real signed payload, funded Base Sepolia payment, or callback.
- Checkout-session state is not yet projected from processor/reconciliation results into a live UI; only the settlement ledger is authoritative.
- Multi-process/database claim races, service crash injection around every transaction boundary, reconciliation workers, chain-finality policy, metrics/alerts, and incident disable remain unproved.
- No production facilitator, merchant recipient/custody decision, tax/legal operating scope, or mainnet rail is selected.
- The initial Microsoft Store and Mac App Store profiles remain free-only and contain no reachable x402 implementation.

## Next gate

F4x.2d implements the hosted wallet page and CSRF-bound signed-payload submission, projects authoritative checkout status from the reconciliation ledger, and runs the funded Base Sepolia matrix: success, human rejection, malformed signature, insufficient funds, expiry, replay, duplicate/concurrent dispatch, settle timeout, callback loss, process restart, settled-to-grant, and clean-device restoration. Production admission remains a later owner/legal/operations gate.
