# F3b motion-runtime foundation verification — 2026-08-22

## Scope

This record covers the deterministic full-body state arbiter, rights-gated clip admission, Three.js mixer lifecycle, procedural fallbacks, cancellation semantics, and system reduced-motion route. It does not claim that a production animation clip has been approved or that the later conversational, action, expression, look-at, blink, and viseme layers are complete.

The later F3b.2 record documents the first asset-free cue, blink, look-at, and state-expression slice. Production clips, agent semantic actions, visemes, and the complete compatibility/performance matrix remain open.

## Implemented contract

- The normalized companion domain now has ten explicit states, including `cancelled` as distinct from `error`.
- OpenClaw native aborts and acknowledged user cancellations retain the terminal `turn.failed` event while setting `payload.kind: cancelled`. Missing or explicit error kinds enter the recoverable error state.
- `motion-arbiter.ts` resolves concurrent semantic state requests by a fixed priority table. Cancellation, approval, and disconnection outrank lower-priority state motion.
- One exact state registration owns full-body motion. Stable explicit order and then canonical clip ID resolve alternatives; model text and tool arguments never select animation.
- `admitMotionClip` reparses the approved manifest and canonical payload, matches clip ID, state intent, `state` layer, sample rate, and playback policy, verifies the exact canonical output SHA-256, refuses cancellation clips, and deep-freezes admitted data.
- `avatar-motion-controller.ts` owns the target VRM mixer, canonical binding, loop/one-shot lifecycle, clip fades, stale-action cleanup, immediate cancellation stop, baseline restoration, invalid-target fallback, and disposal.
- Every state has a deterministic procedural fallback, so the open-source avatar path does not depend on an unapproved external animation.
- The renderer observes `prefers-reduced-motion`, suppresses full-body clips and time-varying travel, and keeps a small static semantic pose with readable text.

## Automated evidence

The final repository run completed with:

| Gate | Result |
| --- | --- |
| Vitest | 15 files passed, 1 opt-in live file skipped; 62 tests passed, 1 live test skipped |
| TypeScript | `tsc --noEmit` passed |
| ESLint | passed |
| Animation converter bundle | webpack compiled successfully |
| Production dependency audit | zero reported vulnerabilities with development dependencies omitted |
| Electron Forge package | fresh Windows x64 package completed |

Motion-specific fixtures cover:

- a fallback mapping for all ten states;
- authoritative cancellation/approval/disconnection priority;
- stable registration ordering and clip ID tie-breaking;
- approved-manifest and output-checksum admission;
- semantic mismatch and cancellation-clip rejection;
- deep-frozen admitted canonical data;
- mixer playback and one-shot settling;
- deterministic state poses and immediate cancellation restoration;
- reduced-motion stability;
- target-avatar binding failure fallback;
- mixer/transform disposal;
- OpenClaw abort classification, reducer cancellation, and rejection of late tool events after cancellation.

## Packaged Windows smoke

A fresh `win32-x64` package loaded through the production `desky://` scheme. The ignored visual capture and DOM diagnostic showed a complete renderer with the current remote default loaded as:

```text
Milk · VRM 0.x · CC0 · 100Avatars R1
```

The saved local OpenClaw relay was disconnected, so this packaged smoke exercised the explicit offline state and its avatar fallback. No screenshot, package, downloaded model, token, or other generated test output is committed.

## Asset boundary

The avatar continues to come from the [ToxSam Open Source Avatars registry](https://github.com/ToxSam/open-source-avatars). Desky joins the selected avatar to its collection's declared licence; it does not treat the registry-wide metadata licence as a blanket licence for every avatar or any unrelated animation. Milk currently resolves through the CC0 `100avatars-r1` collection. Production animation remains separately blocked until source and converted output pass the approved manifest and checksum gate.

## Remaining evidence

- Approve and admit the first production animation with commercial/store redistribution rights.
- Repeat playback across reviewed binary VRM 0.x and 1.0 fixtures and validate feet, hips scale, proportions, and spring-bone interaction.
- Capture the packaged live state matrix for thinking, tool work, approval, speaking, success, error, cancellation, and recovery.
- Measure cancellation response and 120–250 ms fades on reference hardware rather than relying only on deterministic fixtures.
- Add the product-level pause/reduced-motion override, occlusion suspension, WebGL recovery, and macOS packaged evidence.
