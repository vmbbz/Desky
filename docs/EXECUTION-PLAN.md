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

Status: next implementation round.

- Persist position per display arrangement and clamp to the active work area.
- Add deliberate drag regions without turning ordinary avatar clicks into drags.
- Measure visible avatar/bubble bounds and flip or shift anchored UI at screen edges.
- Implement transparent-region click-through and an explicit full click-through mode.
- Add tray/menu and keyboard escape routes so click-through or hidden state cannot trap the user.
- Verify that event-driven updates never steal application focus.

### F3c.3 — focused companion behavior

Status: queued after F3c.2.

- Reveal and collapse the composer contextually while preserving drafts.
- Keep session selection and runtime setup out of the permanent ambient layout.
- Add concise overflow behavior and an **Open conversation** route for long responses.
- Reconcile approval presentation between the ambient prompt and control center.

### F3d — resilience, accessibility, and performance

Status: queued; system reduced-motion detection already exists.

- Add explicit pause-motion and reduced-motion overrides.
- Suspend rendering when hidden, occluded, or full-screen suppressed.
- Recover from WebGL loss and avatar replacement without leaking GPU resources.
- Complete keyboard, screen-reader, contrast, scaling, idle CPU, active CPU, and memory evidence.
- Run the packaged state matrix on reference Windows and macOS systems.

## Parallel lanes

### Asset completion

- Approve and admit the first animation whose modification and commercial/store redistribution rights are documented.
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

- Promote `AgentAdapter`, `AdapterDescriptor`, capabilities, generic connection state, session state, and commands into executable shared contracts.
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
