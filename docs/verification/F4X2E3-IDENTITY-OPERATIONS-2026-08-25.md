# F4x.2e.3 authenticated identity and operations evidence

Date: 2026-08-25

## Outcome

The isolated testnet service now has a production-shaped authenticated identity/session issuer, server-authoritative quote boundary, recovery and refresh rotation, JWKS discovery, durable rate limits, operator reconciliation visibility, encrypted logical backup/restore, and scheduled structured monitoring. It remains deliberately unfunded and non-payable.

## Implemented boundary

- Supabase Auth validation uses the exact project `GET /auth/v1/user` endpoint with the publishable key, a bounded no-redirect response, and no service-role key.
- Provider subjects are stored only as SHA-256 digests and map to opaque account IDs.
- Identity creation transactionally admits the three existing free avatars and creates an installation, one-time PKCE recovery credential, refresh session, and audit event.
- Ed25519 `desky-access+jwt` and `desky-offline-lease+jwt` issuance matches the strict client verifier; JWKS is served at `/.well-known/jwks.json` with a five-minute rotation cache window.
- Refresh rotation is generation-checked and exact-replay safe. Recovery requires a 256-bit code plus the independent S256 verifier and is one-time except for exact idempotent replay.
- `/v1/quote` accepts only a Desky commerce-scoped access token. The live route returns unavailable because no reviewed `DESKY_BASE_SEPOLIA_OFFER_JSON` exists.
- Checkout creation can atomically promote a matching server order from `created` to `awaiting-approval` only after the canonical human-approval digest is verified.
- Database rate windows are shared across Functions and persist only a hashed client/path key.
- Secret-authenticated operations return non-sensitive counts and a bounded reconciliation queue. A fifteen-minute scheduled monitor emits structured `info | warning | error` facts for migration, pending orders, indeterminate settlement, and age.

## Verification

Hosted package:

- TypeScript: pass.
- Vitest: 4 files, 23 tests passed.
- Authenticated PostgreSQL fixture: three free grants, access/offline signature verification, exact identity replay, generation rotation and replay, one-time clean-device restore, durable rate limit, authoritative quote/order and quote replay all pass.

Live HTTPS/Supabase:

- schema migration version: `2`;
- `/healthz`: `200`;
- `/.well-known/jwks.json`: `200`;
- secret-authenticated `/v1/operations/status`: `200`;
- secret-authenticated `/v1/operations/reconciliation`: one existing indeterminate test record surfaced;
- forged Supabase bearer at `/v1/identity/session`: `401`;
- payment `/readyz`: still `503`, by design;
- paid quote: absent, by design.
- final Netlify production deploy: `6a8da917cf806337e2ada20c`;
- deploy manifest confirms `commerce-monitor` is non-routable and scheduled at `*/15 * * * *`.

Backup/restore drill:

- verified archive: `C:\Users\cosyc\Desky Backups\desky-commerce-20260825-escrowed.dcbackup`;
- encrypted bytes: `9,832`;
- encrypted SHA-256: `d5c9b260765df3b90fd176eef6c90c8784cf137b0327705190a75248fff7b66b`;
- logical SHA-256: `61a86b8d78065162d5c0b0b66466a489d0dff6955cb9b1bee54d10f1acf7bb0d`;
- 14 allowlisted tables restored into an isolated PostgreSQL-compatible database;
- migrations, foreign keys, row counts, AES-256-GCM authentication and canonical logical digest: pass;
- active pilot secret bundle escrow: `C:\Users\cosyc\AppData\Local\Desky\commerce-pilot-secrets.dpapi`, Windows DPAPI/current-user protected, outside the repository. It contains the signing key, credential pepper, operator token and backup key; the unprotected JSON is not retained;
- off-device escrow and paid-plan physical/PITR restore remain production gates.

The live database contained one quote, order, attempt, authorization and unknown settlement observation from the previous two-instance durability proof. No identity, refresh credential, entitlement or asset grant was created by this round's live probes.

Repository/package closure:

- root TypeScript and ESLint: pass;
- root Vitest: 82 files passed, 6 skipped; 442 tests passed, 10 skipped;
- Windows Electron Forge packaging: pass;
- packaged ASAR: 12 entries and zero hosted/PostgreSQL/Supabase/issuer/monitor/backup matches;
- root and hosted production-only npm audits: zero vulnerabilities;
- full root audit: 31 known Electron Forge development-tool advisories, including the current archive-tool critical advisory. npm still proposes incompatible Forge downgrades, so no forced fix was applied and the release-tooling gate remains open.

## Truthful limitations and next gate

- A real Supabase user access token has not been supplied, so the deployed successful identity exchange remains unclaimed. The real verifier is live; local authenticated lifecycle and live forged-token rejection pass.
- Supabase free projects do not provide the paid daily/PITR guarantees used for production recovery. The encrypted logical export is the pilot control. Upgrade and perform a provider-managed restore-to-new-project drill before mainnet.
- Scheduled structured monitoring is live, but no external paging destination or on-call policy exists.
- x402 v2 exposes verify/settle but no admitted standard status route. Unknown/pending work is visible and retry remains blocked; automated reconciliation requires an admitted facilitator status API or independent Base observer.
- The owner password disclosed interactively must be rotated before funded work. Runtime uses a separate least-privilege credential, so rotation does not interrupt it.
- The next gate is the capped funded Base Sepolia matrix after the owner provides/approves the paid pilot product, price, regions, merchant recipient, test wallet funding and facilitator. Success, rejection, malformed payload, insufficient funds, expiry, replay, settle timeout, callback loss, concurrent dispatch, restart and grant/recovery must all be exercised.
