# F4x.2a x402 Base Sepolia protocol admission — 2026-08-25

## Result

Desky now has a provider-disabled, service-only x402 v2 Base Sepolia admission boundary. It creates exact EIP-3009 USDC requirements only from an authoritative short-lived direct-build quote, validates the signed payload against those requirements, and calls one configured facilitator through fixed bounded endpoints. It does not yet expose checkout or execute a payment.

## Evidence

- Official x402 Foundation source reviewed at `aeb0fddd2f9131a46f8f7ee93aca3fca4da98401`.
- npm `@x402/core` and `@x402/evm` `2.23.0` metadata/integrity recorded without adding either root dependency.
- Live `GET https://x402.org/facilitator/supported`: HTTP 200 JSON advertising v2 `exact` on `eip155:84532`.
- `npm test`: 67 files passed, 6 skipped; 371 tests passed, 10 skipped.
- New x402 matrix: 21 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm audit --omit=dev`: zero vulnerabilities.
- `npm run package`: Windows x64 package completed.
- Webpack and packaged ASAR inspection found no Base Sepolia adapter or `@x402` payload in Electron.

The matrix rejects wrong provider/profile/network/asset/recipient/currency, expired or overlong quotes, mutated resource or accepted requirements, amount/recipient/lifetime/nonce authorization changes, legacy v1 capability, redirects, wrong media type, oversized response, wrong payer, and wrong settled amount. Settlement timeout is explicitly classified as indeterminate.

## Limits

- Discovery is not a funded transaction or production-facilitator endorsement.
- No wallet or private key was created, loaded, or requested.
- No merchant address has been selected for production.
- No checkout HTTP route, human confirmation, payment signature return, durable settlement evidence, settlement reconciliation, or grant orchestration exists yet.
- The public x402.org facilitator is testnet-only and will never be used for mainnet.
- All paid providers and production payments remain unreachable.

## Next gate

F4x.2b separates durable payment identity from settlement evidence, records unknown/pending settlement without granting, and reconciles callback loss or timeout before an idempotent grant. After that boundary passes, Desky can add the explicit browser/wallet handoff and run the funded Base Sepolia matrix.
