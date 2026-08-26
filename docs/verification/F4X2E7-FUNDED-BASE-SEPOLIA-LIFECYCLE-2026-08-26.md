# F4x.2e.7 funded Base Sepolia lifecycle — 2026-08-26

## Result

The capped Windows-direct pilot completed Desky's first real funded x402 lifecycle. A human approved an exact MetaMask EIP-712/EIP-3009 authorization for 0.10 official Circle Base Sepolia test USDC. The facilitator broadcast one successful transaction; the independent Base observer confirmed the exact authorization and transfer before the existing atomic entitlement transaction granted Toothpaste.

The paid grant then survived the original installation refresh, a one-time clean-device restore into a separate DPAPI-protected state, a fresh-process refresh of that restored installation, and an encrypted 14-table logical backup/isolated restore. This is testnet evidence only. It does not enable mainnet, Microsoft Store commerce, worldwide selling, or production operations.

Final deploy: `6a8f2640658e79d8b0c1e591`.

## Exact payment evidence

- product: `avatar.toothpaste`, revision 1;
- avatar revision: `toothpaste-6dc38124-v1`;
- checkout: `checkout:19a49c85-e037-4b3e-a971-9ceabdc1979a`;
- order: `order:1f5eb9b2be36681d054ee0c08467d3a5`;
- amount: `100000` atomic units, displayed as 0.10 test USDC;
- network: Base Sepolia, chain ID `84532`, CAIP-2 `eip155:84532`;
- official test USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`;
- payer: `0xCa60c8eF6934f8a97c6a503C4e3a46e87F5b08bD`;
- merchant: `0x4f9c8Ea2a0e77338d41d5438F319617E2e95D7c3`;
- transaction: `0xb782b880d955d19252c23b58cac09a017f6dbcea26158c74748fe58074c14887`;
- receipt status: `0x1` in block `45998408`;
- confirmations at independent inspection: 215;
- receipt logs: official-USDC `AuthorizationUsed(payer, nonce)` plus one `Transfer(payer, merchant, 100000)`;
- observer result at `2026-08-26T17:30:43.575Z`: inspected 1, granted 1, unresolved 0, pending 0, errors 0.

No private key, seed phrase, raw signature, provider token, browser cookie, CSRF value, refresh credential, recovery code, or binding verifier is recorded here. MetaMask approval remained a human action.

## Durable grant

- entitlement: `grant:x402:d236ef8863cec40a38686b434212e478`;
- account: `account:4360673c636789b2c3c0b1b45230fd58`;
- product: `avatar.toothpaste`;
- catalog revision: `desky-paid-pilot:1`;
- state: `active`;
- order state after observer: `granted`;
- entitlement events after grant: 4 total, comprising 3 free and 1 paid;
- asset grants after grant: 4 total, comprising 3 free and 1 paid.

The facilitator's `settled` response did not itself authorize access. The order remained `awaiting-settlement` until the independent observer validated the successful receipt, exact official-USDC contract, authorization event, payer, nonce, recipient, amount and confirmation floor. Only `HostedPaidGrantService.commitSettlement` wrote the event, grant and terminal order state atomically.

## Browser defects closed during the funded run

1. Firefox rejected an unbound native `fetch` stored as a class field and issued no bootstrap request. The client now wraps `globalThis.fetch`; a Firefox-shaped receiver regression test covers it.
2. Multi-wallet legacy injection selected Phantom instead of MetaMask. The page now uses EIP-6963 discovery, prefers exact MetaMask identity, supports the unambiguous legacy fallback and refuses to guess between wallets.
3. A missing Base Sepolia network produced an opaque wallet failure. The adapter now handles EIP-1193 `4902`, asks the wallet to add the exact public Base Sepolia definition, switches explicitly and maps rejection/account/network/signature/expiry failures to bounded diagnostics.
4. The direct handoff briefly lost to local VPN/security navigation. Main now serves only an exact random loopback Firefox document request and tolerates repeat matching navigation for 15 seconds before closing. The verifier and hosted URL never appear together in process arguments.

The experimental hosted form bridge was removed after the direct loopback fragment design passed. The hosted service exposes no cross-origin bridge endpoint; bootstrap, resume and submit remain same-origin, strict-cookie and rotating-CSRF bound.

## Post-grant lifecycle defect closed

The first refresh after the paid grant returned a sanitized 500 with correlation `01m0zj6m9q0x5x829ex23xcnwp`. The service log reported `Commerce token input is inconsistent.` The original token issuer incorrectly required all active grants to share one catalog revision: free grants use `desky-foundation:2`, while Toothpaste uses `desky-paid-pilot:1`.

New access tokens carry a bounded unique `catalogVersions` set and the desktop verifies set equality against the exact active grants. The offline lease already binds a catalog revision per grant. Legacy singular `catalogVersion` tokens are normalized only during their existing short lifetime; tokens containing both shapes, empty sets or duplicates fail closed. Focused access-token, issuer and recovery tests cover mixed catalogs and the rollover shape.

The refresh mutation had committed before token issuance failed. The DPAPI-persisted deterministic rotation ID recovered the exact replay after deploy rather than rotating or losing the credential again.

## Restart and restoration evidence

| Gate | Evidence |
| --- | --- |
| original installation refresh | generation 34; exact Toothpaste grant active |
| clean-device restore | new installation `installation:restored:6872cc7eb91cd593f1762d58`; new session `session:930c662b0cf994fd8a5a15e3d5f0d277`; generation 1; exact grant active |
| fresh-process restart | separate PowerShell 7 process loaded only the restored DPAPI state, rotated to generation 2 and retained the exact grant |
| protected state | source and restored sessions reside in separate current-user DPAPI files; recovery/token values were not printed |
| backup restore | AES-256-GCM authentication, migration 2, all 14 table inserts/foreign keys and canonical logical digest verified in an isolated database |

The clean-device run is a distinct logical installation on the Windows reference device, not evidence from a second physical PC or macOS Keychain.

## Post-funded encrypted archive

- path: `C:\Users\cosyc\Desky Backups\desky-commerce-20260826-funded-clean.dcbackup`;
- encrypted bytes: 165,708;
- encrypted SHA-256: `78c24797e8d986d92c0a759d481374d6655cbda96ab990e73e7af06df693aec5`;
- logical SHA-256: `776882e62165ee2704013d058ca9e608dc30902efc2487a29767a28a7adc6eca`;
- tables: 14;
- identities/installations: 1/2;
- payment attempts/authorizations/provider references/observations: 2/2/1/3;
- entitlement events/asset grants/refresh sessions: 4/4/2;
- restore: verified.

The archive is encrypted at rest and kept outside the repository. It deliberately contains no raw wallet signature or plaintext service credential.

## Operational hardening

The fifteen-minute monitor now closes two distinct abandoned states under row locks and fixed bounds:

- expired quote-only `created`/`awaiting-approval` orders with no checkout;
- expired checkout sessions only while `ready` or `awaiting-wallet`, with atomic order closure.

It never sweeps `signature-submitted`, authorization, reconciliation, settlement, settled, failed, cancelled or granted work. Unit tests prove idle closure and preservation of a settled checkout.

The first live run of the final deploy closed all 21 abandoned `ready`/`awaiting-wallet` sessions and their orders at `2026-08-26T18:00:59.240Z`. Authoritative operations then reported pending orders 0 and indeterminate settlements 0. The funded checkout remained `settled`, its order remained `granted`, and all four grants remained active.

## Verification summary

- root Vitest: 468 passed, 10 skipped;
- hosted Vitest: 29 passed;
- root and hosted TypeScript checks: passed;
- ESLint: passed;
- hosted browser/function build: passed;
- Windows x64 Electron Forge packaging: passed;
- root production audit: zero vulnerabilities;
- hosted production audit: zero vulnerabilities;
- live `/readyz`: 200 on final deploy;
- post-grant encrypted backup/isolated restore: verified.

Production dependency audits remain separate from the unchanged Electron Forge development-tool advisory gate: 31 development-only findings (3 low, 3 moderate, 24 high, 1 critical). No incompatible forced downgrade is used.

## Remaining gates

1. Capture live manual user-rejection and insufficient-test-USDC UX on fresh short-lived orders if further wallet-negative evidence is required; unit/contract rejection, expiry, replay, callback-loss and settlement-recovery paths already pass.
2. Replace the public pilot RPC with two independently operated authenticated providers and real paging/on-call evidence.
3. Move keys to audited off-device custody and complete publisher, tax, sanctions, refund/support, region and incident ownership.
4. Build and certify a separately reviewed release profile. Microsoft Store remains free-only; mainnet remains disabled.
