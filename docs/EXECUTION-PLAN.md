# Desky execution plan

## Purpose

This is the active sequencing document. It reconciles the desktop-companion work, animation and avatar gates, remaining OpenClaw verification, additional runtimes, the control center, and store release work. Detailed acceptance requirements remain in the linked architecture, experience, adapter, asset, and distribution documents.

The governing rule is: parallel work may proceed when boundaries are already stable, but no later surface may hard-code assumptions that make a planned runtime or Store profile expensive to add.

## Dependency map

```text
F1 foundation ── F2 OpenClaw core ── F3b motion foundation
                                      │
                                      ├── F3c desktop presence ── F3d resilience ── F4 daily control center ── F6 Store beta
                                      │              │
                                      │              └── packaged Windows/macOS state and performance evidence
                                      │
                                      ├── F5a generic adapter host ── Codex ── Claude ── Hermes
                                      │
                                      └── asset lane: approved clips + binary VRM suite + persistent provenance

F2 verification lane: remote WSS + clean pairing/rotation + macOS Keychain ────────────────────────┘
Owner lane: licence + publisher/accounts + business/privacy/support decisions ────────────────────┘
```

## Why F3c proceeds before Claude and Hermes

The companion reducer, motion runtime, and avatar consume normalized `AdapterEvent` values, so the desktop presence does not depend on an OpenClaw transport. Building F3c now validates the product itself rather than adding several connections to a development card.

The surface split must nevertheless remain adapter-compatible. Connection and diagnostic UI belongs in the control center, provider wording stays contextual, and the ambient surface receives only normalized state plus semantic commands. The generic adapter-host extraction must finish before a second production adapter and before F4 freezes the final connection-management experience.

## Active critical path

### F3c.1 — surface separation

Status: implemented and package-verified on Windows; macOS evidence remains part of the broader F3 exit.

- Make the transparent ambient companion the default surface.
- Move setup, connection, session, and diagnostic UI into a standard resizable control center.
- Add typed `ambient` and `control-center` surface identities at the main/preload boundary.
- Keep explicit routes from ambient to control center and from control center back to the companion.
- Preserve Stop and approval actions on the ambient surface while richer approval history remains F4 work.
- Remove provider-specific wording from normalized reducer output.

### F3c.2 — spatial and pointer behavior

Status: implemented and package-verified on Windows; the multi-scale/multi-monitor manual matrix and macOS evidence remain broader F3 exit gates.

- Persist position per display arrangement and clamp to the active work area.
- Add deliberate drag regions without turning ordinary avatar clicks into drags.
- Measure visible avatar/bubble bounds and flip or shift anchored UI at screen edges.
- Implement transparent-region click-through and an explicit full click-through mode.
- Add tray/menu and keyboard escape routes so click-through or hidden state cannot trap the user.
- Verify that event-driven updates never steal application focus.

The implementation stores at most sixteen recent geometry-keyed placements, clamps the native window after user moves and display changes, derives bubble orientation from current work-area clearance, and uses the projected VRM bounds rather than the full transparent canvas as the character hit target. Selective transparent-region pass-through is the safe default. Full click-through is deliberately session-only and cannot enable unless a tray or global recovery route exists. Always-on-top is persisted separately.

### F3c.3 — focused companion behavior

Status: implemented and package-verified on Windows; assistive-technology and macOS evidence remain broader F3/F3d gates.

- Reveal and collapse the composer contextually while preserving drafts.
- Keep session selection and runtime setup out of the permanent ambient layout.
- Add concise overflow behavior and an **Open conversation** route for long responses.
- Reconcile approval presentation between the ambient prompt and control center.

The ambient default is now avatar-first: permanent status chrome is gone, the bubble exists only for meaningful activity, and a small **Ask Desky** or connection pill is the resting control. Character or launcher activation explicitly reveals the composer; `Escape` collapses it without clearing its session-only draft. Main owns one revisioned normalized companion snapshot and draft, so a control center opened after streaming or approval begins receives the authoritative current response and decision state. Long responses retain a bounded full live view in the control center and use a concise ambient preview with **Open conversation**. Draft text is never added to the settings or credential stores.

