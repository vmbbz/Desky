# System architecture

## Architectural objective

Desky must render one consistent companion experience while integrating runtimes with incompatible transports, permissions, and lifecycle models. The architecture keeps runtime-specific behavior behind adapters and keeps privileged operating-system access outside the renderer.

## Technology decision

Desky uses Electron, TypeScript, React, Three.js, and `@pixiv/three-vrm`.

- Electron supplies transparent frameless windows on Windows and macOS and has an established Mac App Store build.
- Three.js and `three-vrm` provide one VRM renderer across both operating systems.
- React owns accessible UI composition, not the render loop.
- Electron Forge owns development packaging; store signing and identity remain release-environment concerns.

The rejected Tauri approach is recorded in ADR 0001. The deciding constraint was Mac App Store compatibility for a transparent companion window.

## Runtime topology

```text
┌──────────────────────────────────────────────────────────────┐
│ Electron main process                                       │
│ window lifecycle | tray | secure storage | adapter host     │
│ distribution capabilities | diagnostics | update policy      │
└───────────────────────────┬──────────────────────────────────┘
                            │ narrow, typed IPC
┌───────────────────────────▼──────────────────────────────────┐
│ Sandboxed renderer                                           │
│ React UI | event reducer | avatar state machine | Three.js    │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTPS asset requests
┌───────────────────────────▼──────────────────────────────────┐
│ Avatar registries / explicitly user-selected local files     │
└──────────────────────────────────────────────────────────────┘

Adapter host connections:
  Store profile  -> authenticated HTTPS/WSS gateways
  Direct profile -> HTTPS/WSS plus supervised local processes
```

## Process responsibilities

### Main process

- Create and restore companion/control windows.
- Enforce the active distribution capability profile.
- Own adapter processes and network sockets requiring secrets.
- Store tokens through operating-system credential facilities; never plain settings files.
- Validate all IPC inputs and expose explicit commands only.
- Record redacted diagnostics.
- Coordinate shutdown, cancellation, and child-process cleanup.

### Preload bridge

- Expose a frozen, minimal API through `contextBridge`.
- Carry serializable values only.
- Never expose raw `ipcRenderer`, filesystem, shell, environment, or process objects.

### Renderer

- Render character and accessible controls.
- Reduce normalized adapter events into a deterministic companion state.
- Never receive long-lived secrets.
- Never construct shell commands.
- Treat avatar metadata, model files, and agent text as untrusted input.

## Domain modules

### Companion protocol

A versioned discriminated union represents runtime-independent events. The protocol is the seam between adapters and product behavior. See `docs/ADAPTERS.md`.

### Companion state machine

The reducer maps events to visible state. It is pure and exhaustively tested. Animation selection is a second mapping from visible state plus avatar capabilities, which prevents gateway quirks from leaking into render code.

The renderer consumes that state through a motion arbiter. The implemented foundation owns one full-body state plan, resolves priority and exact registered-clip selection, and emits a procedural fallback when no admitted clip can run. Its controller owns the VRM mixer, loop/one-shot policy, fades, reduced-motion suppression, baseline restoration, and disposal. Cancellation, approval, and disconnection override lower-priority motion. Terminal turns reject late nonterminal animation intents just as the adapter host rejects late lifecycle events. Conversational/action queues and additive face, blink, look-at, and speech layers will extend this boundary without creating a second full-body owner.

### Companion window composition

The experience uses separate coordinated windows rather than one permanent card:

- The ambient companion is a tightly bounded transparent window for the avatar and transient anchored bubble/composer UI. It does not activate when state changes.
- The control center is an ordinary accessible window for setup, transcripts, approvals, settings, licences, and diagnostics.
- The main process owns placement, work-area clamping, always-on-top policy, full-screen policy, and click-through state. Renderer code reports measured visible bounds and requests semantic window actions through typed IPC.
- Interactive regions remain explicit. Transparent ambient regions pass pointer input where the platform permits, and a tray/menu/global escape route can disable full click-through.

The behavior and acceptance matrix are specified in `docs/COMPANION-EXPERIENCE.md`.

`DeskyWindowManager` implements this separation and owns all native desktop policy. Each renderer receives a typed `ambient` or `control-center` identity from main-process ownership rather than selecting its own privileges. The ambient window is transparent, fixed-size, and taskbar-free; the control center is an ordinary resizable window. Geometry-keyed placement and the always-on-top preference live in a bounded, validated, atomically replaced application-data record. The main process clamps the real native window against current Electron `Display.workArea` values after moves and display topology/metric events.

The ambient renderer reports only `interactive` or `transparent` pointer intent through typed IPC. Interactive DOM regions are explicit, and the avatar uses projected scene bounds rather than its full canvas. Main applies Electron mouse-event forwarding for selective hit testing and owns the stronger full-window click-through mode. Full click-through is not persisted across launch and cannot enable without a live tray or global-shortcut recovery surface. Tray and native context menus also expose show, hide, position reset, always-on-top, control-center, and quit actions. Runtime state broadcasts never call `show` or `focus`; ambient restoration uses `showInactive`, while an explicit character click may focus the composer.

Surface separation does not make the OpenClaw bridge the generic adapter contract. F5a will put an executable adapter registry and shared connection/session/capability types above the current OpenClaw host before a second production adapter and before F4 connection UX is frozen. The sequencing contract is in `docs/EXECUTION-PLAN.md`.

### OpenClaw adapter host

The first production adapter is owned entirely by the main process:

```text
connection UI -> validated IPC command -> OpenClawAdapterHost
                                        -> secure vault
                                        -> protocol-v4 WebSocket client
Gateway frame -> main-process validation/redaction -> AdapterEvent -> renderer reducer
```

