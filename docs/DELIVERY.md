# Delivery roadmap

## Operating rules

- Each milestone ends in a usable, testable vertical slice.
- A simulation can validate UI but never satisfies a production integration gate.
- Store and direct packages are tested throughout development, not at the end.
- Performance, accessibility, security, licence, and recovery work are acceptance criteria, not cleanup phases.

## F0 — product and architecture baseline

Deliverables:

- Product definition and boundaries.
- Architecture and distribution decisions.
- Adapter event vocabulary.
- Asset provenance and security policy.
- Release channel matrix.

Exit gate:

- Documentation is internally consistent.
- Store capability differences are explicit.
- No unsupported integration is represented as working.

## F1 — companion foundation

Deliverables:

- Secure Electron main/preload/renderer split.
- Transparent draggable companion surface.
- Deterministic companion state reducer and tests.
- Simulation adapter for the complete state sequence.
- Open Source Avatars catalog client with project-level licence join.
- One remotely loaded CC0 VRM with failure handling.
- Windows/macOS CI for lint, typecheck, tests, and packaging smoke checks.

Exit gate:

- Clean install can show a character or actionable asset-load error.
- Every state is reachable and labeled.
- Packaged renderer has no Node.js access.
- No downloaded model binary is committed.
- `DESKY_VISUAL_TEST_PATH` capture shows the companion and records both the avatar load state and mapped-texture count, preventing geometry-only white models from passing a visual smoke.

## F2 — OpenClaw production adapter

Deliverables:

- Gateway handshake and protocol negotiation.
- Secure token storage.
- Session selection, input, streaming, tools, approvals, cancellation, and reconnect.
- Contract fixtures and a local integration test harness.
- Connection diagnostics with secret redaction.

Exit gate:

- Fresh session completes a real agent turn.
- Approval allow/deny and disconnect paths are verified.
- Store profile connects to a secure remote gateway.

### F2 implementation status — 2026-08-22

Implemented and fixture-verified:

- Exact protocol-v4 challenge/connect envelope and Ed25519 device proof.
- Minimum operator scopes and explicit capability advertisement.
- OS-encrypted profile, device identity, bootstrap credential, and paired device-token persistence.
- Session list/create/select/subscription, message send, streamed assistant/tool events, unified approvals, abort, event-gap reconciliation, and exponential reconnect.
- Narrow IPC validation, reviewer-safe event mapping, and a bounded secret-redacting error boundary around every renderer-invoked OpenClaw operation.
- Local WebSocket handshake fixture plus host contract fixture for sessions, streaming, approval resolution, cancellation, and reconnect.
- Packaged Windows renderer boot through the secure `desky://` scheme.
- Opt-in live Gateway harness with secrets accepted only from environment variables.

Live-verified on Windows against local OpenClaw 2026.8.1:

- Protocol-v4 authentication and required method/scope negotiation.
- Wrong bootstrap credentials and stale device tokens are rejected with bounded messages that do not echo the supplied secret. An explicit fresh credential bypasses stale saved access, rotates it after success, and leaves the prior saved profile intact after failure.
- Fresh session creation, selection, and approval-enabled message subscription.
- Exec approval deny, allow-once, expiry, first-answer-wins reviewer contention, and authoritative duplicate acknowledgement. The probes create approval records but never execute a command.
- Unexpected transport loss during an admitted turn through a controllable loopback relay, followed by automatic reconnect, selected-session resubscription, cancellation, and exactly one terminal event.
- A fresh assistant turn streamed the required text and reached one successful terminal state through the configured ChatGPT/Codex OAuth route.
- A packaged Desky session interrupted a real 90-second shell-tool execution. Gateway acknowledged the abort, the tool ended as an error, the lifecycle ended aborted, and a same-session recovery turn then streamed and completed successfully.

Open before F2 exit:

- Verify live exec/plugin allow-always where offered and cross-device contention on separate clean device profiles.
- Interrupt a live turn specifically during response streaming; tool-execution interruption and same-session recovery are now verified.
- Verify device pairing and paired-token rotation on a second clean machine profile.
- Connect the Store capability profile to a trusted remote `wss://` gateway and validate certificate failure behavior.
- Run the same live matrix on macOS with Keychain-backed `safeStorage`.

## F3 — expressive avatar runtime

Deliverables:

- Version-aware VRM 0.x/1.0 loader.
- Reproducible animation conversion pipeline.
- Provenance-bearing idle/thinking/working/speaking/success/error clips plus action one-shots.
- Deterministic layered motion arbiter for baseline, state, conversational, action, look-at, blink, expression, and optional speech-viseme behavior.
- Desktop-presence companion composition: transparent ambient avatar, anchored streamed bubble, contextual composer/Stop, safe-area flipping, deliberate drag, and transparent-region click-through.
- Direct character manipulation: native companion dragging with saved safe-area clamping, persistent 3D yaw rotation, and click/double-click preservation.
- Autonomous idle life: continuous neutral motion plus bounded pseudo-random gestures that immediately yield to provider, approval, action, preview, and reduced-motion ownership.
- Window focus, always-on-top, full-screen, position-restoration, and click-through escape behavior that remains under user control.
- GPU/CPU budgets, occlusion pause, reduced motion, and WebGL recovery.

Exit gate:

- Representative avatar compatibility suite passes.
- No animation asset lacks redistributable provenance.
- Packaged companion remains above another application without taking focus; transparent hit testing and every work-area edge pass at representative display scales.
- Fixture and live state matrices match `docs/COMPANION-EXPERIENCE.md`, including immediate cancellation motion and rejection of late tool animation.
- Stop, hide, pause, click-through escape, and control-center routes remain reachable by pointer and keyboard.
- Idle and active performance budgets pass on reference machines.

### F3a implementation status — 2026-08-22

Implemented and test-verified:

- Runtime VRM 0.x/1.0 version detection and legacy-rotation decision.
- Normalized humanoid, preset-expression, viseme, blink, look-at, and spring-bone capability inventory.
- Exact core-retarget-bone diagnostics and fail-closed admission.
- Conservative embedded VRM usage review against the catalog licence.
- Validated asset-provenance schema and SHA-256 generation from downloaded avatar bytes.
- Strict animation conversion manifest with pinned retargeting formula, source/output checksums, and mandatory approved rights review.
- Integration of those checks into the main-process brokered remote-avatar load path before the model enters the scene.
- Fresh packaged Windows smoke through `desky://` with the real default reaching `Milk · VRM 0.x · CC0 · 100Avatars R1`.
- Bundled offline Mixamo/FBX parser and deterministic canonical converter with full official humanoid mapping, fixed sampling/quantization, quaternion continuity, explicit root-motion policy, and fail-closed input limits.
- Versioned avatar-neutral canonical JSON plus runtime VRM 0.x/1.0 binding with target hips-height scaling.
- Non-writing inspect mode and a rights-gated conversion CLI that produces atomic clip/manifest pairs and refuses implicit overwrites.

Verified against the current remote Milk default without committing its binary: the registry declares project CC0; embedded VRM 0.x metadata declares everyone/commercial use/CC0; all core retarget bones are present; and the 1,338,344 downloaded bytes hash to `99e32f15d529eb47b3892aa44d5f053c07dabf55a0851aca7e7ab74f5f17e107`.

Open before the F3a slice is complete:

- Complete packaged visual admission for the approved Quaternius candidate library. Rights, exact source/output provenance, deterministic conversion, 84 canonical clips, and third-party notice are committed; representative VRM 0.x/1.0 playback remains required before Store release.
- Add legally redistributable representative VRM 0.x/1.0 fixtures with reviewed provenance; structural unit fixtures are not the binary compatibility suite.
- Persist provenance atomically beside bounded cached assets and verify it on cache reads.
- Test proportions, materials, spring bones, expressions, coordinates, foot contact, and hips scaling against the binary suite.
- Complete the packaged state matrix and performance evidence on Windows, then repeat package, visual, and performance checks on macOS.

