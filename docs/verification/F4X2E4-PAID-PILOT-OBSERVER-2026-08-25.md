# F4x.2e.4 paid pilot and independent observer — 2026-08-25

## Outcome

Desky now has a rights-reviewed first paid-pilot avatar, an exact ten-cent testnet offer admission, independent Base Sepolia reconciliation, and automatic atomic paid-grant projection. The deployment remains intentionally non-payable until a real app identity and owner-provided merchant receive address are bound.

## Avatar admission

Selected avatar: **Toothpaste**, outside the free Milk/CoolBanana/Astronaut set.

- Canonical registry: `ToxSam/open-source-avatars` commit `0f9a1b2fd99894736563d55b2c9dc9125700d081`.
- Registry avatar ID: `4877abd5-b8f5-4f06-a24d-b6006834f330`.
- Project: `100Avatars R1`; project licence `CC0`; creator `Polygonal Mind`.
- Registry record: public, non-draft, VRM, updated `2025-03-11T16:41:51.490Z`.
- Canonical compact record SHA-256: `6666ec558d020632b6a2d2f3891b264a5bdbaa27ff8bea718796324f989e59b6`.
- Model: 1,223,740 bytes; SHA-256 `6dc381245877db614e4021c91b1eb646a340468628a112da52ed2b66d116e719`.
- Thumbnail: 1,199,496 bytes; SHA-256 `727cacd0795187cce551efe7df2b20650a5ddbcda1ce21bcae37074ddb62a68e`.
- Embedded VRM 0.x metadata: title Toothpaste, author Polygonal Mind, `allowedUserName=Everyone`, `commercialUssageName=Allow`, `licenseName=CC0`; 52 humanoid bone declarations, one mesh and one texture.

The exact Arweave URLs and hashes are pinned in `src/main/marketplace-catalog.ts`. The paid revision is queryable by the main-owned asset broker but is not projected into the commerce-disabled bundled catalog, not made free, and not bundled into the package.

## Offer admission

`admitToothpastePilotOffer` rejects environment drift from:

- offer `offer.avatar.toothpaste.base-sepolia-pilot`, revision 1;
- product `avatar.toothpaste`, revision 1;
- avatar revision `toothpaste-6dc38124-v1`;
- catalog `desky-paid-pilot:1`;
- amount `100000` atomic Base Sepolia test USDC (0.10 USDC).

Region and merchant remain explicit deployment inputs. The initial funded matrix will use `ZA`; worldwide is recorded as launch intent pending a production legal/tax/sanctions allowlist.

## Live protocol facts

- `GET https://x402.org/facilitator/supported` returned HTTP 200 and advertised x402 v2 `exact` on `eip155:84532`.
- `GET https://x402.org/facilitator/status` returned HTTP 404. Status lookup is not in the admitted x402 v2 facilitator contract.
- Base RPC `eth_chainId` at `https://sepolia.base.org` returned `0x14a34` (84532).
- Circle's Base Sepolia test USDC contract remains `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.

Decision: keep the facilitator for one-shot verify/settle and use an independent Base observer for recovery. The observer searches exact `AuthorizationUsed(payer, nonce)`, validates a successful receipt containing exactly one matching USDC `Transfer`, and requires three confirmations. It never resubmits settlement and never interprets event absence as failure.

## Executable closure

- Bounded strict HTTPS JSON-RPC transport permits only the required read methods, refuses redirects, caps response size and validates every quantity/log/receipt.
- The reconciliation worker handles at most 25 candidates and refuses an observation scan above 1,000 rows.
- Chain facts enter the existing append-only monotonic observation ledger.
- Settled evidence feeds `HostedPaidGrantService`, which derives deterministic event/grant IDs and calls the existing PostgreSQL atomic settlement-to-entitlement transaction.
- Granted orders are excluded from operational indeterminate counts and active reconciliation queues.
- A real PostgreSQL-shaped checkout test now proves facilitator settlement, exact paid grant, active asset grant and empty post-grant queue without persisting browser verifier, cookie, CSRF or wallet signature.

## Verification

- Ten new/extended observer, offer, grant, licence and avatar test cases cover rights isolation, exact offer drift, no-grant unknown state, event/receipt/amount/confirmation validation, replay canonicalization and atomic grant projection.
- Full root matrix: 452 passed, 10 skipped across 91 files.
- Full hosted matrix: 23 passed across four files, including the extended PostgreSQL checkout-to-grant path.
- Root and hosted TypeScript checks passed.
- ESLint passed.
- Hosted build passed with zero production dependency vulnerabilities.
- Final Netlify deploy `6a8dde7206c6893fd39ea242` enabled only `DESKY_BASE_SEPOLIA_RPC_URL=https://sepolia.base.org`; offer and merchant remain absent. It includes deterministic settled replay and lowercase transaction-reference canonicalization.
- Live `/healthz` remained 200 and `/readyz` remained the expected sanitized 503 before payment admission.

## Open funded gate

1. Owner supplies a dedicated Base Sepolia merchant receive address; payer must be a different MetaMask account.
2. Complete a successful Supabase **app-user** authentication exchange. Dashboard/CLI login is not an app bearer token.
3. Configure the exact offer and merchant together; verify facilitator and RPC readiness becomes 200.
4. Fund payer with Base Sepolia test USDC; test ETH is optional for the x402-sponsored transfer path.
5. Execute success, user rejection, wrong chain/account, insufficient funds, malformed signature, expiry, replay, concurrent dispatch, settle timeout/callback loss, process restart, three-confirmation observation, atomic grant, delivery and clean-device recovery.
6. Restore `/readyz` to 503 immediately on invariant, observer, backup, paging or custody failure.

No Base mainnet or Store commerce is admitted by this work.
