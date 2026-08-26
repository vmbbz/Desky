# F6a.1 immutable release-profile verification — 2026-08-26

## Result

The Windows Store-free and Windows direct package graphs now derive from immutable build-time manifests and pass reciprocal inspection of their packaged ASAR archives. This is engineering release-profile evidence, not Store signing or certification.

## Authority

- `development-direct` is the explicit ordinary development package.
- `windows-store-free`, `windows-direct`, `macos-store`, and `macos-direct` are the only admitted release-candidate IDs.
- Every admitted profile has commerce disabled.
- Unknown IDs, including `windows-store-third-party-commerce`, and cross-platform profile use fail before packaging.
- Main validates exact manifest keys and Store/local-process invariants; it does not read `DESKY_DISTRIBUTION`.
- The exact baked profile is visible through bounded runtime diagnostics.

## Artifact matrix

| Artifact | Required graph | Forbidden graph | Result |
| --- | --- | --- | --- |
| `windows-store-free` | remote OpenClaw | Codex stdio, Hermes execution API, Claude SDK, x402/payment signatures | pass; 12,879,998 combined bytes inspected |
| `windows-direct` | OpenClaw, Codex stdio, Hermes execution API | Claude SDK, x402/payment signatures | pass; 12,941,725 combined bytes inspected |

The verifier extracts `.webpack/main/index.js`, renderer and preload from the packaged `app.asar`. It checks the exact profile marker, package entry, executable-provider signatures, x402 routes, payment header, official Base Sepolia USDC address, and Claude SDK markers. Generated packages remain excluded from Git.

## Verification

- `npm run typecheck`: pass.
- `npm run lint`: pass.
- Release-manifest and profile-runtime fixtures: 10 tests passed.
- `npm run package:windows:store-free`: package and artifact policy pass.
- `npm run package:windows:direct`: package and artifact policy pass.
- Clean-profile Windows direct startup: remained alive for the bounded smoke interval; the exact spawned process tree was then stopped. The disposable user-data directory is outside the repository.
- Full root suite: 90 files passed, 7 skipped; 491 tests passed, 12 skipped.
- Hosted commerce: 5 files and 29 tests passed; typecheck and production build passed.
- Root and hosted production dependency audits: zero reported vulnerabilities.
- Full root audit: 31 Electron Forge/build-tool advisories remain the documented upstream release gate; no forced incompatible downgrade was applied.

## Remaining release gates

1. Generate SBOM, third-party notices, hashes, provenance and signed release metadata.
2. Supply legal publisher identity, source licence, privacy/support/security URLs and Microsoft/Apple accounts.
3. Add MSIX/MAS makers, signing, notarization and clean install/update/uninstall evidence on target hardware.
4. Admit any commerce-enabled profile only through a separately reviewed artifact and Store declaration/submission.
