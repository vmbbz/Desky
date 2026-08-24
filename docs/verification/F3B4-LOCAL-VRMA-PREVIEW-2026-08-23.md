# F3b.4 local VRMA preview verification — 2026-08-23

## Scope

This round adds the smallest rights-safe external-animation path: a user explicitly selects a local `.vrma` in the control center and previews it on the ambient avatar without caching, bundling, or admitting it as a production asset.

## Implemented contract

- Control-center-only native select, replay, and clear commands.
- Main-process `.vrma`, binary glTF 2.0, exact container length, 32 MiB, JSON chunk, VRMC extension, humanoid map/channel, structural-count, embedded-resource, and SHA-256 validation.
- Typed IPC exposes basename/size/hash/bytes but never the raw source path.
- Selection and bytes remain in memory only and are dropped on clear or process exit.
- Ambient parsing uses `@pixiv/three-vrm-animation` 3.5.5 with 120-second and 256-track runtime bounds.
- One-shot playback uses the existing `AvatarMotionController` mixer, suspends additive expression ownership while the authored clip plays, restores baseline transforms, and resumes the accepted companion plan.
- A newly entered approval, cancellation, disconnection, or error state interrupts playback. Pending approval and effective reduced motion reject a new preview; a deliberate user preview can start later from a stable offline/error/terminal state without requiring a provider connection.
- System is the default motion policy; an explicit control-center Full or Reduced override applies across both windows for the current app session only.
- Monotonic request IDs prevent stale renderer status from overwriting the newest selection.

## Automated evidence

Focused tests cover:

- valid local VRMA container admission and exact SHA/bytes;
- source-path non-disclosure;
- extension, missing VRMC declaration, and external-resource rejection;
- monotonic requests, stale-report rejection, completion, clear, and no-selection replay failure;
- one-mixer preview playback, lifecycle callbacks, transform restoration, plan resumption, approval priority, and reduced-motion rejection.

The full repository verification and package result are recorded in the commit handoff for this round.

## Packaged Windows live evidence

The packaged `out/Desky-win32-x64/Desky.exe` was exercised against the live brokered Milk avatar with local research inputs that remain outside the repository and release manifest.

`WAVE.vrma`:

- path was selected through the native dialog and never displayed by Desky;
- 854,284 bytes, SHA-256 `6322bbe2df7716529dd53e2a61816e67b946416d3761c672b8d50ee2829825bb`;
- parsed as VRMC 1.0 with one 7.267-second animation, 52 humanoid rotation tracks and one hips-translation track;
- the initial System policy truthfully reported that preview was paused because Windows currently prefers reduced motion;
- explicit Full session override plus stable offline state produced `Playing WAVE.vrma.`, visible authored arm/body motion on Milk, and then `Finished WAVE.vrma.`;
- Play again produced the same lifecycle; ignored diagnostic captures are `out/live-diagnostics/vrma-wave-active.png` and `vrma-wave-finished.png`; and
- Clear removed the selection, restart restored no selection, and the motion preference returned to System.

`Wave_Right_01.vrma` was also selected as a negative fixture: 928,392 bytes, SHA-256 `26e1a6ff649ea9f26a3ecd0b1eae276117324f04c9ea4aa2c20653a1417c291c`. Its VRMC extension declares an empty `humanBones` map despite 96 raw channels. The packaged app rejects it before renderer parsing with `The VRM Animation humanoid bone map must include hips.` This explains why that converter output cannot animate a standards-based VRMA runtime; raising the track limit would not fix it.

The local files prove runtime compatibility and rejection behavior only. They are not admitted distributable assets and make no release-rights claim.

Active-preview interruption is now closed by the direct approval/cancellation/disconnection/error matrix and a packaged real-VRMA playback-to-interruption run recorded in `F3B10-EXECUTABLE-MOTION-CLOSURE-2026-08-24.md`. Still required: macOS packaged evidence and the representative rights-reviewed VRM 0.x/1.0 binary suite.
