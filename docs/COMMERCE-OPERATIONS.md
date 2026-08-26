# Commerce pilot operations

This runbook applies only to the isolated Base Sepolia service at `https://desky-checkout-testnet.netlify.app`. It does not authorize mainnet or Store commerce.

## Current authorities

- Supabase owns PostgreSQL/Auth availability and the private `desky_commerce` schema.
- Netlify owns immutable Function deploys, production environment secrets, logs, metrics and the scheduled monitor.
- The Windows reference device has a current-user DPAPI escrow at `C:\Users\cosyc\AppData\Local\Desky\commerce-pilot-secrets.dpapi`.
- The real pilot app-user/session state has a separate current-user DPAPI escrow at `C:\Users\cosyc\AppData\Local\Desky\commerce-pilot-app-user.dpapi`.
- The current post-expiry encrypted logical archive is `C:\Users\cosyc\Desky Backups\desky-commerce-20260826-011639.dcbackup` (SHA-256 `06b8f8c49c7644d4b7cbaa2ca67c234710f47422203aedf45193a7ce1e1d2376`).

The DPAPI bundle is usable only by the same Windows user context. Before a funded or multi-user pilot, copy the four secrets into an approved off-device secret manager with audited recovery access. Do not copy plaintext into this repository, issue trackers, chat, CI logs or a backup directory.

## DPAPI recovery for an operator session

Run this only in a private PowerShell session. It places secrets in process memory/environment for the command lifetime; close the terminal afterward.

```powershell
$bundlePath = 'C:\Users\cosyc\AppData\Local\Desky\commerce-pilot-secrets.dpapi'
$protected = [System.IO.File]::ReadAllBytes($bundlePath)
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect(
  $protected,
  $null,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
$pilot = [System.Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json
[Array]::Clear($plain, 0, $plain.Length)
```

Never print `$pilot` or enable PowerShell transcription while it exists.

## Liveness, payment readiness and reconciliation

- `GET /healthz` proves schema write/read liveness and must return 200.
- `GET /readyz` proves the entire payment dependency set. It became 200 only after the app-user exchange passed and the exact offer, merchant, facilitator, and observer were admitted. Any later 503 closes funded testing immediately.
- `GET /v1/operations/status` requires `Authorization: Bearer $pilot.operatorToken` and returns only bounded counts.
- `GET /v1/operations/reconciliation` uses the same operator bearer and returns a maximum 100 non-sensitive unknown/pending/settled-but-ungranted queue entries.

Never retry `/settle` merely because an attempt is unknown. The admitted Base Sepolia observer searches the exact USDC `AuthorizationUsed(payer, nonce)` event, validates one successful receipt and exact `Transfer(payer, recipient, amount)`, waits for three confirmations, appends monotonic evidence, and invokes the atomic paid-grant transaction. Absence remains unresolved; mismatch is an error. A manual database edit is not reconciliation.

The non-public `commerce-monitor` Function runs every fifteen minutes, processes at most 25 reconciliation candidates, and expires at most 100 quote-only `created`/`awaiting-approval` orders per pass after their authoritative quote expires. It never sweeps an order that acquired a checkout session and never closes an in-flight settlement. Direct public invocation returns 403. `DESKY_BASE_SEPOLIA_RPC_URL` is configured to the public Base Sepolia RPC for the capped pilot; it is not production infrastructure. Five-minute reconciliation age or observer validation error is an error; any indeterminate item is a warning. Netlify logs/Observability are pilot diagnostics. Production requires two independently operated authenticated RPC paths, external paging, a named on-call owner, acknowledgement target and escalation policy.

## Capped Toothpaste offer

The only admitted paid-pilot product is:

- product: `avatar.toothpaste`, revision 1;
- avatar revision: `toothpaste-6dc38124-v1`;
- offer: `offer.avatar.toothpaste.base-sepolia-pilot`, revision 1;
- catalog: `desky-paid-pilot:1`;
- price: `100000` atomic Base Sepolia test USDC (displayed as 0.10 USDC);
- release profile: `windows-direct` only;
- facilitator: public x402.org test facilitator, Base Sepolia only;
- merchant: `0x4f9c8Ea2a0e77338d41d5438F319617E2e95D7c3`, the owner-provided dedicated test receive address.

The code admits the exact product/revision/price; environment can choose only the merchant recipient and explicit two-letter pilot regions. Initial funded proof uses `ZA`. “Worldwide” is a product intent, not a truthful legal setting: mainnet launch requires a reviewed country allowlist, sanctions/tax/refund handling and merchant-of-record decision.

The prerequisite passed on 2026-08-25: a dedicated confirmed Supabase pilot user completed the public password grant, its bearer completed `/v1/identity/session`, and Desky issued three free grants. Only then were `DESKY_BASE_SEPOLIA_OFFER_JSON` and `DESKY_MERCHANT_RECIPIENT` configured. The two recipient fields remain byte-for-byte equivalent. The reusable provider and Desky credentials are DPAPI-protected outside the repository; dashboard/CLI login is still not an app bearer.