### F3b motion-runtime foundation — 2026-08-22

Implemented and test-verified:

- Added an explicit normalized `cancelled` companion state while preserving the terminal `turn.failed` protocol shape; native and acknowledged aborts carry `payload.kind: cancelled`, and older/missing kinds remain errors.
- Added a pure motion arbiter with a fixed priority table, exact state registration, stable `order`/`clipId` tie-breaking, bounded fade metadata, and one authoritative full-body plan.
- Added branded runtime admission that reparses the canonical clip and approved manifest, matches identity/state/layer/sample rate, verifies the exact output checksum, and refuses cancellation clips.
- Added a per-avatar motion controller that owns the Three.js mixer, canonical VRM clip binding, loop/one-shot policy, clip-to-clip fades, immediate cancellation stop, baseline restoration, and disposal.
- Replaced the undifferentiated avatar bob with deterministic procedural poses for disconnected, idle, listening, thinking, working, approval, speaking, success, cancelled, and error.
- Added a system `prefers-reduced-motion` route that suppresses full-body clips and time-varying travel while retaining a small static semantic pose and readable state.
- Added fixtures for all state fallbacks, priority, deterministic clip selection, reduced motion, mixer playback, invalid-clip degradation, transform cleanup, gateway abort classification, reducer cancellation, and late-tool rejection.

Still open in F3b/F3d:

- Run the approved 84-clip Quaternius candidate library through the full packaged VRM 0.x/1.0 visual, interruption, transition, reduced-motion, and performance matrix; keep context-sensitive catalogue candidates disabled until reviewed.
- Live-verify the implemented normalized agent-action command through the installed OpenClaw plugin, then extend richer reviewed gesture selection. The queue currently supports speaking emphasis plus explicit user and typed agent Wave/Jump requests.
- Extend the implemented capability-aware blink, look-at, and state-expression controller with optional speech visemes only when truthful audio timing exists.
- Complete external full-screen observation, the final visible-idle optimization margin, manual accessibility, physical display/virtual-desktop, and macOS lifecycle evidence. Real Windows Modern Standby and unexpected native-window recovery pass; the latest 20/60 timer/RAF scheduler lowers whole-app visible idle from 4.107% to 3.103%, so the `<3%` budget remains narrowly open.

The implementation and validation evidence is recorded in `docs/verification/F3B-MOTION-RUNTIME-2026-08-22.md`.

### F3b.2 expressive-motion slice — 2026-08-22

Implemented and package-verified on Windows:

- Added a bounded deterministic priority/FIFO queue for conversational emphasis, nod, wave, and jump without introducing a second mixer or full-body owner.
- Made higher normalized state priorities authoritative; approval, cancellation, disconnection, and error clear active and pending cues, while the accepted state plan resumes after a completed cue.
- Added automatic one-shot emphasis on entry to speaking, an explicit focused Wave control, and deliberate character double-click Jump. No raw prompt, assistant text, or tool argument selects animation.
- Removed root travel from queued actions under reduced motion while retaining a small static acknowledgement.
- Added a capability-gated additive controller for deterministic blink, restrained look-at, and small available-preset state expressions, including baseline restoration and missing-capability no-op behavior.

Evidence is recorded in `docs/verification/F3B2-EXPRESSIVE-MOTION-2026-08-22.md`.

### F3b.4 local-VRMA preview and gallery audit — 2026-08-23

Implemented and test-verified:

- Added an exact-version-pinned VRM Animation parser and a control-center-only `.vrma` selection/replay/clear workflow.
- Added main-process binary glTF/VRMA validation, structural and byte limits, external-resource rejection, exact SHA-256 identity, session-memory-only retention, and typed playback/status IPC without exposing the source path.
- Routed imported one-shots through the existing per-avatar mixer. Additive expressions pause during playback, the authored baseline is restored, and newly entered approval/cancellation/disconnection/error states interrupt playback. Pending approval and reduced motion block a new preview, while a deliberate later offline preview does not require an agent connection.
- Consolidated animation settings into one persisted Companion animation card. Energy controls cadence/variety; Movement controls the independent Full/Follow Windows/Reduced accessibility envelope. Full motion is the product default, and overriding an active Windows reduced-motion preference is stated explicitly in the UI.
- Audited Toothpaste and the live Open Source Avatars gallery. Toothpaste contains no embedded animation; the gallery currently retargets eleven separate Mixamo-style FBX files. All eleven pass Desky's non-writing technical inspection, but none is admitted because the public repository/deployed responses do not provide per-file redistribution provenance.

Evidence is recorded in `docs/verification/F3B4-LOCAL-VRMA-PREVIEW-2026-08-23.md` and `docs/research/OSA-ANIMATION-AUDIT-2026-08-23.md`.

### F3b.5 rights-approved file-driven animation library — 2026-08-23

Implemented and test-verified:

- Acquired the free Standard editions of Quaternius Universal Animation Libraries 1 and 2 under their included CC0-1.0 dedication; recorded both archive hashes, both exact FBX hashes, source pages, timestamps, and project-owner review.
- Extended the deterministic converter with exact multi-clip selection, inventory mode, the reviewed `quaternius-uam-v1` bone map, Z-up hips conversion, source profile/name provenance, and an atomic library builder.
- Generated 84 canonical clips from 86 source records after excluding both authoring T-poses. Paid Pro/Source files were not acquired and Desky does not claim their 120+/130+ counts.
- Added a validated, cryptographically admitted library schema, now with four state bindings and fifteen file-defined programs. Runtime TypeScript contains selection/interruption policy but no animation filename list.
- Replaced the hard-coded four-item autonomous list with weighted, cooldown-aware planning from admitted file metadata. Multi-step sit/chat/stand and magic sequences use the existing single mixer/body owner.
- Routed explicit Jump through reviewed `Jump_Start` and `Jump_Land` files while retaining procedural Wave because the acquired inventories contain no Wave clip.
- Kept combat, weapons, death, injury, swimming, driving, farming, prop-dependent, and incomplete sleep-transition behaviors catalog-only rather than allowing random playback.
- Extended the file-defined autonomous lane to `disconnected`, so the companion remains alive before a gateway session is selected; local double-click Jump no longer requires a session. Packaged diagnostics also record frame-loop, motion-mode, reduced-motion, active-program, and clip-error state so a static accessibility fallback is distinguishable from a mixer failure.
- Removed authored-program hard cuts: complete canonical step durations are retained, adjacent steps crossfade over 220 ms, and the terminal pose blends back to the state/procedural owner over up to 320 ms. Replaced fixed avatar world dimensions with camera-frustum fitting and motion-safe vertical/horizontal margins so broad Milk poses remain inside the ambient surface.
- Replaced broad random idling with a validated file-defined `look`, `look`, `celebrate` cycle: long look-around occupies two of every three slots and the approved `Yes` clip is the celebration/fist-pump equivalent. Rich edge cases stay catalogued but cannot fire without future typed context.
- Replaced rectangular drag intent with upstream-aligned mesh raycasting. Direct avatar contact rotates without a modifier; transparent space inside the measured bounds moves the clamped native surface, while the focused grip and keyboard/modifier routes remain deterministic fallbacks.

Rights, hashes, OSA semantic coverage, automated/package evidence, and remaining visual gates are recorded in `docs/research/QUATERNIUS-ANIMATION-ADMISSION-2026-08-23.md`, `docs/verification/F3B5-FILE-DRIVEN-CC0-ANIMATIONS-2026-08-23.md`, and `THIRD_PARTY_NOTICES.md`.

### F3c.1 surface-separation status — 2026-08-22

