# x402 avatar-market fact check — 2026-08-24

## Purpose

This note validates the owner's supplied x402/Base/Solana/JWT ideation against the current Desky codebase, the pinned Open Source Avatars registry, primary protocol documents, current store policies, and visible market comparables. The supplied research remains useful ideation, but it is not an implementation specification.

This is product and engineering research, not legal, tax, sanctions, securities, or app-review advice. Policy-sensitive conclusions must be rechecked immediately before submission.

## Executive findings

1. **x402 is viable as an optional direct-distribution payment rail.** Protocol v2 defines transport-independent payment requirements, CAIP-2 network identifiers, facilitator verification/settlement, and Base and Solana implementations. It does not provide Desky's catalog, accounts, durable orders, refunds, device recovery, or entitlements.
2. **JWT is an access credential, not the purchase ledger.** A signed short-lived token can efficiently authorize catalog and asset requests, but a server-side entitlement record must remain authoritative for restore, revocation, refund, support, and key rotation.
3. **The production asset path must not be a GitHub/PAT proxy.** GitHub can remain a source and provenance reference. Admitted immutable assets belong in content-addressed object storage behind a CDN, signed manifests, bounded signed URLs, and integrity verification.
4. **The product should sell a Desky-ready entitlement, not claim exclusive ownership of an open avatar.** The paid value is compatibility admission, safe animation profiles, signed delivery, updates, collections, and support. Source, creator, licence, and attribution remain visible.
5. **The storefronts need separate commerce profiles.** Microsoft currently documents third-party commerce for non-game Windows apps. Apple's current guideline still requires in-app purchase to unlock digital content unless a specifically available storefront entitlement applies. The conservative Mac App Store profile therefore uses StoreKit and disables x402 purchase calls to action; direct Windows/macOS builds may offer x402 subject to legal review.
6. **Agents may recommend and prepare, but not silently spend.** x402 explicitly supports machine clients, but client budgets and approval are implementation-specific. Desky must require an exact human confirmation showing asset, amount, stablecoin, network, merchant, and expiry before a wallet signs.
7. **Three genuinely useful free avatars are a sound starting point.** The rest should not be paywalled until they pass technical and rights admission. “Free” and “paid” are offer policy, not properties copied from the upstream registry.

## Primary-source protocol facts

### x402 v2

The [x402 v2 specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md) separates protocol types, payment logic, and transport representation. HTTP uses a `402 Payment Required` response and `PAYMENT-REQUIRED`/`PAYMENT-SIGNATURE` headers. The resource server may verify and settle through a facilitator.

The protocol uses exact payment terms including:

- `network` in CAIP-2 form;
- atomic `amount`;
- an exact `asset` identifier;
- `payTo` recipient;
- a bounded timeout; and
- optional extensions.

