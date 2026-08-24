# Distribution strategy

## Release channels

Desky will ship from one source tree through distinct capability profiles.

| Channel | Package | Updates | Local agent processes | Status |
| --- | --- | --- | --- | --- |
| Microsoft Store | MSIX | Store managed | supported where certification permits | planned |
| Windows direct | signed installer | signed in-app updater | supported | planned |
| Mac App Store | MAS app bundle | App Store managed | arbitrary installed CLIs excluded | planned |
| macOS direct | notarized DMG/ZIP | signed in-app updater | supported | planned |
| GitHub Releases | checksums and provenance for direct packages | channel dependent | channel dependent | planned |

## Windows launch decision — 2026-08-25

Desky launches through two complementary Windows channels from one source tree:

1. **Microsoft Store:** an MSIX, free-only release with x402 adapters, payment commands, checkout UI, merchant configuration, and external purchase calls to action absent from the artifact.
2. **Desky website:** a separately signed direct installer with its own signed update channel. The website presents both **Get from Microsoft** and **Download for Windows**, with the capability difference stated before installation. A versioned GitHub Release may mirror the direct artifact and checksums; `winget` can be added later for discovery.

Microsoft documents both Store and direct website distribution. MSIX Store submissions receive Store-managed updates; direct distribution requires trusted code signing, hosting, and an update mechanism. See [Microsoft's distribution-path guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-distribution-path).

“Disabled” means build-time unreachable, not a hidden renderer button or remote feature flag. The x402 source remains in the repository and direct profile, but the initial Store bundle must not contain its adapter, SDK, routes, merchant configuration, or payment UI. After the company identity, legal/compliance, declarations, controls, and certification evidence exist, a new explicit `windows-store-third-party-commerce` artifact may be submitted as an update. That package and its updated metadata go through certification and an MSIX package flight/gradual rollout before public enablement; Microsoft documents that approved MSIX updates replace the prior package and reach existing users automatically. See [Store update management](https://learn.microsoft.com/en-us/windows/apps/publish/faq/manage-and-update-your-app).

No server-side switch may activate materially undisclosed commerce in an already certified free-only package. If the later Store submission is rejected or delayed, the Store release stays free-only and the direct channel remains independently supported.

## Why two capability profiles exist

The Mac App Store requires App Sandbox and disallows unrestricted behavior such as installing or executing downloaded code. A local Codex/Claude/Hermes launcher therefore belongs in the notarized direct build unless implemented as a fixed, bundled, sandbox-inheriting helper that passes review.

The Store build remains useful and complete through authenticated remote gateways, including self-hosted gateways reachable over secure network connections. Product pages must state this difference before purchase.

## macOS requirements

### Mac App Store

- Electron MAS runtime.
- App Sandbox entitlements for client networking and user-selected file access only when used.
- Apple Distribution signing, provisioning profile, and App Store Connect record.
- No custom updater.
- No arbitrary child executable discovery.
- Review account or fully featured simulation/remote demo path.
- Content, privacy, encryption/export, and NFT disclosures completed.
- Universal arm64/x64 build unless product data justifies separate architectures.
- Use StoreKit for digital avatar unlocks if premium content ships in this profile. x402 and external purchase calls to action are disabled unless Desky later qualifies for, implements, and re-verifies a storefront-specific Apple entitlement.

### Direct macOS

- Developer ID Application signing.
- Hardened runtime and notarization.
- Stapled ticket and Gatekeeper verification on a clean machine.
- Signed update feed with rollback plan.
- Clear first-run disclosure before launching local agent processes.
- May offer the separately disclosed x402 checkout after legal, wallet-handoff, tax, and entitlement-service gates pass.

## Windows requirements

### Microsoft Store

- Reserve product identity in Partner Center before final manifest values are committed.
- Package as MSIX for Store-managed identity, install, and update.
- Run Windows App Certification Kit before submission.
- Test clean install, upgrade, uninstall, protocol registration, file access, and multi-monitor behavior.
- Store submission packages are re-signed by Microsoft; direct packages still require publisher signing.
- Non-game third-party commerce is a planned capability, not an assumption: declare it accurately, document it in review notes, and keep x402 behind certification, regional, and legal gates. A Microsoft-commerce provider remains an interchangeable option.
- The initial Store release is free-only. Current Microsoft policy 7.19 allows secure third-party commerce for non-game PC digital goods but does not specifically approve x402; cryptocurrency initiation also triggers company-account/financial-transaction requirements. The mandatory evidence checklist is `docs/research/MICROSOFT-STORE-X402-POLICY-2026-08-24.md`.
- Later commerce is a new certified package submission, not a remote unlock. Use a private package flight, then gradual rollout; halting a rollout does not roll back devices already updated.

### Direct Windows

- Authenticode-sign installer and application binaries.
- Verify SmartScreen reputation plan and timestamping.
- Signed update channel separated from Store-managed updates.
- Test standard-user install and uninstall without residue outside documented user data.
- May offer x402 after the same production commerce and entitlement gates as direct macOS.

## Commerce capability matrix

| Channel | Free grants | x402 | Native store commerce | Default paid-content posture |
| --- | --- | --- | --- | --- |
| Windows direct | yes | planned | no | x402 after production gates |
| Microsoft Store | yes | disabled initially; later certification-gated | optional later | free-only launch |
| macOS direct | yes | planned | no | x402 after production gates |
| Mac App Store | yes | disabled by default | StoreKit | StoreKit or free-only launch |

This matrix is enforced by signed build/runtime capability, not renderer visibility or a remote flag alone. Direct distribution is a distinct supported channel and must never be described as bypassing a store. See `docs/COMMERCE-ENTITLEMENTS.md`.

The current development helper reads `DESKY_DISTRIBUTION` and defaults to `direct`; that is not a release-grade authority. Before any paid provider becomes reachable, packaging must generate a fail-closed immutable release manifest for `windows-store-free`, `windows-store-third-party-commerce`, `windows-direct`, `macos-store`, or `macos-direct`. Main verifies it at startup, and package tests prove forbidden modules and routes are absent. Missing, unknown, or mismatched manifests terminate commerce capability rather than falling back to direct.

## Store identity blockers

The following values cannot be invented in source control and must be supplied by the owner/store accounts:

- Legal publisher name.
- Apple Team ID, bundle identifier reservation, certificates, and provisioning profiles.
- Microsoft Partner Center publisher ID, package identity name, and store product ID.
- Support URL, privacy-policy URL, marketing URL, and security contact.
- Commerce model, price, territories, age rating, and NFT/catalog availability by storefront.

Build scripts will fail clearly when a signing job lacks required identity variables. Secrets never enter the repository.

## Release artifacts

Every release candidate records:

- Source commit and clean-tree assertion.
- Dependency lockfile hash.
- Package filename, byte size, and SHA-256.
- Signing identity summary without private material.
- Notarization/certification result.
- Software bill of materials and third-party notices.
- Avatar/animation provenance manifest.
- Test matrix and known limitations.

## Review risks tracked from the beginning

- Transparent always-on-top behavior must remain controllable and accessible.
- Downloaded avatars are data, not code; catalog content requires moderation and licence evidence.
- NFT browsing and external purchase links vary by storefront and region.
- Agent tool activity and filesystem access must match disclosures.
- A minimal wrapper or incomplete demo will fail completeness review; the control surface and functional remote/simulation review path must ship.