Implemented and package-verified on Windows:

- Added explicit `ambient` and `control-center` surface identities to the typed runtime boundary.
- Made the transparent, fixed-size, taskbar-free ambient companion the default window.
- Added a separate standard, resizable, non-always-on-top control-center window for connection, session, prompt, and diagnostic UI.
- Added semantic open-control-center and show-companion routes without exposing raw Electron window APIs.
- Removed the permanent application-card background from the ambient presentation while preserving the avatar, short bubble, status, composer/Stop, approvals, and connection route.
- Replaced provider-specific approval text in the normalized reducer with runtime-neutral wording.

Evidence is recorded in `docs/verification/F3C1-SURFACE-SEPARATION-2026-08-22.md`.

### F3c.2 spatial and pointer status — 2026-08-22

Implemented and package-verified on Windows:

- Added validated, bounded display-arrangement placement persistence and atomic application-data replacement.
- Restored the ambient window before showing it and clamped the real native bounds after dragging, display add/remove, work-area, scale, bounds, and rotation changes.
- Added work-area-aware above/below and horizontal speech-bubble placement.
- Projected the loaded VRM scene bounds into the canvas and used that measured rectangle as the deliberate character interaction target.
- Added selective transparent-region pass-through and session-only full click-through.
- Added tray, native context-menu, global `Ctrl/Cmd+Shift+D`, and control-center recovery routes. Full click-through cannot enable when neither tray nor shortcut recovery is available.
- Added saved always-on-top, reset-position, hide, show, control-center, and quit controls without exposing raw Electron APIs.
- Proved in a packaged Windows harness that inactive ambient show, state publication, and native clamping preserve focus on the active control center.
- Prevented the taskbar-free ambient surface from becoming stranded by a shell minimize transition; the packaged harness proves it becomes visible again without taking focus, while explicit Hide remains unchanged.

Evidence is recorded in `docs/verification/F3C2-DESKTOP-BEHAVIOR-2026-08-22.md`.

### F3c.3 focused-companion status — 2026-08-22

Implemented and package-verified on Windows:

- Replaced permanent ambient status and management chrome with an avatar-first resting composition and a compact contextual launcher.
- Added explicit character/launcher composer reveal, `Escape` collapse, successful-send collapse, and a shared session-only draft that is not written to application data.
- Moved normalized companion reduction into one main-owned revisioned snapshot so late-opening windows recover the current response, terminal state, and pending approval.
- Preserved compact ambient approval decisions and Stop while keeping full approval detail, session choice, and runtime setup in the control center.
- Added a bounded full live response, a concise ambient preview, and **Open conversation** for overflow or recoverable error detail.
- Package-verified idle, collapse/re-open draft, and completed-response surfaces through `desky://`; all remained unfocused, and the exact draft survived the packaged collapse exercise.

Evidence is recorded in `docs/verification/F3C3-FOCUSED-COMPANION-2026-08-22.md`.

### F3c.5 response continuity and provider-client handoff — 2026-08-31

Implemented and unit/type verified; packaged interaction evidence remains open:

- Prevented terminal success/error from exposing the imported static posture by inheriting and crossfading into the admitted Looking Around idle loop when no exact terminal clip exists.
- Added syntax-free bounded ambient previews and length-aware 8–18 second successful-response dismissal without removing the main-owned full response.
- Added safe GitHub-flavored Markdown rendering for full responses. Raw HTML is disabled and clickable links cross an HTTP/HTTPS-only main-process validator.
- Replaced the hard-coded control-center action with an argument-free main-owned conversation router. Installed OpenClaw Companion is preferred through its documented fixed `openclaw://chat` link; unsupported, absent, and failed clients fall back to Deskiii.
- Kept Claude, Hermes, and Codex on the safe fallback because their current Deskiii session identities have no proved stable desktop-app conversation route.
- Repaired release/reference tooling after the Deskiii product-name migration so artifact verification resolves the current product directory instead of silently inspecting a stale `Desky-*` package.

### F3c.4 autonomous companion and direct manipulation status — 2026-08-23

Implemented and package-verified on Windows:

- Added continuous neutral idle motion plus a seeded bounded scheduler for look-around, weight-shift, stretch, and restrained ambient-wave gestures. Immediate repeats are excluded and meaningful provider, approval, preview, user/agent action, and reduced-motion owners preempt the decorative lane.
- Made the measured character hit target a direct companion drag surface with a five-pixel click threshold, typed pointer-command IPC, main-owned start bounds, per-update work-area clamping, and existing display-arrangement persistence.
- Added persistent 3D yaw through Shift/Alt drag, wheel, and keyboard controls without mixing camera/view intent into authored humanoid animation tracks.
- Preserved click-to-compose, double-click Jump, transparent-region pass-through, focus policy, OS-safe credential isolation, and the existing motion arbiter.
- Package-proved the actual measured-hit-target pointer path with a 48-by-32 logical move, a persisted 72.8-degree Shift-drag view, loaded Milk texture, and unfocused ambient surface in isolated application data.
- Reconnected the packaged app to the newly authenticated non-dev OpenClaw profile and received the exact streamed response `DESKY_RUNNER_LIVE_OK` from the selected Desky session through `openai/gpt-5.6-sol`.
- Replaced the imported/restored arms-sideways posture with an authored folded-arm idle in both connected idle and disconnected rest. Removed repetitive head-motion/thumbs-up from autonomy, rejected the distorted crouch on Milk, and package-proved a shuffled-bag sequence of Search/Interact, Formal Walk, and Dance Break with no clip error.
- Reworked semantics after live review: the exact transformed 11.4-second Looking Around clip is the sole idle body owner; folded arms remains catalog-only and the competing procedural overlay is removed. Thinking owns Search/Interact, speaking stays on its talk loop without a procedural interruption, and all three standing states preserve target hips height. The autonomous shuffled bag is Phone Check, Formal Walk, and rare Dance Break.
- Added provider-neutral `AgentAdapterCapabilities`, OpenClaw's read-scoped `desky.actions.capabilities` discovery method, explicit control-center readiness status, and live OpenClaw 2026.8.1 evidence for a real model-issued typed Jump.

Evidence is recorded in `docs/verification/F3C4-AUTONOMOUS-MANIPULATION-2026-08-23.md` and `docs/verification/F3B8-ANIMATED-IDLE-REPAIR-2026-08-23.md`.

The expression round, file-driven autonomous layer, direct manipulation, normalized Wave/Jump agent-action boundary, rights-safe local VRMA preview, and first admitted candidate animation library are implemented. Packaged Windows has completed real local-VRMA playback, replay, reduced-motion rejection, malformed-humanoid rejection, completion, clear, restart-reset, active-playback interruption, direct movement, persisted view rotation, the exact Looking Around idle at multiple points in its seamless 11.4-second loop, and a live assistant-stream evidence run. Direct tests also prove authoritative approval/cancellation/disconnection/error interruption and exact transform restoration. Live OpenClaw action discovery and typed Jump pass; the separate Wave attempt passed the pre-model matrix but remains capacity-deferred after the configured Codex provider rejected the final turn at its subscription limit. The next animation gates are representative binary-avatar/macOS evidence and the deferred Wave rerun. The manual multi-monitor/display-scale pointer matrix, macOS equivalence, full-screen policy, and lifecycle/performance evidence remain broader F3/F3d exits.

## F4 — control surface and daily usability

Deliverables:

