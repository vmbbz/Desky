# Desky execution plan

## Purpose

This is the active sequencing document. It reconciles the desktop-companion work, animation and avatar gates, remaining OpenClaw verification, additional runtimes, the control center, and store release work. Detailed acceptance requirements remain in the linked architecture, experience, adapter, asset, and distribution documents.

The governing rule is: parallel work may proceed when boundaries are already stable, but no later surface may hard-code assumptions that make a planned runtime or Store profile expensive to add.

## Dependency map

```text
F1 foundation ── F2 OpenClaw core ── F3b motion foundation
                                      │
                                      ├── F3c desktop presence ── F3d resilience ── F4 daily control center ── F6 Store beta
                                      │              │                       │
                                      │              │                       └── F4x commerce (after free marketplace proof)
                                      │              └── packaged Windows/macOS state and performance evidence
                                      │
                                      ├── F5a generic adapter host ── Codex ── Hermes ── Claude
                                      │
                                      └── asset lane ── admitted catalog + 3 free avatars + persistent provenance

F4 product lane: motion personality ── payment-free marketplace ── entitlement service ── x402 Base pilot
                                                                                     └── Solana/store providers later
F2 verification lane: remote WSS + clean pairing/rotation + macOS Keychain ───────────────────────────┘
Owner lane: licence + publisher/accounts + business/tax/privacy/support/merchant decisions ──────────┘
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

### F3c.5 — response continuity and client handoff

Status: implemented and unit/type verified; packaged Windows interaction evidence remains to be captured.

- Crossfade terminal success/error into the admitted living idle body when no exact state clip exists.
- Render the full response as safe GitHub-flavored Markdown while keeping the ambient preview compact and syntax-free.
- Auto-dismiss successful ambient responses after a bounded length-aware reading interval without deleting the transcript.
- Prefer only installed, documented provider-client routes; fall back to Deskiii for unadmitted, absent, or failed routes.

OpenClaw's fixed `openclaw://chat` route is the first admitted client handoff. Claude Agent SDK sessions, Hermes API-server sessions, and Codex app-server threads are not relabeled as another product's desktop conversation ids. The main process owns route selection and passes no provider text, endpoint, credential, or renderer-supplied URI to the OS.

### Next animation round — expressive motion layers

Status: procedural motion, additive expression, the first semantic agent-action route, and the first rights-approved canonical candidate library are implemented. F4.6 package-proves live skinned-motion framing for Milk and Astronaut VRM 0.x. F4.8 adds the real, provenance-reviewed Seed-san VRM 1.0 compatibility fixture and package-proves its normalized idle/listening/thinking/working/speaking/success cycle, explicit Jump, framing, reduced motion, WebGL recovery, cache repair, and offline restart. F3d.2 now binds every avatar revision to a reviewed file-defined animation profile; exact state/program ownership, required bones, intensity and root-motion policy fail closed before playback, and catalog-only programs are no longer registered into the controller. The final product-suitable CC0 VRM 1.0 marketplace revision and its every-enabled-program visual matrix remain open.

- Add a deterministic queue for user-requested actions and short conversational gestures without creating a second full-body owner.
- Add capability-aware procedural blink and restrained look-at that work without external animation files and obey reduced-motion/cancellation priority. Keep speaking on its authored state clip rather than interrupting it with a procedural full-body emphasis.
- Select the first candidate production clip only after its modification and commercial/store redistribution rights, source checksum, conversion inputs, and reviewer approval are recorded.
- Exercise the animation matrix against the current Milk VRM and the representative VRM 0.x/1.0 suite as licensed fixtures become available.
- Keep every state readable and controllable when a clip or avatar capability is absent.

The controller now owns a bounded queue for `emphasis`, `nod`, low-priority autonomous idle gestures, and explicit `wave`/`jump` actions. Higher-priority normalized states interrupt or reject lower-priority cues, an explicit action temporarily replaces any registered state clip as the sole body owner, and the current state plan resumes afterward. Idle uses the exact Looking Around state clip, thinking uses the admitted Search/Interact state, and speaking uses the admitted talk state. Standing state bindings preserve the target avatar's hips position, eliminating retargeted vertical drift; speaking no longer queues an interruption on entry. The focused ambient surface exposes an explicit Wave control and a deliberate character double-click requests Jump; raw prompt or model text is never parsed as an animation selector. Reduced motion retains a small acknowledgement but removes Jump travel and autonomous motion.

