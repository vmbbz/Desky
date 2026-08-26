# F4 Windows reference-device lifecycle — 2026-08-24

Platform: packaged x64 Electron application on the named Windows reference development machine

This round runs the previously deferred real operating-system sleep/wake test and replaces the short renderer/GPU-only sample with longer whole-application idle and active plateaus. It closes the real Windows Modern Standby recovery implementation gate. It does **not** relabel the visible-idle CPU budget as passed, and it does not claim full-screen suppression, manual assistive-technology, display-reconnect, multi-monitor, or macOS evidence.

## Reference machine

- HP Spectre x360 Convertible 15-eb0xxx
- Windows 11 Home 64-bit, build 26200
- Intel Core i7-10510U, 4 cores / 8 logical processors
- 16 GB physical memory
- Intel UHD Graphics, driver 30.0.100.9864
- NVIDIA GeForce MX330, driver 32.0.15.8183
- 3840 × 2160 internal display at Windows scale factor 2.25
- Modern Standby `S0 Low Power Idle`, network connected

## Real Modern Standby

The repeatable package harness in `scripts/run-windows-reference-power-cycle.ps1` refuses to suspend unless all of these conditions hold:

1. the packaged offline-cached Milk avatar is ready and advancing frames;
2. a current-user one-shot scheduled task retains `WakeToRun=true`;
3. AC wake timers read back as enabled.

The machine originally had both AC and battery wake timers disabled. The harness changed only AC to enabled for the bounded run, preserved battery policy, restored the original AC value in `finally`, removed the one-shot task, and left no packaged Desky process behind.

The first real run exposed a production issue that the synthetic event test could not find: Electron delivered suspend and resume, but Chromium still considered the transparent document hidden after wake, so animation correctly remained stopped. `DeskyWindowManager` now records whether the ambient companion was actually visible before suspend. On resume it non-activatingly re-presents and invalidates only that already-visible surface. An intentionally hidden companion remains hidden.

The second packaged run passed:

| Signal | Before | After |
| --- | ---: | ---: |
| Suspend epoch | 0 | 1 |
| Resume epoch | 0 | 1 |
| Frame | 265 before suspend | 339 immediately after resume; 343 after recovery |
| Avatar | Milk ready, one texture | Milk ready, one texture |
| WebGL | ready | ready |
| Renderer suspension | false | false |
| Document focus | false | false |

Wall-clock time between waiting and matched resume was 111,893 ms. The final capture had no visual exercise error, no suspension reason, and frame 344. This proves real Electron power events, compositor recovery, frame-loop recovery, selected-avatar continuity, and non-activating return on this machine.

## Long whole-application plateaus

`scripts/run-windows-reference-performance.ps1` extends the existing production-surface probe with bounded environment-configurable sample counts. It reports Browser, renderer, GPU, Utility, and their summed application CPU/working set. Asset networking is disabled and the verified Milk cache is copied into each isolated profile.

### Ambient idle, 30 FPS

60 one-second visible samples, 30 native-hidden samples, and 15 recovered samples:

| Phase | Whole-app average CPU | Whole-app peak CPU | Peak summed working set |
| --- | ---: | ---: | ---: |
| Visible idle | 4.107% | 6.581% | 622,008 KiB |
| Native-hidden | 0.169% | 2.804% | 522,140 KiB |
| Recovered idle | 4.161% | 6.600% | 444,140 KiB |

Frame 2480 remained exactly 2480 throughout the 30-second hidden phase and advanced to 3022 after recovery. The renderer itself peaked at 287,812 KiB, below the existing 350 MB renderer target. The whole-app `<3%` visible-idle CPU target **fails** on this reference machine and remains an optimization gate.

### Normalized thinking, 60 FPS

30 one-second visible samples, 15 native-hidden samples, and 10 recovered samples:

| Phase | Whole-app average CPU | Whole-app peak CPU | Peak summed working set |
| --- | ---: | ---: | ---: |
| Visible thinking | 7.745% | 13.363% | 627,036 KiB |
| Native-hidden | 0.442% | 3.855% | 542,924 KiB |
| Recovered thinking | 7.076% | 8.200% | 460,924 KiB |

The renderer diagnostic remained at the expected 60 FPS. Frame 2237 stayed exact throughout the hidden phase and advanced to 2840 after recovery. A prior run that silently fell back to idle was excluded; the visual fixture now holds the normalized thinking state so future active profiles cannot make that false claim.

## Dependency and security decision

The renamed `get-windows` foreground-window package was evaluated for full-screen detection and rejected before implementation. Version 9.3.0 added 71 packages and caused six production audit findings, including a critical `tar` chain through optional native-build tooling. It was removed completely. The final production audit again reports zero vulnerabilities. Full-screen detection remains a small audited native-boundary task rather than importing that dependency graph.

## Verification

```text
npm test                 PASS: 289 passed, 10 skipped
npm run typecheck        PASS
npm run lint             PASS
npm run package          PASS: win32 x64
npm audit --omit=dev     PASS: zero reported production vulnerabilities
```

All captures, profiles, and package output remain ignored and uncommitted.

## Remaining Windows reference gates

- Optimize the composed visible-idle path without making the companion visibly choppy, then repeat the whole-app plateau.
- Add an audited foreground full-screen observer plus Hide / Stay visible / Approvals only preference; run the real full-screen application matrix.
- Run keyboard, Windows Narrator/UI Automation, forced-colors, and text-scaling critical paths manually on the packaged control center.
- Run physical display disconnect/reconnect, virtual desktop, and multi-monitor scale matrices.

## F3d.1 follow-up — 2026-08-26

The successor evidence in `docs/verification/F3D1-WINDOWS-VISIBILITY-PERFORMANCE-2026-08-26.md` replaces display-refresh polling with timer/RAF scheduling, proves desired-visibility recovery without reversing deliberate Hide, and reduces comparable whole-app visible idle from 4.107% to 3.103%. The `<3%` target remains narrowly open.
