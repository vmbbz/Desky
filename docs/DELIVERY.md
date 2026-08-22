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
- `DESKY_VISUAL_TEST_PATH` capture shows the packaged companion and records the live avatar load result.

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
- Integration of those checks into the current remote-avatar load path before the model enters the scene.
- Fresh packaged Windows smoke through `desky://` with the real default reaching `Milk · VRM 0.x · CC0 · 100Avatars R1`.
- Bundled offline Mixamo/FBX parser and deterministic canonical converter with full official humanoid mapping, fixed sampling/quantization, quaternion continuity, explicit root-motion policy, and fail-closed input limits.
- Versioned avatar-neutral canonical JSON plus runtime VRM 0.x/1.0 binding with target hips-height scaling.
- Non-writing inspect mode and a rights-gated conversion CLI that produces atomic clip/manifest pairs and refuses implicit overwrites.

Verified against the current remote Milk default without committing its binary: the registry declares project CC0; embedded VRM 0.x metadata declares everyone/commercial use/CC0; all core retarget bones are present; and the 1,338,344 downloaded bytes hash to `99e32f15d529eb47b3892aa44d5f053c07dabf55a0851aca7e7ab74f5f17e107`.

Open before the F3a slice is complete:

- Obtain explicit owner/reviewer approval for the first redistributable animation source, then commit its source/output provenance and repeatable checksum evidence. No external smoke asset is admitted.
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

- Admit the first owner-approved redistributable production clip through the rights/provenance manifest. The open-source avatar registry does not license unrelated animation files.
- Add queued conversational gestures and explicit user-requested action choreography without permitting random idle motion to interrupt them.
- Add capability-aware blink, look-at, expression, and optional viseme layers.
- Add an in-product pause/reduced-motion override, occlusion suspension, WebGL recovery, and packaged Windows/macOS visual/performance evidence.

The implementation and validation evidence is recorded in `docs/verification/F3B-MOTION-RUNTIME-2026-08-22.md`.

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

Evidence is recorded in `docs/verification/F3C2-DESKTOP-BEHAVIOR-2026-08-22.md`.

F3c.3 is now the next desktop-presence round: contextual composer reveal/collapse with draft persistence, long-response overflow and **Open conversation**, plus cross-window approval reconciliation. The manual multi-monitor/display-scale pointer matrix, macOS equivalence, full-screen policy, and lifecycle/performance evidence remain broader F3/F3d exits.

## F4 — control surface and daily usability

Deliverables:

- Onboarding and runtime connection management.
- Accessible transcript and approval center.
- Avatar browser with licence/attribution views.
- Window placement, tray, click-through, hotkeys, and notification controls.
- Cache, privacy, deletion, and diagnostic export controls.

Exit gate:

- Full keyboard and screen-reader critical path.
- Multi-monitor and sleep/wake recovery tests.
- No security-sensitive action depends solely on animation.

## F5 — additional runtimes

Prerequisite F5a extracts the executable generic adapter host after the F3c.1 surface boundary and before a second production adapter or final F4 connection UX. OpenClaw must pass the same shared contract after extraction; the renderer must not receive provider-native frames.

Order:

1. Codex direct adapter using app-server stdio.
2. Claude supported structured interface.
3. Hermes after supported protocol discovery.

Exit gate per adapter:

- Shared contract suite passes.
- Auth and permission UX is runtime-specific but state behavior is consistent.
- Runtime versions and unsupported modes are reported clearly.

## F6 — store-ready beta

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
3. Free, paid, freemium, or supporter-funded model.
4. Whether Desky operates a hosted relay.
5. Whether NFT-origin collections appear in Store builds.
6. Security and support contact addresses.
7. Minimum supported OS versions after hardware testing.

## Immediate next rounds

1. Implement F3c.3 contextual composer, draft, overflow, open-conversation, and cross-window approval reconciliation behavior.
2. Start F5a generic adapter-host extraction now that the F3c surface and desktop-policy boundaries exist; finish it before Codex and before F4 connection management is finalized.
3. In parallel, approve the first redistributable animation, build the binary VRM suite, and persist provenance-bearing cache records.
4. Complete response-stream interruption, remote `wss://`, clean pairing/rotation, and macOS Keychain verification.
5. Establish reference Windows and macOS devices for performance, packaging, and lifecycle evidence.

See `docs/EXECUTION-PLAN.md` for dependencies, parallel lanes, and owner/store gates.