Live framing is also file/provider neutral. The renderer samples actual deformed skinned bounds, derives the minimum safe camera contraction, and eases back to the preferred relaxed fit. It does not list avatar IDs or animation names and therefore remains compatible with later adapter runtimes and signed catalog growth.

The next rights-safe slice is also implemented: the control center can select and replay a local `.vrma` as session-only content. Main validates a self-contained bounded VRM Animation, keeps it only in memory, and never exposes its path; the ambient surface loads it with `@pixiv/three-vrm-animation` and runs it through the existing mixer. Packaged Windows has passed real playback/replay/completion, reduced-motion rejection, malformed-humanoid rejection, clear, restart-reset, and active-playback interruption evidence on Milk. Direct tests also prove interruption and baseline restoration for newly entered approval, cancellation, disconnection, and error states. macOS remains open.

The Open Source Avatars live gallery was audited separately. Toothpaste has no embedded animation, and the gallery's visible actions are runtime-retargeted inputs or embedded model clips depending on the current source path. The approved replacement lane uses both free Quaternius Standard libraries: 86 source records, 84 generated clips after excluding T-poses, four state bindings, and fifteen file-defined programs. Only three Milk-reviewed programs are autonomous: Phone Check, Formal Walk, and rare Dance Break. Search/Interact is now the thinking state; short head motion, thumbs-up, crouch, sit/chat, magic, combat, death, prop, and incomplete sleep candidates cannot fire randomly. The exact OSA semantic matches and gaps are documented in `docs/research/QUATERNIUS-ANIMATION-ADMISSION-2026-08-23.md`.

A separate additive controller uses the avatar capability inventory before driving deterministic bilateral/single blink, restrained look-at, and small success/error/approval/listening/speaking expressions. Missing managers, presets, or look-at support remain no-ops, and baseline values are restored on disposal. A provider-neutral ephemeral `avatar.perform` lane now admits only typed Wave/Jump commands for the selected live session; OpenClaw supplies them through the reviewed `desky_avatar_action` tool plugin, never model-text parsing. The plugin now exposes read-scoped capability discovery, and a real OpenClaw 2026.8.1 turn has invoked Jump successfully. A separate Wave run reached and passed the pre-model live matrix on 2026-08-24 but was blocked by the configured Codex provider's subscription limit. Speech visemes, licensed external clips, broader binary-avatar evidence, and the capacity-deferred live Wave invocation remain later work.

### F3d — resilience, accessibility, and performance

Status: in progress. System reduced-motion detection exists. F4.4 proves restoration after WebGL loss; F4.5 stops the loop for native/document hiding, power suspension, and WebGL unavailability and adds bounded fresh-renderer retry. F3d.1 replaces display-refresh polling with a timer/RAF scheduler: calm state loops target 20 FPS, while every autonomous program, explicit cue, preview, thinking, working, approval, and speaking state remains 60 FPS. A native desired-visibility watchdog now recovers unexpected hide/minimize without reversing deliberate Hide or suspend; display changes are reconciled after a bounded debounce. Packaged Windows proves visibility/focus recovery and idle/hidden/recovered lifecycle continuity. Whole-app visible idle improved from 4.107% to 3.103% but still narrowly misses the `<3%` target; hidden CPU averaged 0.081%. Forced-colors and increased-contrast CSS are implemented. External full-screen observation, manual assistive-technology, physical display/virtual-desktop matrices, broader reference hardware, and macOS remain open.

F3d.2 implements immutable per-avatar motion-profile admission. The three free revisions and paid-pilot revision carry the profile identity into the renderer; a clean packaged six-switch Windows run committed every free-avatar activation with verified model/cache state and no exercise error. Profile drift, required-bone failure, unknown identity, unreviewed policy and root-motion violations are bounded failures. Evidence: `docs/verification/F3D2-ANIMATION-PROFILE-ADMISSION-2026-08-26.md`.

