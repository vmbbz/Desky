# F4.7 adaptive render performance — 2026-08-24

Platform: Windows 11 reference development machine, packaged x64 Electron application

This round replaces single before/after memory observations with bounded one-second process sampling across visible, native-hidden, and recovered phases. It then applies the documented 30 FPS ambient / 60 FPS deliberate-active policy and repeats the same package probe.

## Harness contract

- Wait for the selected avatar to reach `ready` and advance its render counter.
- Take ten one-second visible samples from Electron's renderer (`Tab`) and GPU metrics.
- Hide the real `BrowserWindow`, verify the renderer reports `native-hidden`, then take six one-second samples.
- Prove the frame counter remains exactly unchanged throughout the hidden interval.
- Restore with `showInactive()`, take three one-second samples, and prove frames advance again.
- Record sample counts, CPU average/peak, peak working set, lifecycle frames, and suspension reason in the ignored diagnostic JSON.

The probe is deterministic and bounded, but represents this machine and workload only. It is not a substitute for the final hardware matrix.

## Adaptive frame policy

- Ambient/disconnected/idle/autonomous life renders at 30 FPS.
- Thinking, working, approval, speaking, explicit user/agent cues, and local animation previews render at 60 FPS.
- Rendering remains entirely stopped while lifecycle suspension is active.
- The policy consumes normalized companion state and admitted runtime ownership, not gateway-provider names.

## Packaged results

| Phase/process | Before adaptive policy average CPU | Final average CPU | Final peak CPU | Final peak working set |
| --- | ---: | ---: | ---: | ---: |
| Visible renderer | 2.858% | 1.867% | 3.065% | 259,364 KiB |
| Visible GPU | 4.013% | 2.150% | 2.531% | 128,740 KiB |
| Hidden renderer | 0.016% | 0.010% | 0.054% | 253,944 KiB |
| Hidden GPU | 0.038% | 0.037% | 0.055% | 120,148 KiB |
| Recovered renderer | — | 1.546% | 1.607% | 254,068 KiB |
| Recovered GPU | — | 2.608% | 3.005% | 121,368 KiB |

The visible renderer average fell about 34.7%; visible GPU average fell about 46.4%. The renderer working set remains below the 350 MB target. Hidden work is near zero, and frame 582 remained exactly 582 throughout the six-second hidden sample before advancing to 673 during the three-second recovery phase.

Final diagnostics reported `renderTargetFps: 30`, `hiddenFrameStable: true`, `recoveryAdvanced: true`, `hiddenReason: native-hidden`, and no exercise error. A separate packaged Full Jump reported `renderTargetFps: 60`, the file-defined Jump program and user cue, contained live framing, and no error.

The whole visible-idle CPU exit gate remains open. Renderer plus GPU alone average approximately 4.02% on this run, before the Electron browser process is counted, so Desky does not relabel the architectural `<3%` composed target as passed.

## Verification

```text
npm test                 PASS: 165 passed, 1 skipped
npm run typecheck        PASS
npm run lint             PASS
npm run package          PASS: win32 x64
```

All sample JSON, screenshots, profiles, downloaded avatars, and package output remain ignored and uncommitted.

## Remaining performance gates

- Profile renderer scripting, skinned-bound sampling, WebGL draw cost, pixel ratio, and Electron compositor overhead before changing the 30 FPS quality floor.
- Run longer idle/active plateaus on named low/mid/high reference hardware and compare both wall-power and process metrics.
- Repeat with representative VRM 1.0 and higher-complexity admitted assets.
- Repeat the timed matrix in the packaged macOS build.
