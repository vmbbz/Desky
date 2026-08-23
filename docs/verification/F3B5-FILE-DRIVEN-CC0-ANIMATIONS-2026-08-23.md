# F3b.5 file-driven CC0 animation verification — 2026-08-23

## Outcome

The first rights-approved candidate animation library is implemented and packaged on Windows. Runtime animation choice is driven by a validated generated file: source clip names, state bindings, program steps, tags, weights, quiet intervals, cooldowns, and action mappings are not listed in scheduler/controller code.

This evidence admits the CC0 sources and proves deterministic conversion, cryptographic runtime admission, structural VRM binding, sequence ownership, interruption, accessibility fallback, and packaged startup. It does not close the Store visual matrix on representative real VRM 0.x/1.0 binaries.

## Source and output evidence

- Universal Animation Library Standard archive: `cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724`
- UAL1 non-root-motion FBX: `21b32d912da3cb93426d974fb945e86f5b2e86970acd2ce89905e0fbf9f1dcc2`
- Universal Animation Library 2 Standard archive: `4008ea208a604773a2b2177d965f0f5d3195498b5bf838c3f5785d68e95f2a68`
- UAL2 non-root-motion FBX: `d26d0e9f4a202d473194c056045143095a605a53ba1d823ef24055be4b86851d`
- Generated catalogue: 10,251,045 bytes, SHA-256 `d0df05af9c762c34591a43d9b4b4a5f39648c0bd347763ebbf82708d5bba3277`
- Rebuilt catalogue: identical byte count and SHA-256
- Source records: 86
- Excluded authoring records: two `Armature|A_TPose` clips
- Canonical clips: 84
- State bindings: idle, speaking, working
- Programs: 15 total; 12 ambient, one Jump action, two catalog-only candidates

Both included source `License.txt` files declare CC0 1.0. The plan records the project-owner review, exact sources, acquisition/conversion timestamps, and per-clip source selection. `THIRD_PARTY_NOTICES.md` preserves the voluntary credit and source links.

## Automated verification

Commands:

```powershell
npm run lint
npm run typecheck
npm test
npm run build:animation-converter
node out/tools/desky-animation-converter.cjs build-library --plan assets/animation-library.plan.json --output out/repro/quaternius-uam-standard-v1.library.json --workspace-root .
npm run package
```

Results:

- ESLint: pass
- TypeScript: pass
- Vitest: 28 files passed, one opt-in live file skipped; 123 tests passed, one live test skipped
- Converter webpack build: pass
- Deterministic rebuild: exact SHA-256 match
- Electron Forge Windows x64 package: pass
- Final `app.asar`: 11,856,838 bytes
- Packaged process stayed running and responsive with a visible `Desky` main window

The library-specific tests prove:

- both source clip counts and T-pose exclusions;
- exact rich inventory presence, including idle, phone, walk, sprint, sit, lay transition, swim, crouch, magic, combat, and driving edge cases;
- every canonical/manifest pair reparses and matches its SHA-256;
- all 84 clips bind to full structural VRM 0.x and 1.0 targets;
- autonomous selection uses file-defined mode, weights, intervals, cooldowns, and repeat exclusion;
- real built-in Jump resolves and completes `Jump_Start` then `Jump_Land` through one mixer/body owner;
- approval interrupts a file-authored program and restores baseline;
- reduced motion suppresses authored full-body playback and retains procedural acknowledgement.
- packaged diagnostics confirm the renderer frame loop is live and report effective motion policy, active program, active cue, pending cue count, and clip errors; when Windows prefers reduced motion, the companion truthfully remains static until Full is selected in the control center.
- packaged Full-motion Milk capture reports `motionReduced: false`, `activeProgram: jump`, `activeCue: user-jump-1`, and no clip or preference error; its SHA-256 differs from the Full-motion baseline capture, confirming a visible authored in-flight pose.

## Manual gates still open

- Confirm the visible status reports `84 CC0 motions` on the current Milk load.
- Observe several idle programs and explicit Jump on packaged Milk; tune any unsuitable human-proportion, floor-contact, or missing-prop behavior in the plan.
- Observe several idle/disconnected programs with explicit Full motion when the host reports `prefers-reduced-motion: reduce`; System is intentionally accessibility-safe and otherwise suppresses authored loops and Jump travel.
- Repeat enabled-program playback and interruptions on reviewed real VRM 1.0 plus materially different proportions.
- Decide whether `LayToIdle` has a truthful, reversible sleep sequence; it remains catalog-only meanwhile.
- Complete macOS, multi-monitor, occlusion, reduced-motion, WebGL-loss, sleep/wake, CPU, and memory evidence.
