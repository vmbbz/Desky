# Deskii

Deskii is an open-source desktop companion that gives an AI agent a visible, expressive presence on Windows and macOS.

The character is not the agent. Deskii connects to agent runtimes through adapters, normalizes their events, and translates those events into animation, dialogue, approvals, and clear status. Users can change the connected runtime without changing their companion.

```text
Agent runtime -> adapter -> Deskii event protocol -> state machine -> avatar and UI
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

F3a now includes runtime VRM 0.x/1.0 capability inspection, core-humanoid validation, embedded usage-permission conflict checks, SHA-256 avatar provenance, a deterministic offline multi-clip FBX converter, an avatar-neutral canonical clip format, target-VRM runtime binding, and a strict manifest for reviewed animation conversions. The F3b motion runtime maps every normalized state to one deterministic full-body owner, admits only provenance-matching reviewed clips, and otherwise uses restrained procedural poses. Its candidate library contains 84 CC0 Quaternius motions plus the separately licensed, transformed 11.4-second Mixamo Looking Around clip. State bindings, controlled autonomous cadence, and multi-step action/catalog programs live in validated asset metadata rather than animation-name code. Looking Around is the sole idle owner, thinking uses Search/Interact, and speaking uses a hips-locked talk loop; folded arms and the former procedural idle overlay no longer compete. A typed live-only agent-action lane and OpenClaw tool package request Wave/Jump without parsing model text or changing user prompts; capability discovery and a real model-issued Jump now pass against OpenClaw 2026.8.1. The complete inventory is in `docs/ANIMATION-CATALOG.md`. Packaged review of the revised state semantics, a separate live Wave call, representative binary VRM suite, persistent asset sidecars, truthful speech visemes, and the full state/performance matrix remain open.

F3c now provides the actual avatar-first desktop companion: the resting surface is Milk plus a compact launcher, meaningful responses appear in an anchored light bubble, and connection/session management stays in a separate control center. Milk remains continuously alive with the exact Looking Around idle plus a shuffled, cooldown-controlled set of visually admitted ambient motions; connectivity never restores the imported bind pose, and every decorative program yields to meaningful agent state. Dragging rendered avatar geometry rotates the 3D character, while dragging transparent space within its measured bounds or the focused grip moves and persists the clamped native companion. Shift/Alt, scrolling, arrow keys, and Home remain explicit rotation alternatives. Transparent regions outside interaction bounds pass clicks, and tray, shortcut, and control-center recovery protect full click-through. The composer appears only after explicit interaction, `Escape` preserves its session-only shared draft, Stop remains reachable, long responses route to the control center, and a late-opening window recovers the current response or approval from one main-owned snapshot. This focused behavior is package-verified on Windows, including a live OpenClaw assistant stream through `openai/gpt-5.6-sol`. Avatar catalog/model downloads now cross a bounded main-process broker rather than relying on sandboxed renderer CORS.

## Connect OpenClaw

1. Start or identify an OpenClaw Gateway and obtain its configured token or password.
2. Open Deskii's connection sheet and enter `ws://127.0.0.1:18789/` for a local gateway, or a trusted `wss://` URL for a remote gateway.
3. Enter the credential. Deskii passes it directly to its main process and can persist it only through operating-system credential encryption.
4. If OpenClaw requests device pairing, approve the displayed request in OpenClaw and reconnect.
5. Select an existing session or create a new Deskii session, then send a message.

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
- [Third-party asset notices](THIRD_PARTY_NOTICES.md)
- [Security and privacy model](docs/SECURITY.md)
- [Store and direct distribution](docs/DISTRIBUTION.md)
- [Delivery roadmap and release gates](docs/DELIVERY.md)
- [Active execution sequence and dependency map](docs/EXECUTION-PLAN.md)
- [Architecture decisions](docs/adr/README.md)

## Licensing status

The repository is not yet licensed for redistribution. Selecting the Deskii source-code licence is a release-blocking owner decision recorded in the delivery plan. Third-party avatars always retain their own licences; the Open Source Avatars registry licence does not replace per-collection licences.
