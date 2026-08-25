# F4x.2e.5 live identity and payment-readiness evidence — 2026-08-25

## Result

The isolated Base Sepolia pilot is now identity-authenticated, offer-bound, operationally clean, and ready for a separately funded payer. This record does **not** claim a funded transaction, mainnet admission, Store commerce, or production operations.

Final hosted deploy: `6a8e087f789c7eef22bab5a6` at `https://desky-checkout-testnet.netlify.app`.

## Real identity and custody

- Created one dedicated confirmed Supabase pilot user through the project admin boundary.
- Authenticated that user through the public password-grant endpoint with the project's publishable key.
- Exchanged the resulting app bearer at `POST /v1/identity/session`.
- Desky issued one opaque commerce account and exactly three free avatar grants.
- Live refresh rotations advanced generation 1 to 2 to 3 without losing grants.
- Provider credentials, Desky recovery material, refresh material, access tokens, and proof-key verifier are encrypted with Windows current-user DPAPI at `C:\Users\cosyc\AppData\Local\Desky\commerce-pilot-app-user.dpapi`.
- No raw credential, wallet secret, token, or downloaded avatar binary entered Git, logs, this record, or chat output.

## Exact admitted offer

- offer: `offer.avatar.toothpaste.base-sepolia-pilot`, revision 1;
- product: `avatar.toothpaste`, revision 1;
- avatar revision: `toothpaste-6dc38124-v1`;
- catalog: `desky-paid-pilot:1`;
- region: `ZA`;
- release profile: `windows-direct`;
- amount: `100000` atomic test USDC, displayed as 0.10 USDC;
- network: `eip155:84532`;
- asset: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`;
- merchant: `0x4f9c8Ea2a0e77338d41d5438F319617E2e95D7c3`.

The offer recipient and runtime merchant are byte-for-byte equal. The public x402 facilitator advertises v2 `exact` Base Sepolia support, and the independent Base observer health check passes.

## Live matrix

| Check | Result |
|---|---|
| `/healthz` | 200 |
| `/readyz` | 200 only after identity and exact configuration |
| JWKS | 200, Ed25519 signing key published |
| real Supabase password grant | passed |
| Desky identity exchange | passed; three free grants |
| expired access-token recovery | refresh rotation passed |
| exact quote | passed |
| identical quote replay | byte-equivalent response |
| forged commerce bearer | 401 |
| unadmitted `US` region | 401 |
| checkout create/replay | `ready`, exact replay |
| changed canonical terms digest | 409 |
| checkout cancel/status | `cancelled` persisted |
| wallet opened / signature submitted | false / false |
| operations after closure | 1 identity, 1 active refresh session, 0 pending orders |
| reconciliation after closure | 0 indeterminate items, empty queue |

## Defects caught and closed

The first post-identity backup correctly failed its isolated restore digest. PostgreSQL exported `commerce_refresh_sessions.generation` bigint as a decimal string, while pg-mem returned the same safe integer as a number. The backup format now normalizes only declared bigint columns to canonical decimal strings and rejects negative, fractional, leading-zero, or unsafe representations. A regression suite covers bigint equivalence, invalid coercions, and generated-sequence exclusion.

The non-funded cancellation also revealed that a checkout session could become terminal while its approved order remained pending. Checkout session cancellation/expiry and order closure are now one store transaction in SQLite and PostgreSQL. Idempotent cancellation repairs a previously terminal session safely. The initial multi-instance `verification:` settlement record was preserved as evidence but terminalized by an auditable Supabase migration; future live verification runs terminalize their own attempt/order.

## Backup and operational evidence

- encrypted archive: `C:\Users\cosyc\Desky Backups\desky-commerce-20260825-212817.dcbackup`;
- encrypted bytes: `22031`;
- encrypted SHA-256: `c2f5cfa9042b1e05be8b0e400312d9a696f40feb338164ca3b4146d59024b463`;
- logical SHA-256: `e40425ded0c1a6abf9804a7a09d15bbfdebc6e245801569d827ea334eedfc5ab`;
- tables: 14; logical rows: 21;
- AES-256-GCM authentication, migration replay, foreign-key inserts, canonical logical digest: `restore: verified`.

## Repository verification

- root Vitest: 456 passed, 10 skipped;
- hosted-service Vitest: 26 passed;
- root and hosted TypeScript checks: passed;
- ESLint: passed;
- hosted browser build: passed;
- Windows x64 Electron Forge packaging: passed;
- root production dependency audit: 0 vulnerabilities across 153 production dependencies;
- hosted production dependency audit: 0 vulnerabilities across 15 production dependencies.

The existing Electron Forge development-tool advisory gate is unchanged; no incompatible forced downgrade was used.

## Remaining funded gate

1. Use a MetaMask account different from the merchant and provide only its public `0x...` address.
2. Fund that payer with Base Sepolia test USDC; test ETH alone is insufficient for the quoted asset.
3. Generate a fresh five-minute quote and checkout session.
4. Human reviews Toothpaste, 0.10 USDC, Base Sepolia, exact USDC contract, merchant, and expiry, then approves the EIP-712 signature.
5. Verify success plus wrong account/network, rejection, expiry, duplicate/replay, callback-loss/unknown, restart, three-confirmation observer closure, atomic grant, refresh, and clean-device restoration.
6. Capture the transaction hash and explorer evidence without recording wallet secrets.

Mainnet, worldwide selling, Store commerce, and production readiness remain blocked by the existing legal, infrastructure, custody, paging, tax/refund, and release-profile gates.