- Onboarding and runtime connection management.
- Accessible transcript and approval center.
- First-class Companions marketplace route with search, filters, detail, isolated preview, licence/attribution/source, install/update state, and transactional activation.
- Motion-personality controls: Paused, Quiet, Balanced, Lively, and accessible category-based Custom behavior.
- Three permanent CC0 free companions selected from binary rights/compatibility/performance evidence, not placeholder catalog records.
- Signed normalized catalog and admitted-revision schemas, content-addressed cache, provenance sidecars, offline restore, and corrupt-cache recovery.
- Commerce-neutral entitlement provider boundary whose first and only implementation is `free`; paid UI fixtures remain visibly development-only.
- Window placement, tray, click-through, hotkeys, and notification controls.
- Cache, privacy, deletion, and diagnostic export controls.

Exit gate:

- Full keyboard and screen-reader critical path.
- Multi-monitor and sleep/wake recovery tests.
- No security-sensitive action depends solely on animation.
- Three admitted avatars pass the packaged VRM 0.x/1.0, animation-state, replacement, GPU, provenance, restart, offline, and disposal matrix on supported Windows/macOS devices.
- Twenty consecutive avatar switches produce no leak, crash, stale entitlement, or loss of the previously working companion.

The authoritative marketplace plan is `docs/AVATAR-MARKETPLACE.md`. F4 does not require blockchain code and must prove the catalog/product value before F4x begins.

### F4.1 marketplace foundation — 2026-08-24

- Implemented persisted Paused/Quiet/Balanced/Lively/Custom motion personality with bounded semantic category levels and scheduler cadence/filter enforcement.
- Added a strict commerce-disabled bundled catalog and free-entitlement decision. Locked offers fail parsing, candidate records cannot become available, and renderer source requests resolve exact catalog IDs in main.
- Added the full Companions control-center route. It presents Milk as the one real admitted Free/Active avatar, two honest admission-in-progress slots, source/licence/attribution/compatibility information, and explicit payment-rails-off status.
- Package-verified the production `desky://` marketplace surface on Windows with three visible cards, one active admitted entry, and no payment provider.

Evidence: `docs/verification/F4-MARKETPLACE-FOUNDATION-2026-08-24.md`.

### F4.2 three-free activation foundation — 2026-08-24

- Admitted CoolBanana and Astronaut beside Milk from pinned registry commit `0f9a1b2fd99894736563d55b2c9dc9125700d081`; all three have exact model/thumbnail hashes and byte lengths, canonical registry-record hashes, embedded CC0/everyone/commercial-use review, complete core humanoids, and one mapped texture.
- Replaced the runtime's single featured-avatar request with selected-revision state and narrow typed IPC.
- Added content-addressed model/thumbnail objects, atomic provenance sidecars, read-time revalidation, corrupt-object repair, and a visual-test network-denial mode for packaged offline proof.
- Added two-phase activation: verified download/cache, pending ambient runtime admission, then committed active/fallback persistence. Failed runtime admission rolls back without replacing the last working companion.
- Replaced candidate slots with three real Free cards using hash-pinned upstream art and working `Use companion` actions. Payment rails remain off.
- Package-proved CoolBanana and Astronaut activation through the production `desky://` surface; both reached committed `ready`, and Astronaut reached `avatarState: ready` with a mapped texture in the ambient surface.

Evidence: `docs/verification/F4-THREE-FREE-AVATARS-2026-08-24.md`.

Final packaged evidence also restores active CoolBanana, its mapped texture, full Looking Around idle, and all three marketplace thumbnails from the verified cache while the visual harness forcibly denies network access.

### F4.3 preview and cache durability — 2026-08-24

- Added a verified 3D Marketplace preview with drag rotation, relaxed pose, explicit source/licence and `Use companion` handoff. Preview acquisition and rendering do not create pending state, persist selection, subscribe to gateway motion, or touch the ambient scene.
- Added a 256 MiB catalog-aware least-recently-used cache pass. It operates only on exact admitted paths, preserves content-addressed objects still referenced by retained revisions, and protects active, rollback, and pending revisions.
- Replaced shallow mesh disposal with deep VRM scene disposal and renderer-list cleanup on every ambient model replacement.
- Package-proved exact repair after deliberately invalidating active CoolBanana's provenance sidecar: the sidecar returned to schema version 1, the model hash remained the admitted SHA-256, and the ambient renderer returned `ready` with one mapped texture.
- Package-proved 20 and 40 consecutive transactional switches with no exercise error, stale state, crash, or rollback loss. The separate 20/40 post-warm-up ambient working-set deltas differed by about 6 MiB rather than doubling; GPU retention still requires a longer reference-device plateau run before the leak exit gate is declared complete.

Evidence: `docs/verification/F4-PREVIEW-CACHE-DURABILITY-2026-08-24.md`.

### F4.4 storage controls and graphics restoration — 2026-08-24

- Added typed verified/missing/corrupt cache inventory with physical bytes, last access, protection reasons, and removability.
- Added a plain-language storage summary and per-companion offline state. `Remove model` removes only an unprotected model download; it retains the thumbnail, product, entitlement, source/licence, and catalog entry.
- Extended protection to the pre-pending acquisition interval so activation and removal cannot race around model verification.
- Added explicit WebGL loss/restoration handling: render work pauses, the UI reports recovery, Three.js state is reset on restoration, and the existing admitted scene resumes without changing selection.
- Package-proved Astronaut preview/download/removal with a physical storage decrease from 5,729,984 to 4,049,963 bytes while active/rollback Milk remained protected.
- Package-proved one forced WebGL loss and restoration with the render frame advancing afterward, Milk still visibly textured, `avatarState: ready`, and no exercise or clip error.
- Completed the corrupt-sidecar restart matrix: Milk and Astronaut, like CoolBanana in F4.3, were rejected at schema version 99, reacquired from their exact admitted URLs, restored to schema version 1 and their pinned SHA-256, and returned ready with one mapped texture.

Evidence: `docs/verification/F4-STORAGE-WEBGL-RECOVERY-2026-08-24.md`.

### F4.5 render lifecycle and representative motion — 2026-08-24

- Stopped the animation-frame loop for native-hidden, Chromium document-hidden/occluded, Electron power-suspended, WebGL-lost, and WebGL-unrecoverable states; motion time now advances only while active.
- Wired real Electron suspend/resume events into typed main-owned ambient state without focusing or reopening an intentionally hidden companion.
- Added an eight-second production WebGL recovery deadline and persistent **Retry graphics** route that replaces the canvas/renderer before re-admitting the selected asset.
- Package-proved native hide/show suspension, the shared power lifecycle path, withheld WebGL restoration followed by successful retry, and 80 serialized avatar switches.
- Captured Full-motion Jump on Milk and Astronaut. Runtime binding and texture admission pass, but visual review found expansive limbs/antenna at the frame edge, so per-avatar motion-envelope visual admission remains open.

Evidence: `docs/verification/F4-RENDER-LIFECYCLE-2026-08-24.md`.

### F4.6 live motion-envelope framing — 2026-08-24

- Added generic perspective-camera containment driven by current projected geometry rather than avatar or animation identifiers.
- Rejected the first ordinary-object-bounds attempt after its package diagnostic disagreed with visible skinned-arm clipping; the final path recomputes actual `SkinnedMesh` bounds on an adaptive active/idle cadence.
- Added fast contraction and slower release, a pathological-pose floor, and updated projected hit bounds without resizing or focusing the native surface.
- Package-proved Milk at its unchanged `1.0000` preferred idle zoom and its complete wide Jump at `0.6340`; package-proved Astronaut's complete antenna/body and Jump at approximately `0.843`.
- Both Full-motion Jump captures retain `user-jump-1`, mapped textures, and no clip, preference, framing, or exercise error.

Evidence: `docs/verification/F4-MOTION-ENVELOPE-2026-08-24.md`.

### F4.7 adaptive render performance — 2026-08-24