The live quote and non-funded checkout matrix also passed: exact quote replay, wrong-region and forged-token rejection, canonical-term tamper rejection, session replay, cancellation, refresh rotation, empty reconciliation queue, and encrypted restore. On 2026-08-26 the real DPAPI-bound launcher opened the exact HTTPS page in Firefox; human no-action produced `ready -> expired` with no signature, settlement observation, or grant. Cancellation and expiry close the approved order in the same database transaction. Quote-only orders from a pre-checkout failure are closed by the bounded monitor after quote expiry. Synthetic multi-instance verification records use the reserved `verification:` prefix and are terminalized after the proof; they must never remain in the reconciliation queue.

## Wallet preparation

Use separate MetaMask accounts for payer and merchant receipt. Never disclose seed phrases or private keys.

Run `scripts/start-funded-commerce-pilot.ps1` under PowerShell 7.5 or later only when the payer and operator are both ready. It verifies `/readyz`, rotates the app session crash-safely, checks every exact offer term, preserves ISO timestamps as strings, stores the single-use handoff only in current-user DPAPI, and opens Firefox. The checkout approval is deliberately shorter than two minutes. `scripts/inspect-commerce-pilot-ledger.ps1` uses the same PowerShell floor, downloads the operator-authenticated encrypted backup, decrypts it only in memory, and prints bounded order/session state counts without credentials or wallet payloads.

1. Add Base Sepolia: chain ID `84532`, RPC `https://sepolia.base.org`, explorer `https://sepolia-explorer.base.org`.
2. Fund the payer with Base Sepolia test USDC at `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. Testnet tokens have no monetary value.
3. Test ETH is useful for ordinary wallet operations, but x402's facilitator broadcasts the EIP-3009 transfer; the purchase asset is test USDC.
4. Confirm the page displays Toothpaste, 0.10 USDC, Base Sepolia, the exact USDC contract, merchant address and expiry before signing.
5. Verify the resulting transaction independently in the Base Sepolia explorer and confirm restore on a clean Desky installation.

The payer must not be `0x4f9c8Ea2a0e77338d41d5438F319617E2e95D7c3`. Browser signing and server payload admission independently reject merchant-as-payer. Record only the payer's public `0x...` address in verification evidence. The remaining funded gate requires the owner to connect that separate account, inspect the exact terms, and approve the EIP-712 signature. Desky must not inspect browser-extension storage, request a seed phrase/private key, or automate human approval.

## Create and verify an encrypted logical backup

With `$pilot` loaded:

```powershell
$archive = 'C:\Users\cosyc\Desky Backups\desky-commerce-YYYYMMDD-HHMMSS.dcbackup'
Invoke-WebRequest `
  -UseBasicParsing `
  -Uri 'https://desky-checkout-testnet.netlify.app/v1/operations/backup' `
  -Headers @{ Authorization = "Bearer $($pilot.operatorToken)" } `
  -OutFile $archive

$env:DESKY_COMMERCE_BACKUP_KEY = $pilot.backupKey
node services/commerce-hosted/scripts/run-commerce-backup-restore-drill.mjs --verify $archive
Remove-Item Env:DESKY_COMMERCE_BACKUP_KEY
```

Accept the backup only if AES-GCM authentication, both migrations, every foreign-key insert, row counts and the canonical logical digest report `restore: verified`. Retain the archive hash in a verification record. The export intentionally excludes health probes and rate-limit windows and never contains raw wallet signatures, provider credentials, recovery codes or refresh credentials.

## Rotation

Rotate the signing key, credential pepper, operator token and backup key as one reviewed pilot bundle only while the identity/session impact is known. Losing the pepper invalidates outstanding refresh/recovery derivation. Losing or replacing the signing key invalidates tokens not covered by JWKS overlap. Once real identities exist, signing rotation must publish old and new public keys through an overlap window; the single-key pilot rotation procedure is no longer acceptable.

After rotation:

1. DPAPI-protect the complete new bundle before setting cloud secrets.
2. Deploy all Netlify secret changes together.
3. Confirm `/healthz`, JWKS and secret-authenticated operations.
4. Create and restore-verify a new archive under the new key.
5. Delete obsolete archives only after the new archive and escrow both pass.
6. Record the deploy ID and hashes without recording secrets.

## Supabase recovery posture

The current free project relies on Desky's encrypted logical export. Before production, move to a paid plan with managed daily backups or PITR, establish RPO/RTO, and restore to a separate project. Provider restore may omit custom-role passwords, so reset `desky_checkout_runtime`, update Netlify, verify grants/roles and run the full service matrix before reopening readiness.

The owner reports that the interactively disclosed Supabase owner password was rotated on 2026-08-25. The hosted runtime uses its own least-privilege role, so the rotation did not interrupt `/healthz`. Never reuse the retired credential; confirm the new owner login privately before the funded matrix without recording it here.

## Incident stop conditions

Keep `/readyz` closed and stop funded testing for any of the following:

- migration, JWKS, backup decryption or restore mismatch;
- unknown settlement without an admitted observation path;
- operator/signing/pepper/backup key exposure;
- provider/network/asset/recipient/amount drift;
- external identity crossing account or installation identity;
- reconciliation queue above its bound;
- missing external paging or off-device escrow for any production/mainnet plan.
