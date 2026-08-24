# Microsoft Store and x402 policy review — 2026-08-24

## Decision

Microsoft's current published policy does not categorically prohibit Desky, as a non-game PC app, from using a secure third-party purchase API for digital avatar access. That is not advance approval of x402. Because an x402 checkout initiates a cryptocurrency transaction, Desky treats Microsoft Store enablement as a certification, company-account, regional-legal, security, and disclosure gate.

The initial Microsoft Store release remains free-only. Its release profile must expose no x402 provider, payment command, external checkout, or paid UI. A direct Windows build is the first eligible x402 pilot after the entitlement and Base Sepolia gates. Store x402 can be considered later only with written policy review evidence and a certification-ready implementation.

## Primary-source findings

Checked against [Microsoft Store Policies 7.19](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies), published 2025-09-10 and effective 2025-10-14, plus the [policy change history](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies-change-history) and current [MSIX product declarations](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/product-declarations).

- Policy 10.8.1 permits non-game products on PC to use either a secure third-party purchase API or Microsoft Store in-product purchase for digital items/services consumed in the app.
- Policy 10.8.2 requires an allowed third-party transaction to identify the commerce provider, authenticate the user, obtain explicit confirmation, allow transaction authentication or disabling controls, and be declared in Partner Center.
- Policy 10.8.3 classifies initiating cryptocurrency transactions and handling private/API keys as financial information. If the product requires financial account information, it must be submitted from a company account; an individual-account product cannot require it for primary functionality.
- Policy 10.8.4 requires accurate in-app and Store metadata about purchase types and price ranges and an unmistakable purchase initiation.
- Policy 10.2.6 forbids on-device cryptocurrency mining. It permits wallets/trading platforms only from company accounts. Desky does not mine, trade, custody wallet keys, or embed a wallet.
- Policies 10.5.1–10.5.5 require a privacy policy, modern protection for personal/financial data, meaningful consent, and controls. Desky treats wallet addresses and payment references as sensitive operational data and excludes them from analytics.
- Policy 11.2 requires rights to every delivered avatar, animation, thumbnail, name, and marketing asset.
- If certification treats the companion catalog as a third-party storefront, policies 10.1.6 and 11.13 add catalog-size, terms, reporting, moderation, age/content, and legal obligations. Desky must be ready for that classification even though its primary function is an AI desktop companion.
- Desky also needs the Partner Center live-generative-AI declaration and metadata disclosure required by policy 11.16 and the current MSIX declarations.

## Non-negotiable Microsoft Store gate

Before enabling x402 in a Store-signed profile, all of the following must have current evidence:

1. Company Partner Center publisher identity and verified selling entity.
2. Re-check the policy version and target-country requirements immediately before submission.
3. Written certification notes describing x402, the facilitator/payment provider, wallet browser handoff, asset grant, refund/support path, and absence of custody/mining/trading.
4. Partner Center third-party-purchase and generative-AI declarations completed accurately.
5. Provider identity, exact amount/asset/network/recipient, authentication, and deliberate user confirmation shown in Desky's trusted UI before wallet handoff.
6. A setting to require authentication for each transaction and a master switch that disables in-product transactions.
7. Store metadata and in-app disclosures for purchase types, price range, licence/access terms, support, refunds, privacy, and regional availability.
8. Legal review for crypto payments, sanctions, tax/VAT/GST, consumer protection, refunds, and data retention in each selling region.
9. Marketplace content terms, reporting/moderation, rights evidence, and age controls sufficient for a possible storefront classification.
10. Packaged tests proving disabled regions/profiles have no checkout route and no payment SDK/merchant configuration.
11. A pre-submission certification flight; any rejection keeps the Store build free-only while the separate direct build remains independently supported.

## Why this avoids a Store ban risk

Desky will not hide or disguise x402, instruct reviewers to overlook it, or remotely activate an undeclared checkout after certification. Store and direct builds are separate signed capability profiles. Payment authority stays in the commerce service, wallet consent stays with the user, private keys never enter Desky, and a settled payment does not bypass the entitlement ledger.

No architecture can guarantee acceptance: Microsoft can interpret policy, request changes, restrict regions, or update its rules. The safe operational promise is narrower and enforceable: no x402 capability ships in the Microsoft Store package until it has passed the then-current gate above.

## Distribution decision update — 2026-08-25

The initial Store package is free-only and physically excludes x402 code paths. Desky's website separately offers a signed direct Windows installer. Source code stays shared, but a later Store x402 enablement is a new declared package submission that must pass certification and a controlled flight/gradual rollout. It is never a remote feature-flag activation of the previously certified package. The release-grade profile will be baked into the artifact and fail closed; the current development environment-variable selector is not accepted as commerce authority.