- Retain the implemented two-axis policy through accessibility and lifecycle validation: Still/Quiet/Balanced/Lively/Custom Energy plus Full/Follow Windows/Reduced Movement. Both are main-owned and persisted; Full is the product default and Follow Windows remains an explicit accessible choice.
- Suspend rendering when hidden or Chromium-reported occluded; add explicit full-screen suppression policy.
- Recover from WebGL loss and avatar replacement without leaking GPU resources. Restoration and terminal retry pass; one longer reference-device plateau is recorded, while broader hardware and visible-idle optimization remain.
- Complete keyboard, screen-reader, contrast, scaling, idle CPU, active CPU, and memory evidence.
- Run the packaged state matrix on reference Windows and macOS systems.

## Parallel lanes

### Asset completion

- Complete packaged visual admission for every profile-enabled state/program on the final product VRM 1.0 revision; catalog-only Quaternius clips stay non-runnable until separately profiled and reviewed.
- Add reviewed binary VRM 0.x and 1.0 fixtures across representative proportions.
- Persist exact-byte provenance beside bounded cached assets and verify it on every read.
- Add action, conversational gesture, blink, look-at, expression, and optional viseme layers only through the established motion ownership rules.

This lane does not block F3c because deterministic procedural state fallbacks already exist. It blocks the final expressive-runtime and Store provenance exits.

### F4 marketplace foundation

Status: motion personality, three real free admitted revisions, exact model/thumbnail provenance, content-addressed cache, transactional activation/rollback, saved selection, and the first-class Companions route are implemented. All three activate and restore from verified cache in packaged Windows; bounded eviction/detail preview, user-facing removal, corrupt-cache repair, and 20/40/80-switch matrices are proved. The external Seed-san fixture now closes real VRM 1.0 engineering compatibility, but it is not a marketplace offer and does not satisfy the three-free CC0 product portfolio. A product-suitable CC0 VRM 1.0 revision, signed production catalog, macOS, and final reference-device performance remain open.

- Add user-facing `Paused`, `Quiet`, `Balanced`, `Lively`, and category-based `Custom` motion policy without exposing clip filenames.
- Define strict admitted-avatar revision and signed presentation-catalog contracts; the upstream Open Source Avatars registry remains untrusted candidate input.
- Use real binary evidence to select three CC0 free companions across representative style/VRM/performance classes.
- Add content-addressed cache/provenance, isolated preview, transactional activation, restart/offline recovery, and disposal tests.
- Build the first-class Companions route with a `free` entitlement provider only. Locked/checkout states may be test fixtures only when unmistakably marked development simulation.

This is the smallest credible next product slice. It deliberately contains no wallet, blockchain SDK, mainnet dependency, or premium claim. Its contracts are in `docs/AVATAR-MARKETPLACE.md`.

### F4x commerce and entitlement lane

- Start only after the payment-free marketplace is reliable and the owner/legal gate is assigned.
- Build durable products/offers/orders/payment attempts/append-only entitlement events, restore/refund/support paths, strict short-lived JWT access, JWKS rotation, and bounded offline lease before a payment adapter.
- Add x402 v2/Base Sepolia exact-USDC conformance, then a capped direct-build mainnet pilot after facilitator/merchant/tax/incident review.
- Add Solana only after Base operations prove demand and reliability; add StoreKit/Microsoft providers per the release-profile matrix.
- Keep provider-neutral agent catalog discovery separate from gateway transports. An agent may prepare checkout, but a trusted local human surface authorizes every payment.

