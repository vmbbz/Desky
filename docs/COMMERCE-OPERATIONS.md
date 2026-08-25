# Commerce pilot operations

This runbook applies only to the isolated Base Sepolia service at `https://desky-checkout-testnet.netlify.app`. It does not authorize mainnet or Store commerce.

## Current authorities

- Supabase owns PostgreSQL/Auth availability and the private `desky_commerce` schema.
- Netlify owns immutable Function deploys, production environment secrets, logs, metrics and the scheduled monitor.
- The Windows reference device has a current-user DPAPI escrow at `C:\Users\cosyc\AppData\Local\Desky\commerce-pilot-secrets.dpapi`.
- The verified encrypted logical archive is `C:\Users\cosyc\Desky Backups\desky-commerce-20260825-escrowed.dcbackup`.

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
- `GET /readyz` proves the entire payment dependency set. It must remain 503 until offer, merchant and facilitator admission is intentional.
- `GET /v1/operations/status` requires `Authorization: Bearer $pilot.operatorToken` and returns only bounded counts.
- `GET /v1/operations/reconciliation` uses the same operator bearer and returns a maximum 100 non-sensitive unknown/pending/settled-but-ungranted queue entries.

Never retry `/settle` merely because an attempt is unknown. Record the incident, preserve the order/authorization/observation IDs, and use only an admitted facilitator-status or Base-observer procedure. A manual database edit is not reconciliation.

The non-public `commerce-monitor` Function runs every fifteen minutes. Five-minute reconciliation age is an error; any indeterminate item is a warning. Netlify logs/Observability are pilot diagnostics. Production requires an external paging destination, named on-call owner, acknowledgement target and escalation policy.

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

The interactively disclosed Supabase owner password must be rotated before the funded matrix. The hosted runtime uses its own least-privilege role, so owner rotation should not interrupt service.

## Incident stop conditions

Keep `/readyz` closed and stop funded testing for any of the following:

- migration, JWKS, backup decryption or restore mismatch;
- unknown settlement without an admitted observation path;
- operator/signing/pepper/backup key exposure;
- provider/network/asset/recipient/amount drift;
- external identity crossing account or installation identity;
- reconciliation queue above its bound;
- missing external paging or off-device escrow for any production/mainnet plan.
