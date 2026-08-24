# F4x.2b indeterminate settlement and reconciliation — 2026-08-25

## Result

Desky's provider-disabled commerce ledger no longer treats x402 verification as settlement. Verified authorization and append-only settlement observations are distinct durable records. Timeout/callback loss cannot grant, close an order, or trigger a second attempt; only monotonic reconciliation to an exact settled observation can enter the atomic entitlement transaction.

## Implemented invariants

- Payment attempts contain workflow state but no provider transaction reference.
- Authorization evidence binds attempt/order/quote, payer, payment identifier, provider, network, asset, recipient, exact atomic amount, verification time, and authorization expiry.
- Provider/network/payment identifiers are unique, preventing replay through another authorization.
- Settlement observations are append-only with unique observation and reconciliation IDs, exact authorization terms, source, status, reason, observation time, and transaction reference where known.
- `unknown` cannot claim a transaction. `pending` and `settled` require one. Settled evidence additionally requires the provider/chain settlement time, distinct from later observation time.
- State advances monotonically through `unknown`, `pending`, `settled`, or `failed`; terminal observations cannot regress or be replaced by a second terminal claim.
- Provider/network/transaction references cannot cross authorizations. One authorization may retain the same reference from pending to settled.
- Unknown, pending, and settled-but-ungranted attempts block cancellation, expiry, and another payment attempt. Reconciled failure permits a new attempt.
- Grant commit requires the exact durable settled observation and atomically commits order paid/granted, the entitlement event, and the revision-bound asset grant.
- Late reconciliation after quote expiry is supported only when the authorization was verified within the quote window and the durable settlement time is valid. The later observation time does not rewrite payment history.

## Verification

- `npm test`: 68 files passed, 6 skipped; 383 tests passed, 10 skipped.
- Focused commerce/x402 matrix: 57 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm audit --omit=dev`: zero vulnerabilities.
- `npm run package`: Windows x64 package completed.
- Webpack and packaged ASAR inspection found no settlement ledger, SQLite commerce adapter, or service-only commerce module in Electron.

Adversarial coverage includes unknown/pending grant denial, retry and order-closure blocking, unknown-to-pending-to-settled callback-loss recovery, late discovery versus actual settlement time, exact replay, identifier collision, amount drift, terminal regression, cross-authorization transaction reuse, quote-expired authorization rejection, atomic grant rollback, close/reopen durability, and retry only after reconciled failure.

## Not yet proved

- No hosted production repository adapter or multi-instance race matrix exists.
- No reconciliation worker, chain RPC policy, finality threshold, retry schedule, backlog alert, or incident disable is deployed.
- No checkout route, browser/wallet handoff, payment signature, funded Base Sepolia transaction, or live callback has run.
- No production facilitator, merchant recipient, merchant credential, or mainnet rail is selected.
- Paid providers and renderer/main commerce IPC remain unreachable.

## Next gate

F4x.2c builds the hosted checkout session and explicit human-approved browser/wallet handoff without wallet custody. It must bind the returned signed payload to the existing quote/authorization contracts, persist no signature in Electron, and feed verify/settle outcomes into this reconciliation ledger. The funded Base Sepolia matrix follows only after that boundary passes.