- Added bounded packaged sampling for ten seconds visible, six seconds native-hidden, and three seconds recovered, including renderer/GPU CPU, working set, lifecycle frames, and reason.
- Added provider-neutral 30 FPS ambient life and 60 FPS semantic work/cue/preview policy with unit coverage and renderer diagnostics.
- Reduced visible renderer average CPU from 2.858% to 1.867% and GPU from 4.013% to 2.150% on the current machine; renderer working set peaked at 259,364 KiB.
- Proved hidden frame 582 stayed exact for six seconds while renderer/GPU CPU averaged 0.010%/0.037%, then advanced to 673 after inactive recovery.
- Kept the composed visible-idle CPU gate open: renderer plus GPU still total about 4.02% before browser-process cost.

Evidence: `docs/verification/F4-ADAPTIVE-PERFORMANCE-2026-08-24.md`.

### F4.9 Windows reference-device lifecycle — 2026-08-24

- Added fail-closed repeatable scripts for a real auto-woken Modern Standby cycle and bounded longer idle/active/hidden package plateaus using an isolated verified offline avatar cache.
- Found and fixed a real post-wake compositor edge: only an ambient surface that was visible before suspend is non-activatingly re-presented and invalidated after resume; deliberately hidden companions stay hidden.
- Passed one real suspend/resume epoch, avatar/WebGL continuity, non-focused recovery, frame-loop recovery, wake-setting restoration, task cleanup, and process cleanup after 111.9 seconds away.
- Passed 60/30/15-second idle and 30/15/10-second normalized-thinking lifecycle matrices with exact hidden frame stability. Whole-app visible idle averaged 4.107%, so the `<3%` target truthfully remains open; normalized thinking at 60 FPS averaged 7.745%.
- Rejected and fully removed `get-windows` after it introduced 71 packages and six production audit findings. The final production tree remains at zero reported vulnerabilities; full-screen observation stays an audited native-boundary gate.

Evidence: `docs/verification/F4-WINDOWS-REFERENCE-LIFECYCLE-2026-08-24.md`.

### F4.8 real VRM 1.0 engineering compatibility — 2026-08-24

- Pinned the official Seed-san VRM 1.0 sample by repository commit, source-record/model/screenshot hashes, exact byte lengths, creator, VPL 1.0 terms, and embedded commercial/redistribution/modification/credit settings without bundling it or adding it to the marketplace.
- Added a fail-closed temporary package lane that accepts only the exact external binary for three finite VRM 1.0 exercises and leaves ordinary selected-avatar loading unchanged.
- Proved production cache admission, verified offline restart, corrupt-sidecar repair, the six-mode normalized companion cycle, explicit Jump, live framing, reduced-motion switching, idle restoration, and forced WebGL loss/recovery on packaged Windows.
- Visually compared the unusual extended mechanical arm against the official reference and confirmed it is authored model geometry, not retargeting corruption.

Evidence: `docs/verification/F4-VRM1-COMPATIBILITY-2026-08-24.md`.

F3d.1 adds desired-visibility recovery, debounced display reconciliation, macOS/Linux workspace policy without false Windows claims, timer/RAF frame scheduling, calm 20 FPS state loops with all deliberate motion retained at 60 FPS, forced-colors/increased-contrast styling, and renderer-visible recovery diagnostics. Packaged Windows proves unexpected hide and minimize recovery, deliberate-hide preservation, control-center focus preservation, hidden frame stability, and recovered frame advance. The comparable 30/15/10 plateau reports 3.103% visible idle, 0.081% hidden, and 3.851% warm recovered idle. Evidence: `docs/verification/F3D1-WINDOWS-VISIBILITY-PERFORMANCE-2026-08-26.md`.

F3d.2 closes the executable avatar/animation-profile foundation. Marketplace revision 3 requires every avatar to name a reviewed profile. `desky-humanoid-standard-v1` owns the exact built-in library, 15 required humanoid bones, four state modes, three autonomous programs, Jump, reviewed intensity, and forbidden root motion. Runtime fails on library/profile drift and registers only those four runnable programs, leaving eleven catalog programs non-executable. Structural VRM 0.x/1.0 binding covers all 85 canonical clips. A clean packaged Windows six-switch run downloaded, verified, and transactionally committed all three free companions with no exercise error. The product-suitable CC0 VRM 1.0 selection and its final visual matrix remain external product evidence. Evidence: `docs/verification/F3D2-ANIMATION-PROFILE-ADMISSION-2026-08-26.md`.

Next: close F5d.3 now that the refreshed Runner Courage OAuth profile and `gpt-live-1-codex`/`spruce` session admission pass: real assistant audio, transcript/output ordering, barge-in during audible playback, clear/mark timing, provider disconnect and same-session recovery. Then add reviewed device selection and truthful audio-driven facial response. Remote OpenClaw/Hermes deployment evidence, product-suitable CC0 VRM 1.0 selection, Windows external full-screen/manual accessibility/physical-display evidence, macOS, Claude, and production commerce remain owner/external gates.

## F4x — commerce and entitlement program

F4x is downstream of the free marketplace foundation and can progress beside later adapter work without coupling commerce to a gateway provider.

### F4x.0 owner/legal gate

- Publisher/selling entity, source licence, service terms, selling regions, tax strategy, privacy/support/refund policy, merchant custody, and storefront posture are named decisions.
- Public language says `Unlock for Desky`; source/licence/attribution remain visible and no exclusive-ownership claim is made.
- Mac App Store chooses StoreKit products or free-only launch; direct distribution is never described as store bypass.

### F4x.1 durable entitlement service

- Product, offer, exact-price quote, order, payment attempt, append-only entitlement event, asset grant, refund, and audit contracts.
- Short-lived signed access JWT with strict issuer/audience/algorithm/type validation, JWKS rotation, OS-vault refresh, and bounded offline lease.
- Restore, support grant, device recovery, takedown, refund/revocation, and idempotent reconciliation.
- No production payment provider in this slice.

Exit: adversarial contract suite and clean-device restore pass; JWT is demonstrably not the durable ledger.

F4x.1a–c are implemented locally: strict commerce/quote/grant/ledger contracts; transactional SQLite conformance; a production repository port and fixed hosted HTTP boundary; strict rotating Ed25519 JWKS; OS-encrypted, generation-checked refresh rotation; PKCE/idempotent clean-device restore; reconciliation-before-persist; and a signed 72-hour installation/revision-bound offline lease with a pinned verification key and explicit clock/reboot policy. All paid providers, external checkout, and production payment remain unreachable. A real hosted database adapter/API deployment, identity provider, TLS/domain, key custody, migrations/backups/restore, workers/monitoring, multi-instance and clean-device hardware evidence remain F4x.1 operational exits.

Microsoft Store x402 is not assumed. Current policy 7.19 permits secure third-party commerce for non-game PC digital goods but treats cryptocurrency initiation as financial information. The initial Store profile stays free-only; company identity, declarations, explicit provider/authentication/confirmation and disable controls, regional legal review, content/storefront obligations, and certification are mandatory before any later enablement. The evidence checklist is `docs/research/MICROSOFT-STORE-X402-POLICY-2026-08-24.md`.

The Windows channel decision is locked: the website offers a signed direct download beside the Microsoft Store link. The initial Store package is free-only with commerce code/routes absent. Later Store x402 is a new declared and certified package update, never a remote activation; direct Windows remains the first candidate x402 pilot. Before paid code exists, replace the development `DESKY_DISTRIBUTION` default with a baked fail-closed release manifest and artifact-absence tests.

### F4x.2 x402 Base direct-build pilot

- Pin and audit x402 v2; pass Base Sepolia exact-USDC success/failure/replay/expiry/duplicate/callback-loss tests.
- Trusted human approval shows verified product, amount, USDC asset, CAIP-2 network, merchant recipient, expiry, and grant.
- Select and operationally review a production facilitator; merchant credentials remain server-side.
- Mainnet starts as a capped direct Windows/macOS canary only.

