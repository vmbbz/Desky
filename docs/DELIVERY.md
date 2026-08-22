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
- Narrow IPC validation and reviewer-safe event redaction.
- Local WebSocket handshake fixture plus host contract fixture for sessions, streaming, approval resolution, cancellation, and reconnect.
- Packaged Windows renderer boot through the secure `desky://` scheme.

Open before F2 exit:

- Install or connect a real current OpenClaw Gateway and record a fresh-session agent turn.
- Verify live exec/plugin allow-once, allow-always where offered, deny, expiry, and duplicate-resolution behavior.
- Interrupt a live turn during thinking, tool use, and response streaming; verify authoritative terminal state after reconnect.
- Verify device pairing and paired-token rotation on a second clean machine profile.
- Connect the Store capability profile to a trusted remote `wss://` gateway and validate certificate failure behavior.
- Run the same live matrix on macOS with Keychain-backed `safeStorage`.

## F3 — expressive avatar runtime

Deliverables:

- Version-aware VRM 0.x/1.0 loader.
- Reproducible animation conversion pipeline.
- Idle/thinking/working/speaking/success/error clips.
- Look-at, blink, expression blending, and optional speech visemes.
- GPU/CPU budgets, occlusion pause, reduced motion, and WebGL recovery.

Exit gate:

- Representative avatar compatibility suite passes.
- No animation asset lacks redistributable provenance.
- Idle and active performance budgets pass on reference machines.

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

1. Complete and verify F1.
2. Build OpenClaw protocol fixtures from the current published schema.
3. Implement secure connection persistence and the first real turn.
4. Establish reference Windows and macOS devices for performance and packaging.
