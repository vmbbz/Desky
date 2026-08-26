# F4x.2e.6 browser expiry and operator hardening — 2026-08-26

## Result

The isolated pilot opened its first real DPAPI-bound, single-use HTTPS checkout in Firefox at `https://desky-checkout-testnet.netlify.app`. The page was bound to the exact Toothpaste quote for 0.10 Base Sepolia test USDC and the owner merchant. The owner took no wallet action during the short approval window. Authoritative authenticated polling observed `ready -> expired`; there was no signature, payment attempt, settlement observation, transaction, entitlement event, or paid grant.

This is terminal-expiry evidence, not a funded-success claim. Store commerce, Electron payment capability, mainnet, and worldwide production selling remain disabled.

Final deploy: `6a8e3d2146b97801ebf18e92`.

## Exact admitted browser terms

- product: `avatar.toothpaste`, revision 1;
- avatar revision: `toothpaste-6dc38124-v1`;
- amount: `100000` atomic test USDC, displayed as 0.10 USDC;
- network: Base Sepolia, `eip155:84532`;
- asset: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`;
- recipient: `0x4f9c8Ea2a0e77338d41d5438F319617E2e95D7c3`;
- release profile: `windows-direct` only.

The handoff verifier stayed in current-user DPAPI and the URL fragment. It was never printed, committed, persisted by the service, or included in this record.

## Defects found and closed

The first operator attempt found three pre-wallet defects without moving funds:

1. PowerShell 7 `ConvertFrom-Json` automatically converted ISO timestamps into Johannesburg-local `DateTime` objects. A later parse applied the offset again, making a fresh quote appear two hours expired and also threatening canonical-term digest equality. All operator JSON boundaries now use `-DateKind String`; the checkout launched only after a local 119-second lifetime check and exact server-side admission.
2. A refresh rotation succeeded remotely before an initial PowerShell response-media check failed locally. The deterministic rotation ID recovered the accepted generation. The launcher now DPAPI-escrows a pending rotation ID before transmission, immediately encrypts the returned session, then clears the pending marker. A crash can replay the exact rotation without credential drift.
3. The service classified the approval-lifetime parser error as a generic 500 and had no useful indexed cause. Unclassified failures now emit a bounded correlation log containing route, correlation ID, error name, and truncated message—never request bodies or credentials. Invalid checkout lifetimes now use the existing sanitized 400 response.

Failed pre-checkout diagnostics left quote-only `created` orders. The scheduled monitor now locks and expires at most 100 expired `created`/`awaiting-approval` orders per pass only when no checkout session exists. It never closes an order with a checkout or any in-flight settlement. The scheduled Function remains non-public; direct invocation returned 403.

The funded gate also promotes the documented separate-payer rule into two independent code checks: the browser refuses to request a signature when the selected account equals the merchant, and the service rejects a forged merchant-as-payer authorization even if a client bypasses the browser.

## Operator tooling

- `scripts/start-funded-commerce-pilot.ps1` performs readiness, crash-safe session rotation, exact quote checks, canonical digest, DPAPI handoff escrow, and Firefox launch without printing credentials.
- `scripts/inspect-commerce-pilot-ledger.ps1` fetches the operator-authenticated encrypted backup, AES-GCM decrypts it only in memory, and reports bounded order/session states. It never writes plaintext.

Both scripts require PowerShell 7.5 so `ConvertFrom-Json -DateKind String` is guaranteed rather than silently falling back to timezone-converting behavior.

## Live terminal closure and backup

The first protected monitor run on the final deploy reported `severity: info`, expired 7 quote-only diagnostic orders, inspected no reconciliation candidates, and reported zero unresolved, pending, settled, granted, or error observations. Secret-authenticated operations then reported migration 2, 1 identity, 1 active refresh session, 0 pending orders, 0 indeterminate settlements, and 0 reconciliation items.

Post-expiry encrypted archive:

- path: `C:\Users\cosyc\Desky Backups\desky-commerce-20260826-011639.dcbackup`;
- encrypted bytes: 45,837;
- encrypted SHA-256: `06b8f8c49c7644d4b7cbaa2ca67c234710f47422203aedf45193a7ce1e1d2376`;
- logical SHA-256: `458c35a09d1555e7ccb2151f20ed3d682d8e26624fee45fbf27821dde3c14e31`;
- tables: 14; restore: verified.

## Verification

- root Vitest: 460 passed, 10 skipped;
- hosted Vitest: 27 passed;
- root and hosted TypeScript checks: passed;
- ESLint: passed;
- hosted browser build: passed;
- Windows x64 Electron Forge packaging: passed;
- root production audit: zero vulnerabilities across 153 production dependencies;
- hosted production audit: zero vulnerabilities across 15 production dependencies;
- `/readyz`: 200 before the browser launch;
- browser/session: `ready -> expired`;
- wallet signature: absent;
- settlement observation and paid grant: absent.

The existing Electron Forge development-tool advisory gate is unchanged. No incompatible forced downgrade was used.

## Remaining funded gate

1. Prepare a MetaMask payer account different from the merchant and fund it with Base Sepolia test USDC.
2. Run a new short-lived launcher session only while the owner is ready at Firefox.
3. Record only the payer public address, EIP-3009 transaction hash, exact receipt/events and explorer evidence.
4. Prove human rejection, insufficient funds, exact replay/duplicate dispatch, callback loss, process restart, three-confirmation observer closure, atomic grant, refresh projection and one-time clean-device restoration.
5. Do not promote this pilot to mainnet, Store commerce, or production operations without the existing legal, tax/refund, custody, paging, redundant-RPC and release-profile gates.