Exit: purchase, restore, delivery failure recovery, refund/support correction, monitoring, and incident rollback pass with zero agent/wallet-key custody.

Status: F4x.2a is locally implemented and provider-disabled. The official v2 wire shape is pinned at x402 Foundation revision `aeb0fddd2f9131a46f8f7ee93aca3fca4da98401`; a strict service-only adapter admits only exact EIP-3009 Base Sepolia USDC for an authoritative short-lived `windows-direct` quote and configured merchant. Contract tests cover wrong network/asset/recipient/profile/currency, payload/resource mutation, authorization lifetime, facilitator capability, redirects, content type, size, timeout, payer, and amount. The public testnet facilitator advertised v2 exact Base Sepolia during a live discovery probe. No payment ran. Next: durable unknown/settled evidence and reconciliation, server checkout/browser-wallet handoff, then a funded Base Sepolia matrix.

F4x.2b is locally implemented: immutable authorization evidence is separate from append-only settlement observations; timeout/callback loss remains unknown, pending and transaction reuse are explicit, terminal state cannot regress, unresolved payment blocks retry/order closure, and only exact settled evidence can atomically issue an entitlement/grant. The production repository port carries the same records. No funded payment ran. Next: hosted checkout endpoints and explicit browser/wallet handoff, followed by the funded Base Sepolia success/rejection/expiry/replay/timeout/callback-loss/restart matrix.

F4x.2c is locally implemented and provider-disabled: exact checkout create/status/cancel contracts and fixed authenticated hosted routes; durable approval/account/installation/idempotency-bound sessions; canonical quote/order digest revalidation; a main-owned single-use approval coordinator; exact same-origin system-browser handoff with reopen recovery; and a service-only x402 processor that keeps wallet signatures ephemeral. The ledger atomically records `settlement-dispatching` before `/settle` and only the claim winner may dispatch, so crash, timeout, exact replay, or a second process cannot automatically pay twice. No renderer/main commerce IPC, wallet SDK/page, funded payment, production facilitator, merchant credential, or paid release profile is enabled. Next: implement the hosted wallet-page adapter and execute the funded Base Sepolia matrix, then project settled checkout status through atomic grant and recovery evidence.

F4x.2d is locally implemented and provider-disabled: a PKCE-style browser verifier/challenge; one-time bootstrap into a `__Host-` Secure/HttpOnly/SameSite cookie; rotating synchronizer CSRF; exact origin/fetch-metadata/cookie enforcement; hardened no-store JSON; a strict same-origin browser API client; and explicit EIP-1193 Base Sepolia EIP-712/EIP-3009 signing. Display and signing terms are cross-checked. Bootstrap creates no order transition or attempt. Signed payloads remain memory-only while a digest-bound 15-second processing lease supports restart-safe exact resubmission, and the F4x.2c dispatch claim prevents double settle. Settlement status projects back to desktop polling. No authorized funded-testnet wallet, hosted ingress, or secret configuration exists on the reference machine, so no live payment was attempted. Next: deploy the testnet page/API, run the funded matrix, close settled-to-grant/restore, then conduct production operations/legal admission.

F4x.2e.1 is implemented and deployed unfunded at `https://desky-checkout-testnet.netlify.app`: isolated hosted workspace, hashed first-party wallet page, same-origin CSP/security headers, fixed browser and health/readiness Functions, bounded request streaming, PostgreSQL migration, and an async transactional checkout/settlement/grant ledger. Live HTTPS/header/fail-closed probes pass. The current Netlify team plan returned 403 for built-in Database creation; no database/service instance, merchant recipient, facilitator credential, wallet funds, identity route, paid Electron profile, or funded payment exists. Next: upgrade the Netlify plan or provide an approved managed PostgreSQL URL, apply migration 0001, prove multi-instance behavior, wire authenticated quote/session/recovery plus reconciliation, and only then run the funded matrix.

F4x.2e.2 is implemented against the dedicated Supabase `Desky` project: PostgreSQL 17 migration 1, private `desky_commerce` schema, least-privilege runtime login, denied Data API roles, SSL enforcement, pinned Supabase CA, exact Supavisor transaction-pooler connection, and production-scoped Netlify secrets. A real two-pool race produced exactly one settlement-dispatch winner and a durable exact replay. Live `/healthz` is 200; `/readyz` remains sanitized 503 because no merchant/facilitator is admitted. Next: rotate the interactively disclosed owner password, implement authenticated identity/quote/session/recovery and reconciliation operations, prove backups/restore/alerts, and only then execute the funded matrix.

F4x.2e.3 is implemented and deployed: migration 2 adds opaque Supabase-backed identity/install/recovery state and shared rate windows; the service issues its own Ed25519 access/offline authorization, grants the three free avatars transactionally, rotates refresh/recovery material without storing plaintext, serves JWKS, and exposes fixed authenticated identity, optional authoritative quote, checkout and recovery routes. Secret operator status/reconciliation/backup routes, a verified AES-256-GCM logical restore drill, DPAPI pilot key escrow and a fifteen-minute scheduled monitor now pass. The live quote route remains unavailable because no paid offer is admitted; `/readyz` therefore stays 503. A real Supabase user exchange, external paging, off-device escrow, automated provider/chain reconciliation and owner-password rotation remain before the funded gate. Evidence: `docs/verification/F4X2E3-IDENTITY-OPERATIONS-2026-08-25.md`.

F4x.2e.4 is implemented and deployed in non-payable mode. Toothpaste from `100Avatars R1` is the first rights-reviewed paid-pilot revision, pinned to the existing registry commit with exact CC0 provenance, URLs, hashes and sizes. Its only admitted test offer is 0.10 Base Sepolia test USDC (`100000` atomic units), Windows direct only. The public facilitator currently advertises v2 exact Base Sepolia but has no status route, so reconciliation now uses an independent Base observer: exact `AuthorizationUsed`, successful receipt, exact USDC `Transfer`, three confirmations, monotonic observation, then the existing atomic grant transaction. Granted orders leave the active queue. The public RPC is configured for testnet only; no offer or merchant is configured and `/readyz` remains 503. Owner password rotation is reported complete. Remaining funded prerequisites are a dedicated merchant receive address, a real Supabase app-user exchange, payer test USDC, and human wallet approval. Evidence: `docs/verification/F4X2E4-PAID-PILOT-OBSERVER-2026-08-25.md` and ADR 0011.

F4x.2e.5 is implemented and live at deploy `6a8e087f789c7eef22bab5a6`. A dedicated confirmed Supabase pilot user completed the public password grant and the hosted Desky identity exchange, issued three free grants, and rotated its refresh session twice. The owner merchant `0x4f9c8Ea2a0e77338d41d5438F319617E2e95D7c3` and exact ZA Toothpaste offer are bound; `/healthz` and `/readyz` return 200. Exact quote replay, wrong-region/forged-token rejection, canonical-term tamper rejection, checkout replay and cancellation passed without opening a wallet or submitting payment. The round also fixed atomic order closure on cancel/expiry and PostgreSQL/pg-mem bigint normalization in backup verification. The current queue has zero pending/indeterminate items; the 22,031-byte post-repair backup restores with SHA-256 `c2f5cfa9042b1e05be8b0e400312d9a696f40feb338164ca3b4146d59024b463`. Remaining: a **different** payer address, Base Sepolia test USDC, human EIP-712 approval, funded settlement/recovery/clean-device proof, external paging/off-device escrow, and production RPC. Evidence: `docs/verification/F4X2E5-LIVE-IDENTITY-READINESS-2026-08-25.md`.

