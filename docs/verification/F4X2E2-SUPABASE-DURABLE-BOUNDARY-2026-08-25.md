# F4x.2e.2 Supabase durable boundary — 2026-08-25

## Scope

This record covers the isolated unfunded Base Sepolia checkout service only. It does not admit a
merchant, facilitator credential, funded wallet, desktop payment route, or Store commerce profile.

## Provisioned boundary

- Supabase project: `Desky` / `autiwuczcroazwwhkaqp`
- Region/database: `eu-west-1`, PostgreSQL `17.6.1.165`
- Canonical migration: `supabase/migrations/20260825000100_checkout_ledger.sql`
- Private schema: `desky_commerce`
- Runtime login: `desky_checkout_runtime`
- Runtime transport: Supavisor transaction pooler, TLS only, CA and hostname verified
- Supabase Root 2021 CA file SHA-256:
  `700723581420DD1AC98FD7E9AC529F0EF210EADCAF87FC868A3AD7D114C2F3B7`
- Netlify production deploy: `6a8d99c25b8993feb4a3bc4a`

The migration applied successfully and Supabase SSL enforcement was enabled. Privilege verification
confirmed that the runtime role has schema use and required table operations, while `anon`,
`authenticated`, and `service_role` have no `desky_commerce` schema access. Netlify holds only the
generated runtime URL and pinned CA; it does not hold the project-owner password.

## Real database evidence

The live verification runner opened two independent one-connection pools against Supabase, wrote a
fresh quote/order/attempt/authorization, and raced the identical durable settlement-dispatch claim.
The dispositions were exactly `[false, true]`: one instance acquired the claim and the other returned
the persisted exact replay. A separate read observed `settlement-dispatching` as durable `unknown`
state. Migration version `1` was writable.

This is deliberately not a funded settlement. The verification record remains in the append-only
testnet ledger; no wallet signature or secret was stored.

## Live HTTPS evidence

- `GET /healthz` returned `200 {"schemaVersion":1,"status":"ok"}`.
- `GET /readyz` returned sanitized `503 temporarily-unavailable`, as required while merchant and
  facilitator settings are absent.
- `POST /v1/browser/bootstrap` also remained sanitized `503`; database health alone did not expose
  checkout creation.
- The checkout page remains reachable over HTTPS with the existing strict CSP and testnet language.
- Function URLs use their declared clean routes (`/healthz`, `/readyz`, and `/v1/browser/*`), not the
  legacy `/.netlify/functions/*` aliases.

## Local verification

- Hosted build, TypeScript, dependency audit, and 19 tests pass.
- Root TypeScript and lint pass.
- Root suite: 438 passed, 10 skipped.
- Root and hosted production dependency audits report zero vulnerabilities.
- Windows x64 packaging passes. The ASAR has 12 runtime entries and contains no hosted workspace,
  PostgreSQL adapter/driver, database environment name, project ref, private schema, or x402 runtime.
  The only generic `supabase` text is Desky's existing credential-scanner rule for detecting and
  redacting Supabase secrets; it is not an integration or credential.

## Remaining gates

1. Rotate the interactively disclosed Supabase project-owner password; runtime traffic is unaffected.
2. Add authenticated identity, quote/session/recovery routes and reconciliation operations.
3. Add backup/restore, alerting, rate limiting, operational runbooks, and clean-device evidence.
4. Admit merchant/facilitator configuration only after those controls pass.
5. Execute the capped funded Base Sepolia matrix; do not promote this testnet deployment to mainnet.