Status: F4x.1a–c now provide strict commerce contracts and transactional conformance plus the hosted API/repository boundary, rotating Ed25519 JWKS, OS-encrypted refresh rotation, PKCE/idempotent clean-device recovery, signed bounded offline lease, pinned offline verification key, trusted-time checks, and reconciliation-before-persist. F4x.2a–d pin the provider-disabled Base Sepolia x402 v2 exact/EIP-3009 boundary and secure browser handoff. F4x.2e.1–e.4 deploy the isolated Netlify/Supabase boundary, private schema/runtime role, SSL/CA enforcement, multi-instance dispatch exclusion, Supabase-subject identity, transactional free grants, authenticated identity/quote/checkout/recovery routes, digest-only rotation, shared rate limits, operations, verified encrypted restore and monitoring, exact CC0 Toothpaste admission, and independent three-confirmation Base observation. F4x.2e.5 live-proves a real Supabase app-user/password grant, Desky identity and refresh rotation, owner merchant binding, `/readyz`, exact quote/rejection, non-funded checkout approval/replay/tamper/cancel, atomic order closure, empty operations queue, and post-mutation restore. F4x.2e.6 live-proves the real DPAPI-bound Firefox handoff and authoritative no-action expiry, plus exact timestamp preservation, crash-safe operator rotation, sanitized correlation diagnostics, and bounded orphan-order expiry. F4x.2e.7 completes the first funded 0.10 test-USDC purchase: human MetaMask approval, exact on-chain transfer, independent observer closure, atomic Toothpaste grant, multi-catalog access authorization, original-session refresh, one-time clean-device restore, fresh-process refresh and post-grant backup restore. F4x.2e.8 deploys an explicit connect-review-sign state machine, connected-account continuity check, exact official test-USDC balance preflight, non-retryable terminal states, and bounded rejection/insufficient-funds messaging. A manual live rejection capture remains optional evidence; production operations still require redundant authenticated RPC/paging, off-device key escrow, custody/legal/tax/refund gates, and a separately reviewed release profile.

Microsoft Store launches free-only by default. Its later x402 gate follows `docs/research/MICROSOFT-STORE-X402-POLICY-2026-08-24.md`; direct Windows remains the first candidate pilot.

Windows distribution uses two explicit channels: Store MSIX and a signed website download. Store commerce can be added later only through a new certified package/metadata submission and controlled rollout. It is never activated remotely in the already-certified free artifact. A baked fail-closed release manifest must replace the development environment-variable profile before any paid provider is admitted.

F4x must not block the free companion or adapter platform. Its complete contract and failure matrix are in `docs/COMMERCE-ENTITLEMENTS.md`.

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
- Add Hermes through its authenticated structured API Server, then Claude through the supported Agent SDK; terminal scraping is not acceptable.

F5a may begin after F3c.1. It must finish before the second production adapter and before F4 connection management is considered final.

Implementation status — 2026-08-24:

