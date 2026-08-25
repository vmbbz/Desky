# 0011 — Independent Base settlement observer and paid-grant closure

Status: accepted for the capped Base Sepolia pilot on 2026-08-25. Mainnet and Store commerce remain unapproved.

## Context

x402 v2 standardizes facilitator `/supported`, `/verify`, and `/settle`, but not a durable payment-status lookup. The admitted public test facilitator currently supports v2 `exact` on Base Sepolia and returns 404 for `/status`. Repeating `/settle` after a timeout is unsafe because the first call may already have broadcast the EIP-3009 authorization.

Some non-standard facilitators expose settlement lookup APIs. Depending on one would couple Desky's recovery truth to the same operator and failure domain that performed settlement. Chain observation is slower and requires RPC/finality policy, but can independently prove the authorization and exact asset transfer.

## Decision

- Keep the facilitator as the verification and one-shot settlement dispatcher.
- Never call `/settle` from reconciliation.
- Observe Base independently through a configured HTTPS JSON-RPC endpoint.
- Search the Base Sepolia USDC contract for the exact `AuthorizationUsed(payer, nonce)` event, then require one successful receipt containing one exact `Transfer(payer, recipient, amount)` from the admitted USDC contract.
- Record the transaction as pending until three confirmations and settled only with the mined block timestamp.
- Treat absence as unresolved, never as failure. Ambiguity, duplicate authorization events, failed receipts, or transfer mismatch fail closed for operator review.
- Append chain observations through the existing monotonic settlement ledger. Only the existing atomic settlement-to-entitlement transaction grants the exact quoted product revision.
- Exclude granted orders from the reconciliation queue while retaining immutable payment and entitlement history.

The first admitted paid-pilot product is Toothpaste revision `toothpaste-6dc38124-v1`, pinned to Open Source Avatars registry commit `0f9a1b2fd99894736563d55b2c9dc9125700d081` and project-level CC0. The testnet offer is exactly `100000` atomic Base Sepolia test USDC units. It is not projected into the three-avatar free catalog or any Store profile.

## Consequences

- Facilitator-specific status may later be used as an additional signal, never the sole settlement authority.
- The public Base RPC is acceptable for this capped testnet pilot only. Production requires authenticated provider endpoints, independent-provider comparison, finality/reorg handling, paging, and service-level monitoring.
- The scheduled worker is bounded to 25 candidates and 1,000 observations per pass. No paid offer may be enabled without the RPC setting.
- Worldwide commercial availability is not inferred from a testnet region field. Production needs a legal/tax/sanctions allowlist and merchant-of-record decision.
- Mainnet admission remains a separate owner, legal, custody, facilitator, incident-response, and canary decision after the full funded Sepolia matrix passes.
