# F6a.2 Windows release-engineering verification — 2026-08-26

## Outcome

The Windows release path is executable and fail-closed for both admitted channels. The Store-free artifact is a real MSIX and the website artifact is a real Squirrel installer/update payload. Both derive from the immutable F6a.1 manifest and are independently inspected after packaging. These development artifacts are not uploadable production releases.

## Implemented boundary

- `release.maker.config.ts` admits only `windows-store-free` MSIX or `windows-direct` Squirrel for Windows release profiles.
- Production Store packaging requires the exact Partner Center package identity, `CN=` publisher subject and publisher display name; Partner Center performs the final signature.
- Production direct packaging requires an absolute external PFX path, password and publisher display name. Signing material is never read from the repository.
- Development makers use `Desky.Companion.Development`, `CN=Desky Development`, and separately named `Desky Development` installs. Generated evidence sets `uploadable: false`.
- The MSIX contains the official Desky Windows assets generated reproducibly from `branding/logo/desky-app-icon-512.png`. Base 44x44/150x150 assets and scale-qualified variants have their exact declared dimensions.
- Store-free verification unpacks the MSIX with MakeAppx, verifies identity/publisher/version/architecture/device family/executable plus all nine asset hashes, then runs the packaged-ASAR capability oracle. Direct verification unpacks the full NuGet payload, checks the Squirrel `RELEASES` binding, signature policy and packaged-ASAR capability oracle.
- `release/artifact-budgets.json` rejects a Store MSIX above 180,000,000 bytes or direct installer/update payload above 195,000,000 bytes.
- Every successful make emits a validated reproducible CycloneDX 1.6 source-runtime lockfile SBOM, combined asset/dependency notices, zero-production-vulnerability audit, SHA-256 digest set and build metadata explicitly labeled `desky-build-evidence-not-slsa`. Production evidence additionally requires a clean tree.

## Reference artifacts

| Profile | Development artifact | Bytes | SHA-256 | Budget |
| --- | --- | ---: | --- | ---: |
| Store-free | `Desky.msix` | 158,351,776 | `3d8617fd4e0e92e634bbb28771f39f378d6464498a91307530a8f9005f7574b9` | 180,000,000 |
| Direct | `Desky-0.1.0-Development-Setup.exe` | 148,262,912 | `cde43c685eb8f659d7558366691d13d413e590fcbe80ff681673e6514faa4b6a` | 195,000,000 |
| Direct update | `desky_development-0.1.0-full.nupkg` | 147,217,396 | `b29a08c165fcc641ae1fef150c028113b06b01a18c53d698d1edab1427b1592a` | 195,000,000 |

Generated artifacts and reports remain under ignored `out/`; the table is evidence, not a release download promise.

## Lifecycle evidence

The development MSIX lifecycle installed `0.1.0.0`, applied `0.1.1.0`, launched the updated app through its AppsFolder identity, observed it alive after four seconds, uninstalled it, and removed the exact temporary machine trust and maker-created private certificate. Install/update digests were `3468d8ec8f1f8a7a0848a927b4526299b51b89e44f06a6071bb6854f70bdc02d` and `c3922be807d6425e40b3406a8bc3005d5e26e7d729d7315e6b22df93577f1046`.

The direct lifecycle installed into the isolated development Squirrel root, launched the app and observed it alive after five seconds, verified `RELEASES` binds the full update payload, invoked Squirrel uninstall, verified process and registry removal, observed Squirrel's expected `.dead` tombstone, and safely removed only the test-owned root. Applying a direct version advance is not claimed: it requires the real signed HTTPS update channel.

## Windows App Certification Kit

The Windows 11 reference machine has WACK `10.0.26100.2454`. The first complete development-MSIX run returned `OVERALL_RESULT="PASS"` with zero required failures. It exposed incorrect base tile dimensions; the source renderer was corrected from 88/300 to exact 44/150 while preserving scale-200 assets. The final corrected run also returned overall PASS with zero required failures and no app-resource-size failure. Its single optional failure is the blocked-executable heuristic, which identifies Electron's `CreateProcessW` import and short case-insensitive byte/string matches such as `cmd`, `reg` and `bash` in Electron/Chromium binaries and resources. Store-free ASAR policy independently proves Desky does not construct the local Codex/Hermes process adapters. The generated summary is at `out/release-evidence/windows-store-free/wack-report.summary.json`; release evidence admits it only when the summary binds the exact current MSIX SHA-256 and the overall/required results pass.

The certification harness requires an elevated active user session because Microsoft's kit installs the package. It temporarily imports only the exact `CN=Desky Development` signer into `LocalMachine\\TrustedPeople`, and removes both that trust and the maker-created Current User private key in `finally`.

## Dependency posture

`npm audit --omit=dev` reports zero vulnerabilities. The full development tree reports 32: 1 critical, 25 high, 3 moderate and 3 low. The increase from 31 is the newly admitted experimental Forge MSIX maker/toolchain; npm's suggested fixes are incompatible historical major-version downgrades and were not applied. This remains a public-release gate requiring an upstream fix or written scoped acceptance on an isolated trusted builder.

Repository verification after the release changes passed ESLint, TypeScript and 498 tests; 12 live/external tests were explicitly skipped by their existing gates. All PowerShell release scripts parse successfully.

## Remaining production gates

- Reserve and supply the exact Partner Center identity and legal publisher values.
- Supply a protected Windows code-signing identity and timestamping policy for direct distribution.
- Run production makers from a clean protected worker, then verify Microsoft/Authenticode signatures and immutable evidence digests.
- Apply a real signed direct update through its HTTPS feed on a clean device/account.
- Re-run WACK/Partner Center validation with the final reserved identity and production package.
- Provide source licence, privacy/support/security URLs, Store metadata, declarations, screenshots and review notes.
- Complete the macOS signing/notarization and App Store work separately.

## Commands

```powershell
npm run make:windows:store-free:dev
npm run make:windows:direct:dev

# Elevated by the caller; development trust is removed automatically.
pwsh -NoProfile -File scripts/run-windows-app-certification.ps1 `
  -PackagePath out/make/msix/x64/Desky.msix `
  -ReportPath out/release-evidence/windows-store-free/wack-report.xml
```