- **F5a.1 platform extraction complete:** executable descriptor/state/command/bridge contracts, main-process runtime interface, active-runtime registry, generic IPC/preload bridge, and generic renderer state/session/turn consumption.
- **F5a.1 OpenClaw conformance complete:** exact OpenClaw configuration validation and state mapping sit behind `OpenClawRuntime`; the proven host retains streaming, tools, approvals, cancellation, reconnect, sessions, pairing, secure vault, and typed-action behavior unchanged.
- **F5a.1 isolation complete:** inactive runtime state/events/actions are rejected by the registry; descriptors are defensively cloned; renderer-facing errors retain provider redaction; Simulation remains isolated from production conformance.
- **F5a.2 complete:** supervised stdio JSONL, direct-only production descriptor, main-owned executable discovery, exact CLI/schema admission, reviewed environment allowlist, opaque workspace grants, bounded reconnect, shell-free process-tree teardown and awaited shutdown are implemented. Typed actions remain truthfully unsupported because client-local `dynamicTools` is experimental. Direct packages structurally construct Codex and OpenClaw behind an explicit provider picker; Store packages construct OpenClaw only. The authenticated source matrix and packaged Windows Control Center both pass real streaming, allow/deny approvals, actual tool-process cancellation, same-session recovery and reconnect. The packaged filesystem oracle proves exact allowed bytes and absence of denied/cancelled writes.
- **F5a.3 contract freeze complete:** Adapter Contract v1 invariants now fail closed across OpenClaw and Codex; the internal platform is stable enough to admit substantially different runtimes without provider assumptions leaking into renderer state.
- **F5b.1-F5b.4 Windows direct admission complete:** the pinned Hermes `0.20.5` API Server passes bearer admission, disposable sessions, OAuth-backed `gpt-5.4` streaming, terminal dedupe, guarded-command approval denial/allow-once, Stop during actual execution, passive and active recovery without replay, and a real installed gateway restart. Exact-endpoint OS-encrypted credential enrollment/reuse/rotation/removal fixtures pass. A fresh packaged Control Center profile and a second process using saved access both pass real streaming; the bearer is absent from renderer text and the on-disk vault contains ciphertext only. Hermes is now registered `production: true` in direct builds and is structurally uninstantiated in Store builds. Remote TLS, typed actions, and macOS remain explicit follow-up gates.
- **F5b.5 transport/action disposition complete:** pinned source confirms the Hermes listener has no native TLS context, so remote use requires operator-owned HTTPS termination; Desky retains its remote-HTTPS-only rule, platform certificate validation, and terminal safe classification for certificate failures. Hermes has stable read-only capability/toolset discovery and separately configured MCP tools, but no API client-local action registration surface. Typed Desky actions remain truthfully unsupported pending a signed and authenticated MCP/helper subsystem. A real remote deployment and macOS package/Keychain matrix remain operational gates.
- **F5b.6 one-app action decision complete:** Codex and Hermes core adapters do not depend on typed avatar actions, so Desky will not build or require a separately installed MCP helper now. If stable native client-tool registration does not arrive and product evidence later justifies the feature, the only admissible fallback is a signed, authenticated, automatically managed sidecar within the single Desky direct installation; Store profiles require separate review. No prompt or workspace-instruction editing substitutes for typed discovery.
- **F5b.7 remote transport-security contract complete:** OpenClaw WSS and Hermes HTTPS share a fail-closed terminal classifier for certificate trust, name, validity, and handshake failures. Strict WebSocket options, malformed/binary-frame closure, reconnect suppression, a streaming-safe Caddy ingress reference, unit fixtures, and a real untrusted-certificate socket matrix pass. A trusted operator-owned public deployment, full authenticated lifecycle through that ingress, and macOS remain external evidence.
- **F5c.1 Claude foundation complete:** the exact supported Agent SDK is integrated behind the same contract but remains unregistered pending an authorized API-key source/package matrix and its lifecycle/security gates. Neither Hermes nor Claude may scrape terminal presentation text.
- **F5c.2 offline custody/policy gate complete:** the Claude candidate now admits only the exact bundled CLI, requested workspace and permission policy, API-key auth source, and an empty strict MCP topology. Provider-specific OS-encrypted credential reuse and post-success enrollment/rotation/removal are transactional. No authorized Anthropic API key is present locally, so authenticated source/package promotion remains an explicit external credential gate rather than simulated evidence.
- **F6a.1 immutable release profiles complete:** a schema-v1 manifest is embedded at build time and validated at startup. Windows Store-free and direct package commands reject unknown/platform-mismatched profiles and post-package ASAR policy proves Store-free excludes local adapter execution and all current commerce signatures, while direct retains admitted Codex/Hermes and excludes unadmitted Claude. All admitted release profiles keep commerce disabled; a future Store third-party-commerce profile requires new reviewed source and certification.
- **F6a.2 Windows release-engineering gate complete:** profile-aware MSIX and Squirrel makers, exact identity/signing admission, official platform assets, independent manifest/ASAR/signature verification, committed byte budgets, CycloneDX 1.6 SBOM, notices, production audit, hashes and non-SLSA build evidence are executable. The reference machine passes real MSIX install/update/launch/uninstall and direct install/launch/uninstall. Production Store identity/signing, production direct signing and a hosted signed direct update remain owner/external gates.

### F5d voice interaction

F5d is deliberately split so microphone input cannot silently become a broad always-on or provider-specific audio architecture.