F4x.2e.6 is implemented and live at deploy `6a8e3d2146b97801ebf18e92`. The first real DPAPI-bound five-minute quote and single-use browser handoff opened the exact Toothpaste/0.10 test-USDC/Base-Sepolia terms in Firefox. No wallet action occurred; authoritative polling proved `ready -> expired` with no settlement observation or grant. The run exposed and fixed PowerShell ISO-date auto-conversion that double-applied the local offset, made refresh rotation crash-recoverable by escrowing its deterministic rotation ID before transmission, added sanitized internal-error correlation, classified invalid approval lifetimes as 400, and added a capped scheduled expiry sweep for quote-only orders that never obtained a checkout session. The protected live monitor expired seven diagnostic quote-only orders and returned the operations/reconciliation queues to zero; the 45,837-byte post-expiry backup restores with SHA-256 `06b8f8c49c7644d4b7cbaa2ca67c234710f47422203aedf45193a7ce1e1d2376`. The sweep never touches an order with a checkout or in-flight settlement. Browser and server also independently reject merchant-as-payer. Remaining: fund and identify a separate payer, repeat the short-lived launch while the owner is ready, approve the EIP-712 authorization, and complete settlement/grant/restart/recovery/clean-device evidence. Evidence: `docs/verification/F4X2E6-BROWSER-EXPIRY-OPERATIONS-2026-08-26.md`.

F4x.2e.7 is implemented and live at deploy `6a8f2640658e79d8b0c1e591`. MetaMask account `0xCa60c8eF6934f8a97c6a503C4e3a46e87F5b08bD` manually approved the exact EIP-3009 authorization; Base Sepolia transaction `0xb782b880d955d19252c23b58cac09a017f6dbcea26158c74748fe58074c14887` succeeded and emitted one official-USDC transfer of `100000` atomic units to the merchant. The scheduled independent observer inspected one candidate with zero errors and atomically granted Toothpaste. Live refresh then exposed and closed a real multi-catalog authorization defect: new access tokens carry a unique bounded `catalogVersions` set, while legacy singular tokens remain accepted only for their short rollover lifetime. The original session, a separate DPAPI clean-device restoration, a fresh-process refresh, and a 14-table encrypted backup/isolated restore all preserve the exact paid grant. The monitor now also closes expired `ready`/`awaiting-wallet` sessions while excluding every signing/settlement state. Remaining F4x pilot work is the live manual negative-wallet UX matrix and production-grade redundant RPC/paging/key custody; mainnet and Store commerce remain disabled. Evidence: `docs/verification/F4X2E7-FUNDED-BASE-SEPOLIA-LIFECYCLE-2026-08-26.md`.

F4x.2e.8 is implemented and live at deploy `6a8f2df08c5c4cebb6a6bc14`. The hosted page no longer combines connection and payment: `Connect MetaMask` discloses only the public account, switches to Base Sepolia and performs a non-authoritative official-USDC balance preflight; the separate review state names the exact amount and requires a second `Sign` action. Signing rechecks the selected account, network, balance and checkout lifetime before opening MetaMask. Rejection, insufficient test USDC, expiry and terminal sessions have distinct bounded states, and expired/cancelled/failed sessions cannot present a retry control. Facilitator verification and the ledger remain authoritative. The live page, `/healthz`, and `/readyz` pass; contract evidence proves that connection cannot invoke `eth_signTypedData_v4`. A manual live rejection screenshot remains optional evidence and no second funded purchase is required. Evidence: `docs/verification/F4X2E8-CHECKOUT-UX-2026-08-26.md`.

### F4x.3 additional rails and storefronts

- Add Solana only after Base operations and demand justify the second rail; reuse the exact order/entitlement semantics.
- Add StoreKit for Mac App Store paid content and Microsoft commerce only if chosen; enforce provider unreachability in disabled profiles.
- Reverify current Apple/Microsoft rules immediately before submission.

Exit: one product grant behaves consistently across enabled providers and every packaged release profile exposes only allowed commerce.

### F4x.4 agent discovery

- Provider-neutral read-only catalog and entitlement tools plus prepare-checkout deep link.
- OpenClaw is the first conformance adapter; later Claude/Hermes/Codex adapters map native discovery into the same capability.
- Every payment requires the independent local human approval; model-supplied price/network/asset/recipient is ignored.

Exit: adversarial prompt/tool tests prove the agent can recommend and prepare but cannot spend or mutate commerce authority.

The security and protocol authority is `docs/COMMERCE-ENTITLEMENTS.md`.

## F5 — additional runtimes

F5a.1 is implemented: the executable generic contracts, active-runtime registry, `desky:adapter:*` IPC/preload surface, and provider-neutral renderer state sit above the unchanged OpenClaw transport host. F5a.2 is complete: Codex is a production direct-profile adapter behind explicit provider selection, while Store-profile construction contains only OpenClaw. The bounded stdio peer, executable/version/schema admission, opaque workspace grants, read-only-first sandbox disclosure, consumed-field validation, bounded full-readmission reconnect, shell-free process-tree termination and awaited shutdown all remain main-owned. Typed actions are truthfully unsupported because the only client-local registration surface is experimental. Both source and packaged authenticated matrices pass real model streaming, write approval deny/allow, descendant cancellation, same-session recovery and reconnect; the packaged filesystem oracle independently confirms exact allow bytes and denied/cancelled absence. F5a.3 has frozen executable Adapter Contract v1 invariants across both production implementations: descriptors, normalized state, capabilities, sessions, agent-action claims, and bounded events now fail closed at the registry boundary. Public third-party SDK packaging remains a later gate, not an implied promise from internal interfaces.

F5b.1-F5b.4 admit Hermes on Windows direct builds against official source revision `057dcdf236f8a6a26721c10fcc6ccb72726e272a` and loopback Hermes Agent `0.20.5`. The authenticated source matrices prove strict capability/version admission, bounded HTTP/SSE, sessions, OAuth-backed `gpt-5.4` streaming, tool/subagent lifecycle, guarded approval denial/allow-once, Stop during execution, redaction, exactly-once terminal behavior, passive and active recovery without replay, and a real installed gateway restart. Credential fixtures prove exact-endpoint saved access, post-admission writes, failed-rotation preservation, explicit removal, and encryption-unavailable failure. The packaged matrix proves clean enrollment, encrypted reuse, a new session, real stream, approval/Stop, clean app exit, no renderer token exposure, ciphertext-only storage, and a second process reconnecting with saved access. Hermes is `production: true` and registered only in direct builds; Store construction does not instantiate it. Remote TLS deployment, typed Desky actions, and macOS package/credential evidence remain open.

F5b.2-F5b.4 evidence is recorded in `docs/verification/F5B2-HERMES-AUTHENTICATED-MATRIX-2026-08-24.md`, `docs/verification/F5B3-HERMES-RESILIENCE-2026-08-24.md`, and `docs/verification/F5B4-HERMES-DIRECT-ADMISSION-2026-08-24.md`.

F5b.5 source disposition confirms that remote Hermes is not a direct public bind: the pinned aiohttp API Server has no TLS listener, while Desky requires HTTPS for every non-loopback endpoint and never exposes a certificate bypass. Known certificate trust/name/expiry failures are terminal and sanitized. Hermes's stable `/v1/capabilities` and `/v1/toolsets` routes are read-only; actual third-party tools are process-wide MCP configuration owned by Hermes. Because there is no API-client callback registration surface, typed Desky actions remain unsupported. The MCP helper is now explicitly deferred: core Hermes and Codex features do not require it, and Desky will not impose a separately installed/configured product for optional gestures. Any future helper must ship as an automatically managed signed sidecar within the one-app direct distribution and pass its own security/Store review. See `docs/verification/F5B5-HERMES-TRANSPORT-ACTION-DISPOSITION-2026-08-24.md` and `docs/AGENT-ACTIONS.md`.

