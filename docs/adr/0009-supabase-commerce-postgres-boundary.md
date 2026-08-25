# ADR 0009 — Supabase commerce PostgreSQL boundary

## Status

Accepted and implemented for the unfunded F4x.2e.2 testnet service on 2026-08-25.

## Context

Netlify's built-in Database product was unavailable to the current team, while the hosted checkout
requires durable transactional state shared by independent Function instances. Supabase is suitable
as managed PostgreSQL, but its default `public` schema and owner credentials are not an acceptable
commerce-service boundary.

## Decision

- Keep Netlify as the isolated HTTPS page/Functions host and use the dedicated Supabase `Desky`
  project (`autiwuczcroazwwhkaqp`, `eu-west-1`, PostgreSQL 17) only as managed PostgreSQL.
- Put all commerce objects in the non-exposed `desky_commerce` schema. Revoke `PUBLIC` schema
  access and grant only `SELECT`, `INSERT`, and `UPDATE` plus sequence use to the dedicated
  `desky_checkout_runtime` login. The `anon`, `authenticated`, and `service_role` roles receive no
  schema access. Desky does not use Supabase's Data API, Auth, Storage, Realtime, or client SDK.
- Apply versioned schema changes through the linked Supabase CLI migration path. Runtime Functions
  use Supavisor transaction mode on port 6543, never the migration/owner connection. Queries are
  unnamed and compound operations use explicit database transactions and row locks.
- Require an exact project-ref match, an exact Supabase pooler host/port/database, no connection-URL
  query options, and a separately supplied CA. Supabase SSL enforcement is enabled. The admitted
  Supabase Root 2021 CA is pinned by SHA-256 and full certificate/hostname verification remains on.
- Store the generated runtime connection and CA only in production-scoped Netlify environment
  secrets. The project-owner password is neither deployed nor stored in the repository.
- Make liveness depend only on the writable schema/migration. Readiness additionally requires the
  admitted facilitator and merchant configuration, so an operational database cannot accidentally
  make the payment surface ready.
- Keep the Supabase workspace, migrations, PostgreSQL driver, and all hosted runtime code outside
  Electron's production dependency and import graphs.

## Consequences

- Independent Functions now share durable checkout truth, and the real two-instance dispatch test
  proves that only one process can acquire a settlement dispatch claim.
- `https://desky-checkout-testnet.netlify.app/healthz` is healthy. `/readyz` remains fail-closed
  until the merchant/facilitator admission gate; the deployment is still unfunded and non-payable.
- The Supabase CA must be deliberately rotated before its 2031 expiry through a reviewed code/config
  update. The project-owner database password disclosed during interactive setup must be rotated;
  this does not affect the dedicated Netlify runtime credential.
- Production admission still requires backups/restore evidence, monitoring/alerts, identity and
  authenticated quote/session/recovery routes, reconciliation workers, key custody, and the funded
  Base Sepolia matrix.