### F3c.4 — autonomous life and direct manipulation

Status: implemented and package-verified on Windows; the multi-scale/multi-monitor manual matrix and macOS evidence remain broader F3/F3d gates.

- Keep the companion continuously alive with neutral motion and bounded autonomous variety.
- Route decorative motion through the existing priority owner so it cannot compete with provider truth, approvals, explicit actions, previews, or reduced motion.
- Make the measured character a direct native-window drag target without breaking click-to-compose or double-click Jump.
- Add persisted 3D yaw independently of humanoid animation tracks.
- Keep work-area clamping, transparent pass-through, focus rules, and recovery surfaces intact.

The packaged surface supports direct manipulation after a five-pixel threshold and persists clamped position and yaw. A direct Three.js mesh hit rotates the avatar with ordinary horizontal pointer movement; a miss inside the measured bounds moves the native surface, and the grip is the guaranteed move target. Shift/Alt, wheel, Left/Right arrows, and Home remain rotation alternatives. The exact 11.4-second Looking Around clip is now the sole resting body owner in idle and disconnected modes; folded arms and the prior procedural overlay are catalog/removed respectively. The controlled autonomous bag contains Phone Check, Formal Walk, and rare Dance Break; it is not random selection over all 85 files. The former short head-motion/thumbs-up cadence, Search/Interact, and a proportion-breaking crouch are catalog/state-only. Authored programs retain their full canonical step lengths, blend between steps and back to the accepted state, and use perspective-frustum fitting with motion-safe margins instead of oversized fixed world targets. A packaged isolated-state harness drives both raycast-selected manipulation routes and captures each admitted ambient program on the real avatar; the same package previously completed an exact-response live turn through the authenticated OpenClaw profile.

### Next animation round — expressive motion layers

Status: procedural motion, additive expression, the first semantic agent-action route, and the first rights-approved canonical candidate library are implemented; representative binary avatars and the full packaged visual matrix remain open.

- Add a deterministic queue for user-requested actions and short conversational gestures without creating a second full-body owner.
- Add capability-aware procedural blink and restrained look-at that work without external animation files and obey reduced-motion/cancellation priority. Keep speaking on its authored state clip rather than interrupting it with a procedural full-body emphasis.
- Select the first candidate production clip only after its modification and commercial/store redistribution rights, source checksum, conversion inputs, and reviewer approval are recorded.
- Exercise the animation matrix against the current Milk VRM and the representative VRM 0.x/1.0 suite as licensed fixtures become available.
- Keep every state readable and controllable when a clip or avatar capability is absent.

The controller now owns a bounded queue for `emphasis`, `nod`, low-priority autonomous idle gestures, and explicit `wave`/`jump` actions. Higher-priority normalized states interrupt or reject lower-priority cues, an explicit action temporarily replaces any registered state clip as the sole body owner, and the current state plan resumes afterward. Idle uses the exact Looking Around state clip, thinking uses the admitted Search/Interact state, and speaking uses the admitted talk state. Standing state bindings preserve the target avatar's hips position, eliminating retargeted vertical drift; speaking no longer queues an interruption on entry. The focused ambient surface exposes an explicit Wave control and a deliberate character double-click requests Jump; raw prompt or model text is never parsed as an animation selector. Reduced motion retains a small acknowledgement but removes Jump travel and autonomous motion.

The next rights-safe slice is also implemented: the control center can select and replay a local `.vrma` as session-only content. Main validates a self-contained bounded VRM Animation, keeps it only in memory, and never exposes its path; the ambient surface loads it with `@pixiv/three-vrm-animation` and runs it through the existing mixer. Packaged Windows has passed real playback/replay/completion, reduced-motion rejection, malformed-humanoid rejection, clear, and restart-reset evidence on Milk. Active-playback interruption and macOS remain manual gates.