F5b.7 closes the locally executable remote transport-security contract across OpenClaw and Hermes. Both adapters use one sanitized terminal classifier for certificate trust, hostname, validity-window, and TLS-handshake failures; OpenClaw also disables redirects/compression, bounds payloads, and closes on binary or malformed frames. Unit fixtures prove reconnect suppression, and a real-socket matrix proves actual untrusted HTTPS and WSS rejection with an ephemeral certificate generated outside the repository. `deploy/hermes/Caddyfile.example` and `docs/deployment/HERMES-HTTPS-INGRESS.md` define the operator boundary. A trusted public endpoint, full authenticated session/stream/approval/cancellation/restart evidence through that ingress, and macOS remain external gates. See `docs/verification/F5B7-REMOTE-TRANSPORT-SECURITY-2026-08-26.md`.

F5c.1 Claude foundation is implemented with exact production dependency `@anthropic-ai/claude-agent-sdk 0.3.241`: typed partial streaming, SDK session list/resume, API-key-only init admission, reviewed environment and setting isolation, opaque workspace grants, plan/default permission mapping, SDK approval callbacks, cancellation, redaction, and exactly-once terminal fixtures pass. It is direct-only, unregistered, and `production: false`. Anthropic's documented restriction against unapproved third-party Claude.ai login reuse is enforced architecturally. An authorized API-key source/package matrix, effective-policy adversarial proof, lifecycle/crash evidence, vault integration, and typed Desky MCP action remain open.

F5c.2 offline security/custody hardening is implemented: strict empty MCP configuration, exact bundled Claude Code `2.1.241`, effective workspace/permission admission, OS-encrypted blank-key reuse, and transactional enrollment/rotation/removal fixtures pass. Credential mutation occurs only after a successful API-key-authenticated terminal turn, so rejected replacement keys and lifecycle failures preserve prior access. The separate admission package profile places the 337,745,056-byte pinned Windows SDK executable in resources, passes packaging, and verifies its valid Anthropic Authenticode signature; ordinary packages exclude that payload before promotion. The local environment has no authorized `ANTHROPIC_API_KEY`; real streaming/tool/cancellation/crash and authenticated clean-package/second-process evidence therefore remain unclaimed, the descriptor stays `production: false`, and Claude remains unregistered. See `docs/verification/F5C2-CLAUDE-OFFLINE-ADMISSION-2026-08-24.md`.

Order:

1. Codex direct adapter using app-server stdio. Complete.
2. Hermes authenticated API-server adapter, prioritized after official structured-protocol discovery.
3. Claude supported Agent SDK adapter for direct builds; consumer Claude login cannot be reused by third-party products without Anthropic approval.

Exit gate per adapter:

- Shared contract suite passes.
- Auth and permission UX is runtime-specific but state behavior is consistent.
- Runtime versions and unsupported modes are reported clearly.
- Fixture-only foundations remain unregistered and `production: false` until authenticated source and packaged matrices pass.

## F6 — store-ready beta

F6a.1 engineering foundation is complete. The mutable development distribution switch is gone: Webpack embeds one exact schema-v1 manifest, main validates it before use, and the build selects separate development-direct, release-direct, or Store-free runtime graphs. Windows Store-free packages OpenClaw only; Windows direct packages OpenClaw, Codex and Hermes; Claude remains development/admission-only. Both real ASAR artifacts pass reciprocal policy checks, and every currently admitted release profile has commerce disabled. `windows-store-third-party-commerce` remains deliberately unknown until it has a separately reviewed implementation and Store submission. Evidence: `docs/verification/F6A1-IMMUTABLE-RELEASE-PROFILES-2026-08-26.md`.

F6a.2 Windows release engineering is complete at the development/reference-device level. Store-free now produces an independently verified MSIX with exact fail-closed Partner Center identity inputs; direct produces a separately named Squirrel installer and full update payload with fail-closed external Authenticode inputs. Official Windows logo assets, artifact byte budgets, CycloneDX 1.6 SBOM, generated notices, production audit, SHA-256 digest set and explicit non-SLSA build evidence are automatic. The reference device passed MSIX `0.1.0.0 -> 0.1.1.0` install/update/launch/uninstall and direct install/launch/uninstall without retained package, process or development trust. A production-signed direct update advance, owner identities/certificates and clean-machine production-signature evidence remain open. Evidence: `docs/verification/F6A2-WINDOWS-RELEASE-ENGINEERING-2026-08-26.md`.

The 2026-08-26 five-gate closure is recorded in `docs/verification/FIVE-GATE-CLOSURE-2026-08-26.md`: checkout authorization UX, Windows companion quality, animation-profile admission, remote adapter transport security, and immutable release profiles are committed and verified together. The recorded root suite passed 491 tests and hosted commerce passed 29. Production audits remain zero; after admitting the experimental MSIX maker, the known Forge/build-tool audit is 32 and remains a release gate.

Deliverables:

- Store identities and commercial model resolved.
- Desky source licence selected.
- Privacy policy, support, security contact, third-party notices, SBOM.
- Apple sandbox and Windows MSIX package pipelines.
- Direct signing/notarization pipelines.
- Store metadata, screenshots, review notes, age/content answers, review account/demo.
- Crash reporting only after explicit privacy decision.

Exit gate:

- Clean-machine install/update/uninstall matrix passes.
- Apple and Microsoft preflight checks pass.
- Every remote asset and animation has provenance.
- Release candidate digest and signature verification are recorded.

## Owner decisions

These decisions are deliberately not guessed:

1. Source-code licence and whether commercial forks must contribute changes.
2. Publisher legal entity and store accounts.
3. Final avatar offer types/prices, free-tier commitment, tax/merchant-of-record strategy, refund policy, and selling regions.
4. Whether Desky operates a hosted relay.
5. Whether NFT-origin source collections appear as ordinary licensed assets in Store builds; token ownership remains irrelevant and no NFT marketplace is planned.
6. Security and support contact addresses.
7. Minimum supported OS versions after hardware testing.
8. Merchant wallet custody, production x402 facilitator, account/wallet recovery, and offline-lease policy.
9. Whether the Mac App Store launches free-only or with StoreKit avatar products.

## Immediate next rounds

1. Complete F5d.3 packaged Windows direct realtime evidence now that OpenClaw GPT-Live OAuth/model/voice session admission passes: permission allow/deny, partial/final transcripts, audible output, Interrupt, clear/mark order, backlog/error, disconnect, surface close, and same-session recovery. Streaming dictation remains separately blocked by the missing transcription API-key profile; it must not be conflated with the admitted GPT-Live realtime path.
2. Add the reviewed microphone declaration and privacy copy only when promoting voice into the Microsoft Store profile; until then Store capability and controls remain disabled.
3. Supply the Microsoft Partner Center identity, legal publisher name, Windows code-signing certificate, privacy/support/security URLs and source licence; then run the same makers in production mode on a protected clean signing worker.
4. Prove a signed direct `0.1.0 -> 0.1.1` update through the hosted HTTPS feed and repeat install/update/uninstall on a clean Windows account/device; run final Partner Center/WACK preflight with the reserved Store identity.
5. Deploy a trusted operator-owned OpenClaw/Hermes ingress and run the full authenticated lifecycle through it. Keep typed actions unsupported and the MCP helper deferred under the one-app decision. Hermes remains excluded from Store builds.
6. Complete the remaining `<3%` Windows idle margin plus external full-screen, manual accessibility, physical display reconnect, multi-monitor, virtual-desktop, final CC0 VRM 1.0, and macOS evidence.
7. Keep the completed Base Sepolia pilot frozen except for optional manual rejection evidence and production operations hardening; mainnet and Store commerce remain disabled. Owner-deferred lanes remain macOS/Keychain and Claude's authenticated matrix.

See `docs/EXECUTION-PLAN.md` for dependencies, parallel lanes, and owner/store gates.
