# F4x.2e.8 explicit checkout authorization UX — 2026-08-26

## Outcome

Desky's hosted Base Sepolia checkout now makes the human payment boundary explicit. Connecting MetaMask is not presented as payment, does not request an EIP-712 signature, and cannot create a payment submission. A separate review state shows the canonical terms and selected paying account before an amount-labelled signing action.

Production deploy: `6a8f2df08c5c4cebb6a6bc14` at `https://desky-checkout-testnet.netlify.app`.

## Executable behavior

1. `Connect MetaMask` requests exactly one public account, admits Base Sepolia, and reads the official Circle test-USDC `balanceOf` value.
2. An insufficient balance raises the bounded `wallet-insufficient-usdc` code before `eth_signTypedData_v4` can run.
3. The review state displays item, exact amount, network, recipient, selected public account, and expiry.
4. `Sign <amount> USDC` rechecks the account with `eth_accounts`, network, balance and expiry before requesting the exact EIP-3009 typed signature.
5. An account change fails closed. A user rejection is reported as a cancelled signature with no submission or entitlement.
6. Submitted/unknown/pending states disable signing and instruct the user not to sign twice.
7. Failed, expired and cancelled sessions are non-retryable and direct the user back to Desky.

The balance preflight is not payment authority. The hosted facilitator verification, append-only settlement observations, independent Base observer and atomic entitlement transaction remain authoritative.

## Verification

- wallet/API/HTTP focused tests: 16 passed;
- root and hosted typechecks: passed;
- ESLint: passed;
- hardened hosted build: passed;
- deployed `/healthz`: 200;
- deployed `/readyz`: 200;
- deployed page: 200 with the expected same-origin CSP;
- live document contains `Connect MetaMask` and excludes the combined `Connect wallet and pay` wording.

The automated matrix proves that connect performs `eth_requestAccounts`, network admission and `eth_call`, but never `eth_signTypedData_v4`. It also proves insufficient test USDC fails before signing. A manual live rejection screenshot remains useful supplemental evidence but is not required to repeat the already completed funded purchase.