The Open Source Avatars live gallery was audited separately. Toothpaste has no embedded animation, and the gallery's visible actions are runtime-retargeted inputs or embedded model clips depending on the current source path. The approved replacement lane uses both free Quaternius Standard libraries: 86 source records, 84 generated clips after excluding T-poses, four state bindings, and fifteen file-defined programs. Only three Milk-reviewed programs are autonomous: Phone Check, Formal Walk, and rare Dance Break. Search/Interact is now the thinking state; short head motion, thumbs-up, crouch, sit/chat, magic, combat, death, prop, and incomplete sleep candidates cannot fire randomly. The exact OSA semantic matches and gaps are documented in `docs/research/QUATERNIUS-ANIMATION-ADMISSION-2026-08-23.md`.

A separate additive controller uses the avatar capability inventory before driving deterministic bilateral/single blink, restrained look-at, and small success/error/approval/listening/speaking expressions. Missing managers, presets, or look-at support remain no-ops, and baseline values are restored on disposal. A provider-neutral ephemeral `avatar.perform` lane now admits only typed Wave/Jump commands for the selected live session; OpenClaw supplies them through the reviewed `desky_avatar_action` tool plugin, never model-text parsing. The plugin now exposes read-scoped capability discovery, and a real OpenClaw 2026.8.1 turn has invoked Jump successfully. Speech visemes, licensed external clips, broader binary-avatar evidence, and a separate live Wave invocation remain later work.

### F3d — resilience, accessibility, and performance

Status: queued; system reduced-motion detection already exists.

- Add explicit pause-motion and reduced-motion overrides.
- Suspend rendering when hidden, occluded, or full-screen suppressed.
- Recover from WebGL loss and avatar replacement without leaking GPU resources.
- Complete keyboard, screen-reader, contrast, scaling, idle CPU, active CPU, and memory evidence.
- Run the packaged state matrix on reference Windows and macOS systems.

## Parallel lanes

### Asset completion

- Complete packaged visual admission for the rights-approved 84-clip Quaternius candidate library, disabling or tuning any program that fails the representative avatar matrix.
- Add reviewed binary VRM 0.x and 1.0 fixtures across representative proportions.
- Persist exact-byte provenance beside bounded cached assets and verify it on every read.
- Add action, conversational gesture, blink, look-at, expression, and optional viseme layers only through the established motion ownership rules.

This lane does not block F3c because deterministic procedural state fallbacks already exist. It blocks the final expressive-runtime and Store provenance exits.

### F2 verification completion

- Verify cancellation while assistant text is streaming.
- Validate a trusted remote `wss://` profile and certificate failure behavior.
- Verify clean-device pairing, cross-device contention, and paired-token rotation.
- Repeat the matrix on macOS with Keychain-backed `safeStorage`.

### F5a generic adapter platform

- Build on the now-executable `AgentAdapterCapabilities` slice and promote `AgentAdapter`, `AdapterDescriptor`, generic connection state, session state, and commands into executable shared contracts.
- Put a runtime registry/factory above `OpenClawAdapterHost`.
- Replace provider-specific renderer IPC with a generic runtime bridge while retaining adapter-specific validated authentication payloads.
- Make OpenClaw pass the shared adapter contract unchanged.
- Implement Codex as the second substantially different production adapter, then stabilize the public adapter SDK.
- Add Claude through a supported structured interface and Hermes only after supported transport discovery; terminal scraping is not acceptable.

F5a may begin after F3c.1. It must finish before the second production adapter and before F4 connection management is considered final.

## Store and owner gates

Store submission remains downstream of engineering and owner-controlled inputs:

- select the Desky source-code licence;
- establish publisher legal identity and Apple/Microsoft accounts;
- choose the commercial model, hosted-relay policy, NFT-origin catalog policy, and supported OS versions;
- provide privacy, support, and security-contact URLs;
- create signing/notarization and MSIX/Mac App Store pipelines;
- resolve the Electron Forge development-tool advisory chain without applying npm's incompatible forced downgrade;
- complete third-party notices, SBOM, store metadata, screenshots, review notes, and clean install/update/uninstall evidence.

## Definition of done for the current sequence

The current product sequence is complete only when Desky opens as an unobtrusive companion, connects through a replaceable adapter boundary, truthfully displays every active state and permission, remains controllable and accessible, passes representative packaged performance/lifecycle tests, and can be signed from provenance-complete release inputs.
