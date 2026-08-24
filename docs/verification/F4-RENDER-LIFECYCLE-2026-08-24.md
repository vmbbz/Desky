# F4.5 render lifecycle and representative motion evidence — 2026-08-24

Platform: Windows 11, packaged x64 Electron application

This round closes the Windows-executable implementation gates for hidden-surface render suspension and bounded WebGL failure recovery. It also wires real Electron power suspend/resume events, exercises the same state path synthetically without putting the development machine to sleep, doubles the transactional avatar-switch soak to 80 changes, and captures Full-motion Jump on Milk and Astronaut.

It does **not** claim real OS sleep/wake, arbitrary Windows overlap occlusion, macOS equivalence, or complete visual admission of every avatar/clip pair.

## Implementation

- `DeskyWindowManager` projects native visibility, Electron `powerMonitor` suspend state, and a monotonic resume epoch through the typed ambient-state channel.
- `AvatarStage` stops its animation-frame loop for native-hidden, Chromium document-hidden/occluded, power-suspended, WebGL-lost, and WebGL-unrecoverable states. Motion time accumulates only while the loop runs, so an autonomous program does not age or jump ahead off-screen.
- Visibility and resume transitions restart the same admitted avatar without focusing or showing a deliberately hidden companion.
- WebGL loss now has an eight-second production deadline. Successful restoration resets Three.js state and resumes the scene. A missed deadline exposes a persistent accessible error and **Retry graphics** control; retry replaces the canvas and renderer rather than reusing a terminal context.
- The packaged harness may shorten only the WebGL deadline for deterministic evidence. Production behavior and the recovery state machine are otherwise identical.

## Verification

```text
npm test                 PASS: 160 passed, 1 skipped
npm run typecheck        PASS
npm run lint             PASS
npm run package          PASS: win32 x64
```

All screenshots, diagnostics, packages, downloaded avatar bytes, and isolated application-data profiles remain ignored and uncommitted.

### Native visibility and power lifecycle

The packaged production `desky://` surface was hidden through the real `BrowserWindow.hide()` path. Its ambient-state update stopped the renderer at frame 318; after another 500 ms the counter remained exactly 318. `showInactive()` resumed it without document focus.

The harness then invoked the same main-owned handlers used by Electron `powerMonitor`. The power-suspended frame remained exactly 349 across a second 500 ms interval, the diagnostic reason was `power-suspend`, and the counter advanced after resume. Final diagnostics reported `renderLifecycleVerified: true`, `renderSuspended: false`, and no exercise or motion error.

This proves native hide/show and the shared suspend/resume state path. A real machine sleep/wake run remains required because deliberately sleeping the active development host is disruptive and the synthetic invocation cannot prove hardware, driver, or network behavior.

### Unrecoverable WebGL fallback

The packaged renderer used `WEBGL_lose_context` to create a real context loss and deliberately withheld restoration. Desky reached `webglState: unrecoverable`, exposed the retry control, and stopped the animation loop. Clicking retry replaced the canvas and renderer; the selected Milk asset re-entered `ready`, acquired a fresh WebGL context, and advanced its frame counter. Final diagnostics recorded `webglUnrecoverableRetryVerified: true` with no exercise error.

### Eighty transactional avatar switches

A fresh packaged Marketplace profile completed 80 serialized changes across all three admitted Free companions with no exercise error, crash, stale pending state, or lost active selection. The final active companion was CoolBanana.

The final combined renderer working set was 549,692 KiB and GPU working set was 211,620 KiB. Both were lower than the earlier 40-switch endpoint (614,088 KiB renderer and 268,020 KiB GPU) on this machine. This is useful bounded-growth evidence, but not a universal leak-free claim; a timed reference-device CPU/GPU plateau remains part of the release matrix.

### Representative Full-motion captures

Milk and Astronaut each loaded from an isolated packaged profile with one mapped texture, 85 admitted motions, `motionReduced: false`, the Looking Around state clip, the file-defined Jump program, `user-jump-1`, and no clip or preference error. This closes the runtime/binding evidence for these two admitted VRM 0.x companions.

Visual review found that the most expansive Jump frame reaches or crosses the horizontal capture edge for both companions; Astronaut's antenna also reaches the top edge. The representative visual-admission gate therefore remains open for per-avatar motion-envelope framing or clip-specific tuning. The evidence is retained as a detected compatibility issue rather than mislabeled as a visual pass.

Follow-up: F4.6 closes this exact visual failure with generic live skinned-motion framing. See `docs/verification/F4-MOTION-ENVELOPE-2026-08-24.md`.

## Remaining gates

- Add a legally redistributable, provenance-reviewed real VRM 1.0 fixture and run the same motion/cache/recovery matrix.
- Add motion-envelope framing or per-avatar/clip admission metadata, then repeat Milk and Astronaut's expansive action captures.
- Run real sleep/wake, display reconnect, full-screen suppression, timed CPU/GPU plateau, and assistive-technology checks on Windows reference hardware.
- Repeat package, lifecycle, visual, Keychain, and performance evidence on macOS.