- **F5d.1 streaming dictation foundation implemented:** `AgentAdapterCapabilities` now admits a provider-neutral voice-input claim. OpenClaw enables it only after negotiating the three transcription Talk methods and event channel. A user-gesture renderer capture converts exact 8 kHz mono input to bounded G.711 mu-law chunks; main owns the remote session, owner identity, provider event filtering and cleanup. Partial/final text updates the shared draft but is never automatically sent. Electron permissions deny every non-audio, non-main-frame, or foreign-origin request. Direct packages may expose the control; the initial Store profile fails it closed pending an explicit microphone manifest and certification evidence.
- **F5d.1 foundation evidence:** `docs/verification/F5D1-VOICE-INPUT-FOUNDATION-2026-08-31.md` records the source basis, capability and permission contracts, failure cleanup, full automated suite, production audit, and verified Windows-direct package.
- **F5d.1 live status:** the packaged reference-device microphone-allow path reaches the authenticated OpenClaw session boundary. The current Cosy-first auth order is persisted in the agent database and the authenticated Gateway is healthy. The current Gateway has OAuth but no transcription API-key profile, so it returns no registered transcription provider. Deskiii now downgrades this to `setup-required` instead of repeatedly advertising readiness. A prolonged-outage regression also bounds normalized reconnect attempts and resets the retry budget on explicit Connect. A configured credential is still required to record permission deny, partial/final, cancellation, backlog/error, disconnect, surface destruction, edit-before-send and fresh-install behavior.
- **F5d.2 realtime foundation implemented:** a separate provider-neutral full-duplex contract now negotiates OpenClaw `realtime` + `gateway-relay` + `agent-consult`, mono PCM16/G.711 formats, transcript/audio/clear/mark/error events, and truthful barge-in support. Main owns the exact session and one renderer owner; registry/IPC enforce global dictation/realtime exclusion and creating-adapter cleanup. Renderer capture and playback queues are bounded, cancellation is turn-scoped, audible mark timing is preserved, and actual scheduled output drives the speaking state.
- **F5d.2 interaction closure implemented:** entering voice replaces the text composer in both ambient and Control Center surfaces with a dedicated Listening/Thinking/Speaking dock, state activity, contextual Interrupt, End and Escape. Assistant voice text uses the existing bounded auto-dismiss bubble. Voice mode does not expose a disabled Send field or imply simultaneous text ownership.
- **F5d.2 live status:** current official OpenClaw and Codex `2026.8.1` packages are installed. On 2026-08-31 the reference Gateway was switched from the operator-reported exhausted Runner Courage account to a freshly authenticated `cosychiruka@gmail.com` profile, which is now explicitly first in the agent-specific order. The stable local Gateway is healthy on the saved Deskiii endpoint. `talk.catalog` advertises `gpt-live-1-codex`, the separate GPT-Live Codex V3 voice set, Gateway relay, agent consultation, PCM16/G.711, and barge-in. Replacing stale GA voice `cedar` with GPT-Live voice `spruce` resolves the earlier overloaded 403; a real session admits with PCM16 24 kHz after the account switch. No microphone or assistant audio was sent by the bounded CLI probe.
- **F5d.3 next:** record the real packaged microphone allow/deny, user/assistant transcript, audible output, Interrupt during output, clear/mark ordering, provider disconnect and same-session recovery matrix. Then add reviewed input/output-device selection and measured audio-driven expression/viseme truth. Direct Hermes/Codex/Claude adapters remain voice-unsupported; any of those models used as the agent behind OpenClaw Talk still consume the single normalized OpenClaw speech plane. Do not add wake words/background listening without a separate privacy/lifecycle gate.

## Store and owner gates

Store submission remains downstream of engineering and owner-controlled inputs:

- select the Desky source-code licence;
- establish publisher legal identity and Apple/Microsoft accounts;
- choose avatar offers/prices, tax/merchant/refund/account policy, hosted-relay policy, NFT-origin source-catalog policy, and supported OS versions;
- choose merchant wallet custody, production facilitator, selling regions, and whether Mac App Store is free-only or StoreKit-enabled;
- provide privacy, support, and security-contact URLs;
- provide production identities/credentials and promote the verified Windows makers into protected signing jobs; create the Mac signing/notarization and App Store pipelines;
- resolve the Electron Forge development-tool advisory chain without applying npm's incompatible forced downgrade;
- complete legal review of generated notices, store metadata, screenshots, review notes, and clean-machine production-signed install/update/uninstall evidence.

## Definition of done for the current sequence

The current product sequence is complete only when Desky opens as an unobtrusive companion, connects through a replaceable adapter boundary, truthfully displays every active state and permission, remains controllable and accessible, passes representative packaged performance/lifecycle tests, and can be signed from provenance-complete release inputs.
