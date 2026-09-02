# Deskii

**Deskii** is a proprietary desktop companion that gives the AI agent you already use a visible, expressive presence on Windows and macOS. It is developed and published by **XEON Protocol (Pty) Ltd**.

> © 2026 XEON Protocol (Pty) Ltd. All rights reserved.  
> This repository is source-available for review purposes. It is **not** open source. See [`LICENSE.md`](./LICENSE.md) for the full terms. Unauthorised copying, forking, or redistribution is prohibited.

```text
Agent runtime → adapter → Deskii event protocol → state machine → avatar and UI
```

## Product principles

- **Embodied, not decorative** — animation communicates real agent state, not decoration.
- **Runtime-neutral** — OpenClaw, Codex, Claude, Hermes, and future runtimes are replaceable adapters.
- **Local-first** — secrets and conversations stay on-device unless the selected runtime requires a network service.
- **Explicit control** — tool use and approval requests are always visible and interruptible.
- **Licensed assets only** — every distributed or downloaded character retains machine-readable provenance and licence metadata.
- **Store honest** — sandboxed Store builds never claim capabilities available only in direct-download builds.

## Current status

F1–F3c are complete. The app ships a production OpenClaw adapter (protocol-v4 auth, encrypted persistence, session management, chat streaming, tool activity, approvals, cancellation, reconnect), a full motion runtime (VRM 0.x/1.0, CC0 Quaternius clips, Mixamo Looking Around, autonomous ambient cadence, multi-step action programs), and the desktop companion experience (Milk avatar, anchored chat bubble, control center, draggable/resizable window, click-through, tray recovery).

Voice conversations are implemented with full-duplex audio, live transcript, and streaming reply display.

The Windows release is packaged and pending Microsoft Store submission.

## Connect an agent

### OpenClaw

1. Start an OpenClaw Gateway and obtain its token.
2. Open Deskii's Control Center and enter `ws://127.0.0.1:18789/` for a local gateway, or a trusted `wss://` URL for a remote gateway.
3. Enter the credential — it is passed directly to the main process and persisted only through OS-level encryption.
4. Approve any device-pairing prompt in OpenClaw, then reconnect.
5. Select or create a session and start a conversation.

Plain `ws://` is rejected outside loopback. See [docs/OPENCLAW.md](docs/OPENCLAW.md) for protocol scope and diagnostics.

## Development

**Requirements:** Node.js ≥ 22, npm ≥ 11, Windows 10/11 or a currently supported macOS release.

```powershell
npm install
npm start
```

**Validation:**

```powershell
npm run lint
npm run typecheck
npm test
npm run package
```

## Documentation

| Document | Description |
|---|---|
| [PRODUCT.md](docs/PRODUCT.md) | Product definition and goals |
| [COMPANION-EXPERIENCE.md](docs/COMPANION-EXPERIENCE.md) | Desktop companion and motion specification |
| [ANIMATION-PIPELINE.md](docs/ANIMATION-PIPELINE.md) | Animation conversion pipeline |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture |
| [ADAPTERS.md](docs/ADAPTERS.md) | Agent adapter protocol |
| [OPENCLAW.md](docs/OPENCLAW.md) | OpenClaw integration and verification |
| [ASSETS.md](docs/ASSETS.md) | Avatar and asset policy |
| [SECURITY.md](docs/SECURITY.md) | Security and privacy model |
| [DISTRIBUTION.md](docs/DISTRIBUTION.md) | Store and direct distribution |
| [DELIVERY.md](docs/DELIVERY.md) | Roadmap and release gates |
| [EXECUTION-PLAN.md](docs/EXECUTION-PLAN.md) | Active execution sequence |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | Third-party component licences |

## Licence

Deskii is **proprietary software**. Source code is available in this repository for transparency and review only.

- You may **not** copy, fork, redistribute, or build upon this source without written permission from XEON Protocol (Pty) Ltd.
- Third-party open-source components used by Deskii retain their own licences — see [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
- The compiled application may be used under the [End-User Licence Agreement](https://deskii.app/terms) published at deskii.app.

Full licence terms: [`LICENSE.md`](./LICENSE.md)  
Legal enquiries: legal@deskii.app
