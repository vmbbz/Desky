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

### Direct macOS

- Developer ID Application signing.
- Hardened runtime and notarization.
- Stapled ticket and Gatekeeper verification on a clean machine.
- Signed update feed with rollback plan.
- Clear first-run disclosure before launching local agent processes.

## Windows requirements

### Microsoft Store

- Reserve product identity in Partner Center before final manifest values are committed.
- Package as MSIX for Store-managed identity, install, and update.
- Run Windows App Certification Kit before submission.
- Test clean install, upgrade, uninstall, protocol registration, file access, and multi-monitor behavior.
- Store submission packages are re-signed by Microsoft; direct packages still require publisher signing.

### Direct Windows

- Authenticode-sign installer and application binaries.
- Verify SmartScreen reputation plan and timestamping.
- Signed update channel separated from Store-managed updates.
- Test standard-user install and uninstall without residue outside documented user data.

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
