# ADR 0005 — Indeterminate payment settlement and reconciliation

## Status

Accepted for the provider-disabled F4x.2b foundation on 2026-08-25.

## Context

x402 `/verify` proves that a signed authorization is valid but returns no transaction. A `/settle` timeout or lost callback is indeterminate because the facilitator may have broadcast the transfer. Treating a payer, nonce, HTTP success, timeout, or wallet callback as a settled provider reference can either mint an unpaid entitlement or charge twice after retry.

## Decision

- A payment attempt contains workflow state only. It no longer stores a provider reference.
- Immutable `PaymentAuthorizationEvidence` separately binds the attempt/order/quote, payer, payment identifier, provider, exact network/asset/recipient/amount, verification time, and authorization expiry. Provider/network/payment identifiers are unique.
- Append-only `PaymentSettlementObservation` records the source, reconciliation ID, exact authorization terms, observed status/time, reason, and optional transaction/provider reference. Settled evidence separately requires the provider/chain settlement time so delayed reconciliation does not rewrite history as if payment happened when it was observed.
- Settlement projects monotonically through `unknown`, `pending`, `settled`, or `failed`. Unknown/pending may receive repeated observations, but terminal states cannot regress or be replaced by a new terminal claim.
- Unknown cannot claim a transaction. Pending and settled require one. A provider/network/transaction reference may belong to only one authorization, while pending-to-settled observations for that authorization may reuse it.
- A settle timeout records `unknown`; it never records `failed`. Callback loss is reconciled through facilitator or independently trusted chain evidence before retry or grant.
- An order with unknown, pending, or settled-but-ungranted payment cannot be cancelled, expired, or given another attempt. A new attempt is allowed only after durable failed reconciliation.
- Grant commit requires a specific durable settled observation and atomically moves the order through paid/granted while appending the entitlement event and exact asset grant. Verification alone cannot grant.
- Quote expiry prevents new authorization. A valid authorization may be observed as settled later because confirmation/reconciliation can occur after its execution window; the durable evidence must still match the original quote exactly.

## Consequences

- Service deployments need unique constraints for payment identifiers, reconciliation IDs, and provider references plus compare-and-swap attempt/order transitions.
- Reconciliation workers are part of correctness, not optional monitoring. Their backlog and oldest unresolved age require alerts and incident controls.
- The current SQLite implementation proves transaction semantics only; no funded transaction, chain-finality policy, facilitator SLA, production database, or checkout flow is implied.
- Payment signatures, private keys, wallet seed phrases, and facilitator credentials remain absent from durable entitlement records and Electron.
