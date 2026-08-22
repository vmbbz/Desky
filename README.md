# Desky

Desky is an open-source desktop companion that gives an AI agent a visible, expressive presence on Windows and macOS.

The character is not the agent. Desky connects to agent runtimes through adapters, normalizes their events, and translates those events into animation, dialogue, approvals, and clear status. Users can change the connected runtime without changing their companion.

```text
Agent runtime -> adapter -> Desky event protocol -> state machine -> avatar and UI
```

## Product principles

- **Embodied, not decorative:** animation communicates real agent state.
- **Runtime-neutral:** OpenClaw, Codex, Claude, Hermes, and future runtimes remain replaceable adapters.
- **Local-first:** secrets and conversations stay on-device unless the selected runtime requires a network service.
- **Explicit control:** tool use and approval requests are visible and interruptible.
- **Licensed assets only:** every distributed or downloaded character retains machine-readable provenance and licence metadata.
- **Store honest:** sandboxed Store builds never claim capabilities available only in direct-download builds.

## Current status

Foundation milestone F1 is complete. F2 now contains the first production OpenClaw adapter slice: protocol-v4 device authentication, encrypted connection persistence, session discovery/creation/selection, chat streaming, tool activity, approvals, cancellation, reconnect, and both fixture and opt-in live Gateway harnesses. Against local OpenClaw 2026.8.1, authentication and stale-access recovery, capability negotiation, session creation, approval deny/allow-once/expiry/contention/duplicate acknowledgement, transport-loss recovery, successful assistant streaming, and interruption during a real shell-tool execution pass. A same-session assistant turn after the tool cancellation also passes. Secure remote-gateway and macOS checks remain F2 release gates.

F3a now includes runtime VRM 0.x/1.0 capability inspection, core-humanoid validation, embedded usage-permission conflict checks, SHA-256 avatar provenance, a deterministic offline Mixamo/FBX converter, an avatar-neutral canonical clip format, target-VRM runtime binding, and a strict manifest for reviewed animation conversions. The F3b motion runtime maps every normalized state to one deterministic full-body owner, admits only provenance-matching reviewed clips, and otherwise uses restrained procedural poses. Its first expressive layer adds bounded queued speaking emphasis, nod, explicit Wave/Jump actions, deterministic capability-gated blink/look-at/state expressions, immediate authoritative interruption, and reduced-motion alternatives. A typed live-only agent-action lane and OpenClaw tool package can request Wave/Jump without parsing model text or changing user prompts. The first owner-approved production clip, live plugin evidence, representative binary VRM suite, persistent asset sidecars, truthful speech visemes, and full packaged state/performance matrix remain open.

F3c now provides the actual avatar-first desktop companion: the resting surface is Milk plus a compact launcher, meaningful responses appear in an anchored light bubble, and connection/session management stays in a separate control center. Position is restored and clamped per display arrangement; measured avatar bounds define the deliberate hit target; transparent regions pass clicks; and tray, shortcut, and control-center recovery protect full click-through. The composer appears only after explicit interaction, `Escape` preserves its session-only shared draft, Stop remains reachable, long responses route to the control center, and a late-opening window recovers the current response or approval from one main-owned snapshot. This focused behavior is package-verified on Windows. Avatar catalog/model downloads now cross a bounded main-process broker rather than relying on sandboxed renderer CORS. External clips still require reviewed commercial/store redistribution provenance.

## Connect OpenClaw

1. Start or identify an OpenClaw Gateway and obtain its configured token or password.
2. Open Desky's connection sheet and enter `ws://127.0.0.1:18789/` for a local gateway, or a trusted `wss://` URL for a remote gateway.
3. Enter the credential. Desky passes it directly to its main process and can persist it only through operating-system credential encryption.
4. If OpenClaw requests device pairing, approve the displayed request in OpenClaw and reconnect.
5. Select an existing session or create a new Desky session, then send a message.

Plain `ws://` is rejected outside loopback. See the [OpenClaw integration guide](docs/OPENCLAW.md) for protocol scope, diagnostics, and the remaining live verification procedure.

## Development

Requirements:

- Node.js 22 or newer
- npm 11 or newer
- Windows 10/11 or a currently supported macOS release

```powershell
npm install
npm start
```

Validation:

```powershell
npm run lint
npm run typecheck
npm test
npm run package
```

## Documentation

- [Product definition](docs/PRODUCT.md)
- [Desktop companion experience and motion specification](docs/COMPANION-EXPERIENCE.md)
- [Animation conversion pipeline](docs/ANIMATION-PIPELINE.md)
- [System architecture](docs/ARCHITECTURE.md)
- [Agent adapter protocol](docs/ADAPTERS.md)
- [OpenClaw integration and verification](docs/OPENCLAW.md)
- [Avatar and asset policy](docs/ASSETS.md)
- [Security and privacy model](docs/SECURITY.md)
- [Store and direct distribution](docs/DISTRIBUTION.md)
- [Delivery roadmap and release gates](docs/DELIVERY.md)
- [Active execution sequence and dependency map](docs/EXECUTION-PLAN.md)
- [Architecture decisions](docs/adr/README.md)

## Licensing status

The repository is not yet licensed for redistribution. Selecting the Desky source-code licence is a release-blocking owner decision recorded in the delivery plan. Third-party avatars always retain their own licences; the Open Source Avatars registry licence does not replace per-collection licences.