[Current network documentation](https://docs.x402.org/core-concepts/network-and-token-support) identifies Base mainnet as `eip155:8453` and Solana mainnet by its CAIP-2 genesis-hash identifier. Production support is facilitator-specific. The public default x402.org facilitator is documented as testnet-only, so it cannot be silently promoted to a production dependency.

The [v1-to-v2 guide](https://docs.x402.org/guides/migration-v1-to-v2) confirms that v2 split chain mechanisms into `@x402/evm` and `@x402/svm`. Desky must pin an exact audited SDK version and conformance-test the chosen facilitator rather than copying a v1 blog example.

The optional [signed offer and receipt extension](https://github.com/x402-foundation/x402/blob/main/specs/extensions/extension-offer-and-receipt.md) is promising for audit/dispute evidence, but its document explicitly warns that wire placement may evolve. Desky's own durable order receipt cannot depend on an optional evolving extension alone.

### What x402 does not solve

The specification explicitly leaves client-side budget management and session handling outside its core. Desky must own:

- offers, prices, regions, and availability;
- human approval and wallet handoff;
- order idempotency and reconciliation;
- durable entitlements and restore;
- refunds, takedowns, and support history;
- catalog and asset delivery;
- tax and consumer disclosures; and
- platform-specific commerce policy.

Therefore `x402 payment == durable unlock` is an invalid architecture.

## JWT and entitlement facts

[RFC 7519](https://datatracker.ietf.org/doc/rfc7519/) defines claims such as issuer, audience, expiry, and token ID. [RFC 8725](https://datatracker.ietf.org/doc/html/rfc8725.html) requires explicit algorithm verification and validation of issuer and other contextual claims.

For Desky:

- the entitlement database is the source of truth;
- an access JWT is a short-lived projection of currently valid grants;
- the verifier pins accepted algorithms and validates `iss`, `aud`, `sub`, `iat`, `nbf`, `exp`, and `jti`;
- `kid` selects a published rotation key from JWKS;
- an access token contains opaque identifiers and scopes, never merchant secrets, wallet private keys, raw model URLs, or sensitive payment payloads;
- refresh/recovery credentials live in the OS credential vault; and
- refund, account compromise, or catalog takedown can stop future token issuance even if an already issued token remains valid until its short expiry.

JWT-only storage would make purchase restoration, support correction, revocation, and key rotation unreliable. It is rejected.

## Store-policy findings

### Microsoft Store

Microsoft's current [Store publishing guide](https://learn.microsoft.com/en-us/windows/apps/publish/get-started) says non-game apps may use their own commerce platform and retain that revenue, or use Microsoft commerce. Its current [Win32 distribution comparison](https://learn.microsoft.com/en-us/windows/apps/distribute-through-store/how-to-distribute-your-win32-app-through-microsoft-store) also lists Microsoft, own, or third-party commerce for packaged Win32 apps.

Desky is still subject to certification, content licensing, accurate disclosures, privacy, regional law, and any cryptocurrency-specific review applied at submission. The Microsoft Store build can be designed to support x402, but this remains a certification gate—not a promise.

### Mac App Store

Apple's current [App Review Guideline 3.1.1](https://developer.apple.com/app-store/review/guidelines/) says digital features/content unlocked in the app must use in-app purchase and expressly lists cryptocurrencies and wallets among mechanisms that cannot independently unlock functionality. External purchase options are storefront- and entitlement-dependent; Apple's [External Purchase documentation](https://developer.apple.com/documentation/storekit/external-purchase) requires runtime eligibility checks and region-specific entitlements/reporting.

The safe release profile is:

- Mac App Store: StoreKit products and restore; no visible or callable x402 purchase flow unless Desky later qualifies for and correctly implements an applicable entitlement;
- notarized direct macOS: x402 may be offered with browser/wallet handoff and clear disclosures;
- entitlement service: accepts StoreKit and x402 order evidence into one product-independent grant model.

“Bypass the App Store” is prohibited language and prohibited strategy. Direct distribution is a separate supported channel, not evasion.

## Licence and catalog findings

The pinned local clone of `ToxSam/open-source-avatars` is commit `0f9a1b2fd99894736563d55b2c9dc9125700d081`. Its project files currently describe:

| Project | Project licence | Entries |
| --- | --- | ---: |
| 100Avatars R1 | CC0 | 100 |
| 100Avatars R2 | CC0 | 100 |
| 100Avatars R3 | CC0 | 100 |
| VIPE Heroes Genesis | CC-BY | 3,000 |
| Grifters Squaddies | CC0 | 812 |
| ToxSam | CC0 | 10 |
| Halloween Rising | CC0 | 60 |
| Xmas Chibis | CC0 | 80 |
| NeonGlitch86 Collection | CC0 | 12 |
| **Total** | **8 CC0 projects; 1 CC-BY project** | **4,274** |

These are registry claims, not Desky admission decisions. Desky must join each avatar to its project record and inspect the exact VRM's embedded usage metadata.

[CC0](https://creativecommons.org/publicdomain/zero/1.0/deed.en) permits copying, modifying, and commercial distribution without permission, while warning that trademark, publicity, privacy, and other rights may remain. [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) permits commercial sharing/adaptation with appropriate credit, licence link, and modification notice, and prohibits additional legal or effective technological restrictions that prevent licensed reuse. The upstream VIPE project record says only `CC-BY`, without a version or canonical licence URL; its 3,000 entries therefore remain blocked until the exact terms are established rather than assumed to be 4.0.

Consequences:

- Desky can charge for its service and convenience around qualifying works.
- Desky must not imply that payment transfers exclusive copyright or that the original public source becomes unavailable.
- Attribution and source/licence details are never paywalled.
- CC-BY assets require an attribution implementation and legal review of any access-control design before admission.
- NFT origin in metadata is provenance only; token ownership is neither required nor accepted as the asset licence.

## Market signal, not a pricing verdict

Current visible comparables span very different value propositions:

- [Desktop Mate's official Steam DLC catalog](https://store.steampowered.com/dlc/3301060/Desktop_Mate/) commonly lists licensed characters at USD 14.99 with bespoke models, motions, effects, and sometimes voice.
- [Animaze's official individual pricing](https://www.animaze.us/pricing-individual) combines a meaningful free catalog with a low annual plan that unlocks its original content and higher-end capabilities.
- The US Mac App Store listing for [Desktop Buddy](https://apps.apple.com/us/app/desktop-buddy/id6767550340?mt=12) uses a small one-time app price, individual character credits, and a low-cost unlock-all offer.

The signal is consistent: motion richness, character identity, interaction, audio, and polish create value. A raw open model file does not justify licensed-character DLC pricing.

Recommended research hypothesis—not a committed price list:

- three permanent free companions;
- low-friction individual Desky-ready unlocks;
- themed value packs;
- an optional catalog pass only after recurring updates exist; and
- no per-avatar monthly subscription.

Price points must be tested with landing-page intent, a non-charging checkout prototype, regional tax-inclusive display, and cohort retention. The catalog must be useful without payment.

## Corrections to the supplied research note

| Supplied idea | Decision |
| --- | --- |
| JWT can remove the need for a database | Reject. JWT is a short-lived access credential; durable entitlement state is mandatory. |
| Premium files can be proxied from private GitHub with a PAT | Reject. Use immutable object storage/CDN; never put a GitHub token in the client or make GitHub the production entitlement boundary. |
| Base and Solana can both be supported | Accept as separate payment adapters behind one order model; start with one mainnet only after testnet conformance and operational review. |
| Agents can autonomously buy avatars | Narrow. Agents may search, recommend, and prepare checkout; a human approves every purchase and the agent never receives wallet authority. |
| Store build can bypass commissions with crypto | Reject. Each storefront gets an explicit compliant commerce capability profile. |
| Open-source avatar means automatically sellable | Reject. Project licence, embedded permissions, attribution, compatibility, and provenance all gate admission. |
| Tiny recurring payment per avatar | Reject for launch. It creates disproportionate consent, support, recovery, and accounting friction. |
| Huge catalog at launch | Reject. Start with three excellent free avatars and a small admitted paid set; expand through a measurable pipeline. |

## Research-to-build decision

The smallest credible implementation is deliberately payment-free:

1. define the normalized catalog and admission record;
2. select and package/cache three CC0, compatibility-proven free avatars;
3. add the first-class Marketplace route, grid, detail, preview, source/licence, and `Free`/`Unlocked`/`Locked` states;
4. implement a commerce-neutral entitlement interface whose only initial provider is `free`;
5. implement motion-energy presets and per-avatar compatibility profiles; and
6. test replacement, restart, offline use, cache integrity, accessibility, and low-end GPU behavior.

Only then should Desky add the entitlement service and a Base testnet x402 adapter. This sequence proves that the product being sold is worth unlocking before money enters the system.
