# F4x.2d hosted wallet browser and signed-payload admission — 2026-08-25

## Result

Desky's provider-disabled x402 pilot now has an executable browser boundary from local approval through exact EIP-3009 signature admission and authoritative settlement projection. The base checkout URL is non-secret; a one-time fragment verifier binds it to the approved desktop session. The hosted service exchanges that verifier for a hardened browser cookie and rotating CSRF token. The browser can display exact authoritative terms, request an EIP-712 signature through EIP-1193 only after explicit invocation, and submit the signed payload without persisting it.

Opening or bootstrapping the browser creates no payment attempt. Only a strictly admitted signed payload claims a short processing lease, atomically prepares the order/attempt, and enters the existing verify/one-shot-settle ledger. No paid provider or Electron route was enabled.

## Implemented invariants

- Main generates a 256-bit verifier and sends only its SHA-256 challenge in the authenticated session request. The verifier is held in memory, appended only as `#handoff=`, and never enters the base URL or durable record.
- Bootstrap requires exact origin and same-origin fetch metadata, consumes the verifier once, and stores only SHA-256 cookie/CSRF digests.
- The browser credential is emitted only as a `__Host-desky-checkout` cookie with `Path=/`, bounded `Max-Age`, `Secure`, `HttpOnly`, `SameSite=Strict`, and no `Domain`.
- Resume rotates the CSRF synchronizer token. Payment submission requires exact origin, same-origin fetch metadata, one non-duplicated bound cookie, the current CSRF token, unexpired session, and matching session identity.
- Browser JSON is no-store, same-origin, no-referrer, no-frame, no-sniff, fixed-route, exact-schema, and bounded-size. Credentials never appear in JSON.
- Browser bootstrap only derives authoritative view/requirements/resource material. It does not transition the order or create a payment attempt.
- Displayed amount/network/asset/recipient and session identity/expiry must exactly match the x402 signing material on both service and browser sides.
- The EIP-1193 client requests the selected account, switches to chain `0x14a34`, and signs exact EIP-712 `TransferWithAuthorization` fields for Base Sepolia USDC. It does not request key material or add an RPC/network.
- Signed payload admission reruns the strict F4x.2a parser before durable mutation. Durable checkout records contain only an opaque submission ID, canonical SHA-256 payload digest, receipt time, and a 15-second processing lease—never the signature.
- A changed submission ID/payload conflicts. Exact resubmission can reclaim an expired lease after a pre-processor crash. Overlap remains safe because authorization uniqueness and the F4x.2c atomic settlement-dispatch claim prevent a second broadcast.
- Lost settle response remains `settlement-unknown`; service/browser restart projects that ledger truth and does not call settle again. Authenticated desktop status uses the same projector.

## Verification

- Focused checkout/browser/commerce/x402 matrix: 10 files, 39 tests passed.
- `npm test`: 78 files passed, 6 skipped; 419 tests passed, 10 skipped.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm audit --omit=dev`: zero vulnerabilities.
- `npm run package`: Windows x64 package completed.
- Webpack and packaged ASAR inspection found no checkout route, browser challenge/cookie/CSRF marker, EIP-1193 signing call, Base runtime, settlement processor, or hosted browser module in Electron.

Adversarial coverage includes wrong/cross-site origin, missing fetch metadata, wrong verifier, repeated bootstrap, duplicate cookies, stale CSRF, unknown fields, scalar/mutated payload, final-URL drift, display/signing drift, ambiguous wallet account, wrong signature shape, expired authorization, process crash before processor entry, exact lease reclaim, lost settle response, process restart, signature/cookie/CSRF non-persistence, and desktop projection.

## Funded test decision

The reference machine contains no candidate Base/Sepolia/x402/wallet/facilitator environment variables and no local hosted/test-wallet configuration. There is also no deployed HTTPS checkout ingress. No funded payment was attempted because doing so would require an authorized user wallet, test USDC/funds, and a real hosted callback/restart surface. Deterministic wallet and facilitator doubles prove the local boundary only.

## Not yet proved

- No hosted web artifact, accessible page styling, TLS deployment, CSP build hashes, DNS, real identity, cookie rotation, rate limit, bot protection, or WAF exists.
- No injected wallet/browser compatibility matrix or real user rejection/insufficient-funds behavior has run.
- No funded Base Sepolia transaction, callback, chain confirmation/finality, multi-instance deployment race, or facilitator outage has run.
- Settlement-to-atomic-grant projection, delivery failure, clean-device purchase restoration, refund/support correction, monitoring, and incident-disable drills remain open.
- No production facilitator, merchant custody, legal/tax region, mainnet allowance, or Store provider is admitted.

## Next gate

F4x.2e deploys the isolated testnet service/page behind real HTTPS, provisions an owner-authorized Base Sepolia wallet and test assets, and executes the funded matrix. It then closes settled-to-grant, asset delivery, clean-device restoration, callback/reconciliation worker, metrics/alerts, and incident-disable evidence. Production and Store admission remain separate later gates.
