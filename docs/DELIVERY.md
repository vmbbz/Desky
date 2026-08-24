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
- Add an in-product pause/reduced-motion override, occlusion suspension, WebGL recovery, and packaged Windows/macOS visual/performance evidence.

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
- Added System/Full/Reduced motion controls scoped to the current app session. System remains the default, so explicit Full playback does not silently override an OS accessibility preference.
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

The expression round, file-driven autonomous layer, direct manipulation, normalized Wave/Jump agent-action boundary, rights-safe local VRMA preview, and first admitted candidate animation library are implemented. Packaged Windows has completed real local-VRMA playback, replay, reduced-motion rejection, malformed-humanoid rejection, completion, clear, restart-reset, direct movement, persisted view rotation, the exact Looking Around idle at multiple points in its seamless 11.4-second loop, and a live assistant-stream evidence run. Live OpenClaw action discovery and typed Jump now pass. The next animation gates are local-preview interruption by a newly entered authoritative state, a separate live Wave invocation, and representative binary-avatar evidence. The manual multi-monitor/display-scale pointer matrix, macOS equivalence, full-screen policy, and lifecycle/performance evidence remain broader F3/F3d exits.

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

Next: representative full-motion Milk/Astronaut captures, a rights-clear real VRM 1.0 admission, corrupt/restart evidence for Milk and Astronaut, user-facing cache inventory/removal, macOS equivalence, and longer GPU/sleep-wake lifecycle evidence. Signed production catalog work follows; F4x remains blocked.

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

### F4x.2 x402 Base direct-build pilot

- Pin and audit x402 v2; pass Base Sepolia exact-USDC success/failure/replay/expiry/duplicate/callback-loss tests.
- Trusted human approval shows verified product, amount, USDC asset, CAIP-2 network, merchant recipient, expiry, and grant.
- Select and operationally review a production facilitator; merchant credentials remain server-side.
- Mainnet starts as a capped direct Windows/macOS canary only.

Exit: purchase, restore, delivery failure recovery, refund/support correction, monitoring, and incident rollback pass with zero agent/wallet-key custody.

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
3. Final avatar offer types/prices, free-tier commitment, tax/merchant-of-record strategy, refund policy, and selling regions.
4. Whether Desky operates a hosted relay.
5. Whether NFT-origin source collections appear as ordinary licensed assets in Store builds; token ownership remains irrelevant and no NFT marketplace is planned.
6. Security and support contact addresses.
7. Minimum supported OS versions after hardware testing.
8. Merchant wallet custody, production x402 facilitator, account/wallet recovery, and offline-lease policy.
9. Whether the Mac App Store launches free-only or with StoreKit avatar products.

## Immediate next rounds

1. Complete the real rights-clear VRM 1.0, Mac package, user-facing cache controls, and longer GPU/lifecycle portions of the F4 compatibility matrix.
2. Complete the remaining local-VRMA interruption, live Wave, representative Milk/Astronaut full-motion evidence, and corrupt/restart matrix.
3. Start F5a generic adapter-host extraction before a second production adapter or final connection UX; keep commerce capability separate and make OpenClaw the first action/discovery conformance implementation.
4. Complete remote `wss://`, clean pairing/rotation, macOS Keychain, and reference-device performance/lifecycle evidence.
5. Begin F4x durable entitlement service only after the marketplace/free-avatar slice proves reliable and owner/legal decisions have named owners; no mainnet or store-payment implementation before that gate.

See `docs/EXECUTION-PLAN.md` for dependencies, parallel lanes, and owner/store gates.