- `gateway-client.ts` owns the challenge-first wire exchange and request correlation.
- `protocol.ts` owns the pinned v4 constants, Ed25519 device proof, URL policy, native frame guards, and redacted event mapping.
- `secure-vault.ts` stores encrypted opaque values only; it has no plaintext fallback.
- `host.ts` owns profiles, sessions, terminal-event deduplication, approval routing, cancellation, reconciliation, and bounded reconnect.
- Preload exposes semantic commands and two read-only event subscriptions. It never exposes sockets, native frames, credentials, or `ipcRenderer`.

The packaged renderer is served from the secure custom `desky://` scheme. This lets the file-protocol privilege fuse remain disabled without making packaged assets unavailable.

### Avatar catalog

The catalog fetches `projects.json`, then collection-specific avatar files. It joins per-project licences to avatar metadata before any avatar can be selected. Network data is schema-validated, cached with a bounded lifetime, and never treated as executable content.

### Avatar renderer

- WebGL renderer with alpha enabled.
- VRM 0.x and VRM 1.0 detection from parsed metadata, with legacy coordinate rotation restricted to VRM 0.x.
- Preflight capability inventory for normalized humanoid bones, expressions/visemes, blink, look-at, and spring-bone joints.
- Fail-closed core humanoid and embedded usage-permission checks before a model enters the scene.
- SHA-256 provenance over the exact downloaded model bytes, joined to reviewed catalog licence metadata and retained with the loaded scene.
- Fixed timestep where animation correctness requires it; render interpolation for display refresh.
- Pause or reduce work when hidden, occluded, on battery-saving mode, or reduced-motion is enabled.
- Dispose geometries, materials, textures, mixers, and object URLs on replacement.
- Measure the character's projected visible bounds for safe bubble/composer placement without treating the full transparent canvas as occupied.

### Animation pipeline

The source registry contains avatars, not animation clips. Desky maintains a reproducible offline conversion pipeline:

1. Record source animation, author, licence, and checksum.
2. Convert Mixamo/FBX animation to a canonical intermediate representation.
3. Retarget by normalized humanoid bone names with explicit VRM-version handling.
4. Validate hips translation scale, rest-pose rotations, handedness, and foot contact.
5. Emit versioned clips plus provenance metadata.
6. Test clips against a representative VRM 0.x/1.0 compatibility suite.

Runtime prompt-generated conversions are not release inputs. Conversion scripts and deterministic outputs are reviewed and versioned.

Animation admission is separate from conversion. `src/shared/animation-manifest.ts` rejects clips without validated source/output provenance, the pinned retargeting profile, deterministic sampling/root-motion parameters, and an approved rights review. No runtime clip loader may bypass this parser.

The canonical clip stores rest-corrected rotations in VRM 1.0 normalized-humanoid coordinates and hips translation in source-rest-height units. `src/renderer/avatar/create-vrm-animation-clip.ts` scales hips to the selected avatar and performs the VRM 0.x axis conversion only while binding. This separates deterministic offline conversion from target-specific runtime mechanics. Operational detail is in `docs/ANIMATION-PIPELINE.md`.

`src/renderer/avatar/motion-arbiter.ts` admits a runtime clip only after parsing the approved manifest and canonical payload, matching clip ID/state intent/layer/sample rate, and verifying the exact canonical output checksum. It then maps normalized state to an admitted clip and playback contract. `src/renderer/avatar/avatar-motion-controller.ts` owns the per-avatar mixer and the deterministic procedural fallback. Cancellation never depends on clip availability, and an invalid target binding degrades to the procedural state instead of failing the render loop or turn.

## Persistence

Initial persistence is split by sensitivity:

- OS credential encryption (`safeStorage`): gateway credentials, Ed25519 private identity, and paired device tokens in an opaque application-data vault.
- Application data directory: validated settings, bounded display-arrangement placement records, selected avatar reference, redacted session index. Full click-through is intentionally not persisted.
- Optional transcript store: disabled until encryption, retention controls, and deletion semantics are implemented.
- Cache directory: catalog JSON, previews, and avatar binaries with licence/provenance sidecars and bounded size.

## Capability profiles

Build-time profile selection is security-sensitive and cannot be toggled by renderer code.

| Capability | `store` | `direct` |
| --- | ---: | ---: |
| HTTPS/WSS gateway | yes | yes |
| User-selected avatar import | yes | yes |
| Arbitrary local agent CLI | no on MAS | yes |
| Bundled sandbox-inheriting helper | where reviewed | yes |
| In-app self-update | no on MAS | yes |
| Store-managed update | yes | no |

Windows Store may support more than the least-common `store` profile. Platform capability manifests can refine permissions, but product copy must remain accurate per package.

## Failure model

- Gateway loss enters `disconnected`, preserves unsent user input, and offers explicit reconnect.
- Malformed events are quarantined and reported without crashing the render loop.
- Avatar failure displays an accessible status and permits catalog replacement.
- WebGL loss attempts one controlled renderer reconstruction.
- Adapter crashes use bounded exponential restart with a visible stop option.
- Approval events never auto-resolve after reconnection.

## Performance budgets

Budgets will be enforced in CI/device testing as instrumentation lands:

- Visible idle: target below 3% CPU on reference laptop and 30 FPS default.
- Active animation: target below 10% CPU and adaptive 30/60 FPS.
- Hidden/occluded: render loop suspended.
- Renderer working set: target below 350 MB with one normal-complexity avatar.
- Avatar download: default maximum 100 MB, user-confirmed override.
- Catalog JSON cache: one-hour freshness, stale-on-error behavior.
