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

Foundation milestone F1 is complete. F2 now contains the first production OpenClaw adapter slice: protocol-v4 device authentication, encrypted connection persistence, session discovery/creation/selection, chat streaming, tool activity, approvals, cancellation, reconnect, and both fixture and opt-in live Gateway harnesses. Against local OpenClaw 2026.8.1, authentication, capability negotiation, session creation, approval deny/allow-once/duplicate acknowledgement, cancellation, and reconnect/resubscription pass. A successful assistant stream remains unverified because the configured Codex account reached its subscription usage limit; secure remote-gateway and macOS checks also remain release gates.

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
- [System architecture](docs/ARCHITECTURE.md)
- [Agent adapter protocol](docs/ADAPTERS.md)
- [OpenClaw integration and verification](docs/OPENCLAW.md)
- [Avatar and asset policy](docs/ASSETS.md)
- [Security and privacy model](docs/SECURITY.md)
- [Store and direct distribution](docs/DISTRIBUTION.md)
- [Delivery roadmap and release gates](docs/DELIVERY.md)
- [Architecture decisions](docs/adr/README.md)

## Licensing status

The repository is not yet licensed for redistribution. Selecting the Desky source-code licence is a release-blocking owner decision recorded in the delivery plan. Third-party avatars always retain their own licences; the Open Source Avatars registry licence does not replace per-collection licences.
