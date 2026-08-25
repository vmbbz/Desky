# F4x.2e.1 Netlify HTTPS and PostgreSQL boundary — 2026-08-25

## Result

The first isolated hosted checkout artifact is live at `https://desky-checkout-testnet.netlify.app`. It is an unfunded, non-production testnet shell. It is not wired into Electron and cannot initiate payment because its database and payment configuration are absent.

## Implemented

- Separate `services/commerce-hosted` package and lockfile; Electron has no import to it.
- Minimal accessible checkout shell with hashed local JS/CSS, no third-party or inline execution, testnet labeling, exact authoritative-term rendering, explicit wallet click, pending polling, and safe failure states.
- Root Netlify configuration with explicit monorepo paths, HTTPS headers, same-origin CSP, no framing/referrer, and immutable hashed assets.
- Fixed browser bootstrap/resume/submit Functions and health/readiness probes.
- Streamed 32 KiB request bound before JSON admission; sanitized unavailable errors disclose no configuration or database detail.
- PostgreSQL migration for quote, order, checkout session, attempt, authorization, settlement observation/reference, entitlement, asset-grant, refresh and audit state.
- Async `PostgresCheckoutLedger` with row locks, exact replay, compare-and-swap, unique authorization/provider references, one active attempt per order, monotonic observations, atomic payment preparation, and atomic settled-to-grant commit.
- The pre-existing SQLite and service doubles remain valid because settlement interfaces now accept synchronous or asynchronous implementations.

## Local verification

- Hosted build: passed.
- Netlify offline build: passed; five Functions bundled.
- Hosted typecheck: passed.
- Hosted tests: 2 files, 5 tests passed using the actual migration and PostgreSQL-compatible `pg-mem` adapter.
- Integration flow reached durable settled state and proved stored payloads omit handoff verifier, browser cookie, CSRF token, and wallet signature.
- Root regression: 80 files passed, 6 skipped; 424 tests passed, 10 skipped.
- Root typecheck and lint passed after adding generated-output exclusions.
- Hosted and root production dependency audits report zero vulnerabilities; the known Electron Forge development-tool advisories remain a separate release gate.
- Windows x64 packaging passed. Packaged file listing and binary marker scans found no hosted service, Postgres ledger, browser cookie/API, wallet-signing, settlement-dispatch, or testnet-origin implementation. The ASAR manifest names `@netlify/database` only as a development dependency; no module file or runtime import is packaged.

## Live evidence

- Production testnet URL: `https://desky-checkout-testnet.netlify.app`.
- Current deploy `6a8d91c1e1d636f57503edba` published four static assets and five Functions from the final fail-closed source.
- `/checkout/test` returned HTTPS 200 with same-origin CSP, `Referrer-Policy: no-referrer`, and `X-Frame-Options: DENY`.
- `/healthz`, `/readyz`, and `/v1/browser/bootstrap` returned sanitized 503 responses because runtime prerequisites are absent.
- `DESKY_CHECKOUT_ORIGIN` is configured to the exact Netlify origin. No merchant recipient, facilitator authorization, funded wallet, or payment secret is configured.

## Database blocker

Netlify CLI 27.3.0 recognizes `@netlify/database` and migration `0001_checkout_ledger`, but `createSiteDatabase` returned HTTP 403: the database feature is unavailable for the current team account. No site database or service instance was created. An earlier legacy CLI attempt installed the Neon team extension but created no database/service instance.

Resolution requires one explicit owner decision:

1. upgrade the Netlify team to a plan that admits built-in Database; or
2. supply an approved external managed PostgreSQL service and configure its connection through Netlify's secret environment settings.

Do not replace PostgreSQL with Netlify Blobs, function memory, or SQLite. Those cannot preserve the required transactional payment invariants.

## Remaining F4x.2e gates

- Apply migration 0001 to an admitted hosted PostgreSQL database and prove backup/restore.
- Run true multi-instance concurrency and process-loss tests against that database.
- Implement the authenticated identity/quote/order/session/recovery deployment adapters; no placeholder authenticator is permitted.
- Implement monotonic facilitator/chain reconciliation and alerting without a second settle dispatch.
- Provision owner-authorized Base Sepolia wallet/test assets and merchant recipient.
- Execute success, denial, wrong-chain, insufficient-balance, expiry, replay, timeout, callback-loss, restart, settled-to-grant, delivery, and clean-device restore cases.
- Keep Store profiles free-only and production/mainnet disabled.
