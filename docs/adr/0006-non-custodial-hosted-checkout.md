# ADR 0006 — Non-custodial hosted checkout and one-shot settlement dispatch

## Status

Accepted for the provider-disabled F4x.2c foundation on 2026-08-25.

## Context

Desky needs a direct-build x402 checkout without giving an agent, renderer, or Electron process custody of a wallet key. A renderer callback cannot be payment truth, and opening an external wallet before a trusted human sees the authoritative quote would let untrusted model/UI data influence a charge. A second correctness hazard exists after signature: a crash after `/settle` is dispatched but before its response is stored can cause a duplicate transfer if restart blindly retries.

## Decision

- Desky main owns a single-use, maximum-two-minute approval. It displays the authoritative product, exact atomic USDC amount, CAIP-2 network, token contract, merchant recipient, grant revisions, and quote expiry. Model text and renderer-supplied terms are never authority.
- After approval, main calls only fixed authenticated HTTPS checkout routes. The hosted service re-authenticates account and installation, reloads the quote/order, recomputes a canonical SHA-256 terms digest, and persists a maximum-ten-minute session keyed uniquely by approval and account/idempotency key.
- The service issues only an exact same-origin `/checkout/{sessionId}` URL with no credential, query, or fragment. F4x.2d main appends a separate one-time browser-binding verifier as a fragment immediately before launch; ADR 0007 governs that short-lived exchange. Browser-launch failure preserves the admitted session and in-memory binding for explicit reopen; it does not recreate approval or payment state.
- Electron never accepts a wallet callback as settlement truth. It polls the authenticated hosted status route. The hosted web adapter will submit the signed x402 payload directly to the hosted processor; raw signatures exist only in bounded service memory and never enter Electron, session records, entitlement records, diagnostics, or analytics.
- Cancellation is allowed only in `ready` or `awaiting-wallet`. Authorization, unknown/pending settlement, and terminal states require server reconciliation rather than optimistic cancellation.
- After facilitator verification, immutable authorization evidence is stored. Before `/settle`, the ledger atomically inserts a deterministic `unknown` dispatch observation and returns a one-shot dispatch claim. Exact replay or another process receives no claim and cannot call `/settle` again.
- Any exception after the dispatch claim leaves settlement `unknown`; only reconciliation may advance it. Explicit invalid verification fails before dispatch. Facilitator results append pending, settled, or failed observations under the F4x.2b monotonic rules.
- Checkout services, processor code, and paid IPC remain absent from the initial Store artifact and unreachable in the current application. This ADR does not authorize production or funded payment.

## Consequences

- Production needs an authenticated hosted checkout page, CSRF/session protection, wallet-adapter review, a production transactional implementation of the dispatch claim, reconciliation workers, rate limits, monitoring, and a funded Base Sepolia matrix.
- A native main-owned approval presenter and release-profile admission must be wired only for a separately reviewed direct build. The renderer cannot be the final approval authority.
- Users can recover a created checkout after default-browser failure without creating another approval. A closed browser never implies a submitted payment failed.
- Multi-instance conformance must prove that only the database winner of the dispatch claim calls `/settle`.
