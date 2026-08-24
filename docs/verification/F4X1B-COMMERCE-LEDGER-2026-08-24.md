# F4x.1b authoritative quote and ledger verification — 2026-08-24

## Scope

This round advances the provider-disabled entitlement foundation. It does not add a wallet, facilitator, blockchain SDK, checkout UI, paid renderer IPC, merchant configuration, or production service deployment.

Implemented:

- strict authoritative quote contract binding account, offer/product/catalog/avatar revisions, release profile, region, provider, atomic amount, issue/expiry, and exact x402 network/asset/recipient terms;
- quote-bound order and payment-attempt contracts;
- strict asset-grant contract binding a ledger event to exact deliverable revisions;
- service-side SQLite conformance repository with strict tables, foreign/unique constraints, WAL, full synchronization, bounded busy handling, compare-and-swap transitions, and exact replay behavior;
- an atomic verified-settlement transaction that either updates payment/order and appends entitlement/grant together or rolls everything back;
- immutable provider references learned at verification, quote-expiry enforcement, close/reopen durability, and collision/idempotency tests;
- Microsoft Store x402 policy evidence and a free-only initial Store posture.

## Verification result

Commands run from `C:\dev-shared\desky`:

```text
npm test
  60 test files passed, 6 skipped
  328 tests passed, 10 skipped

npm run typecheck
  passed

npm run lint
  passed

npm audit --omit=dev
  0 vulnerabilities

npm audit
  31 development-tool advisories: 3 low, 3 moderate, 24 high, 1 critical

npm run package
  Windows x64 package passed
```

The focused commerce suite contains 39 passing tests across contract, access-token, and transactional-ledger behavior. The package import graph was inspected after packaging: `SqliteCommerceLedger`, `node:sqlite`, its SQL schema, and `src/service` are absent from the webpack bundles and packaged ASAR listing. The conformance repository therefore does not create a local desktop payment authority.

Node 22 labels built-in SQLite experimental. This is acceptable only for the non-shipping conformance adapter. It is not approval for a hosted production database choice.

The full-audit findings remain in Electron Forge's development archive/dev-server dependency chain. No incompatible forced downgrade was applied; this stays an upstream/release-tooling gate while the shipped production dependency graph remains at zero reported vulnerabilities.

## Proven failure behavior

- missing x402 network, asset, or recipient fails parsing;
- chain settlement fields on a native-store quote fail parsing;
- unsafe/float/zero/negative atomic values fail parsing;
- order terms drifting from the stored authoritative quote fail;
- duplicate account/idempotency intent cannot create a second order;
- a provider reference cannot be claimed at attempt creation or changed after verification;
- settlement at quote expiry fails;
- a grant with a different account/product/product revision/catalog/avatar revision/event/time/expiry/state fails;
- a failed settlement leaves order, payment attempt, event ledger, and asset grants unchanged;
- exact settlement retry returns the committed objects without a duplicate event or grant;
- close/reopen returns the exact granted order, settled attempt, event, and asset grant.

## Remaining F4x.1 exit work

1. Hosted authenticated commerce-service API and production transactional repository adapter.
2. Schema migrations, backups, restore drills, multi-instance concurrency, audit export, and reconciliation workers.
3. HTTPS JWKS retrieval/cache/rotation/revocation and OS-vault rotating refresh credentials.
4. Signed bounded offline lease with trusted-time and clock-anomaly behavior.
5. Clean-device account restore, refund/revoke/support/takedown reconciliation, and delivery-failure recovery.
6. Operational ownership for identity, tax, legal regions, refunds, facilitator, merchant custody, privacy, and support.

Only after these exits does F4x.2 begin with an allowlisted Base Sepolia x402 v2 adapter. Microsoft Store x402 remains a separate later certification gate; the direct Windows profile is the first candidate pilot.
