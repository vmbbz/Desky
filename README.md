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

The repository is in Foundation milestone F1. This round establishes the architecture, distribution strategy, event contract, secure Electron shell, avatar registry integration, and a deterministic simulation harness. No production agent adapter is represented as complete yet.

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
- [Avatar and asset policy](docs/ASSETS.md)
- [Security and privacy model](docs/SECURITY.md)
- [Store and direct distribution](docs/DISTRIBUTION.md)
- [Delivery roadmap and release gates](docs/DELIVERY.md)
- [Architecture decisions](docs/adr/README.md)

## Licensing status

The repository is not yet licensed for redistribution. Selecting the Desky source-code licence is a release-blocking owner decision recorded in the delivery plan. Third-party avatars always retain their own licences; the Open Source Avatars registry licence does not replace per-collection licences.
