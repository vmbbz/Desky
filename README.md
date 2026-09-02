# Deskii

**Deskii** is a proprietary desktop companion application that gives the AI agent you already use a visible, expressive 3D presence on Windows and macOS. Developed and published by **XEON Protocol (Pty) Ltd**.

> © 2026 XEON Protocol (Pty) Ltd. All rights reserved.  
> Source code is provided in this repository for review and audit purposes only. It is **not** open source. See [`LICENSE.md`](./LICENSE.md) for full terms. Unauthorised copying, distribution, or creation of derivative works is prohibited.

```text
Agent Runtime (OpenClaw / Codex / Hermes / Claude)
                    │
                    ▼
     [ Agent Adapter Layer (IPC Isolated) ]
                    │
                    ▼
     [ Deskii Event Protocol & State Machine ]
                    │
                    ▼
     [ 3D Avatar Engine & Desktop Companion Surface ]
```

---

## Key Features

- 🧠 **Bring Your Own Agent (Runtime Neutral)** — Connect OpenClaw, Codex, Hermes, or Claude. Deskii provides the ambient desktop experience without locking you into a specific AI provider.
- 🎙️ **Conversational Voice Engine** — Natural full-duplex voice input and speech output, streaming live transcripts, viseme lip-sync, and audio cancellation (barge-in).
- 🎭 **Expressive 3D VRM Avatars** — Full VRM 0.x and 1.0 avatar support featuring Milk and custom avatars, state-driven motion arbitration (Quaternius & Mixamo animations), procedural poses, and autonomous ambient cadences.
- 🪟 **Ambient Desktop Presence** — Transparent, frameless, draggable, and resizable window positioning that rests at the edge of your screen. Includes click-through pass-through, tray recovery, and display arrangement clamping.
- 🔒 **Interactive Tool Approval Safety Gate** — Human-in-the-loop verification. Review and approve or deny agent file access, shell commands, or network requests in real time.
- 🛡️ **Zero-Trust Credential Security** — API keys, bearer tokens, and gateway secrets are isolated within Electron's main process and encrypted via OS-level secure storage. The renderer never touches raw secrets.

---

## Supported Agent Runtimes

Deskii normalizes events across multiple agent runtimes into a unified companion state machine (`disconnected`, `idle`, `listening`, `thinking`, `working`, `approval`, `speaking`, `success`, `error`):

| Runtime | Integration Type | Key Capabilities |
|---|---|---|
| **OpenClaw** | Gateway WebSocket (Protocol v4) | Encrypted device pairing, voice streaming, tool execution, remote/local gateways |
| **Codex** | Local App Server / CLI | Workspace grants, local execution policy, shell tool approvals |
| **Hermes** | API Protocol / Vault | Secure token vault, protocol-level state tracking, conversation sessions |
| **Claude** | Agent SDK | CLI executable discovery, agent session streaming, tool authorization |

---

## Connecting Your Agent

Deskii's **Control Center** (accessible via the ⚙ companion menu or system tray) allows you to switch and configure agent adapters on the fly.

### 1. OpenClaw Gateway
- Select **OpenClaw** in the Control Center.
- Enter your Gateway endpoint (`ws://127.0.0.1:18789/` for local, or `wss://` for remote) and security token.
- Approve the device pairing request in OpenClaw if prompted, then select or create a conversation session.

### 2. Codex
- Select **Codex** in the Control Center.
- Point to your local workspace directory and configure execution grant policies.
- Start or resume a session directly from the companion interface.

### 3. Hermes
- Select **Hermes** in the Control Center.
- Input your API credentials into Deskii's encrypted Vault.
- Establish a session and begin chatting or issuing instructions.

### 4. Claude (Agent SDK)
- Select **Claude** in the Control Center.
- Deskii auto-detects the local runtime executable or lets you specify a custom binary path.
- Grant workspace permissions and start interacting.

---

## Repository & System Architecture

For in-depth technical specifications, consult the documentation:

| Document | Description |
|---|---|
| [PRODUCT.md](docs/PRODUCT.md) | Product vision, target users, jobs to be done, and experience model |
| [ADAPTERS.md](docs/ADAPTERS.md) | Universal agent adapter architecture and runtime event normalization |
| [COMPANION-EXPERIENCE.md](docs/COMPANION-EXPERIENCE.md) | Desktop windowing, positioning, interaction bounds, and accessibility |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, main/renderer process isolation, and IPC bridges |
| [ANIMATION-PIPELINE.md](docs/ANIMATION-PIPELINE.md) | 3D VRM 0.x/1.0 loading, FBX clip converter, and motion arbitration |
| [OPENCLAW.md](docs/OPENCLAW.md) | OpenClaw gateway protocol, device auth, and voice integration |
| [SECURITY.md](docs/SECURITY.md) | Process isolation, CSP policy, credential vault, and tool approval gates |
| [ASSETS.md](docs/ASSETS.md) | Avatar provenance, licensing metadata, and asset broker policy |
| [DISTRIBUTION.md](docs/DISTRIBUTION.md) | Release profiles (Microsoft Store free vs direct-download signed) |
| [DELIVERY.md](docs/DELIVERY.md) | Delivery roadmap, verification matrices, and release gates |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | Open-source dependencies and third-party asset licensing notices |

---

## Local Development & Testing

**Prerequisites:** Node.js ≥ 22.0.0, npm ≥ 11.0.0 on Windows 10/11 or macOS.

```powershell
# Install dependencies
npm install

# Start in development mode
npm start
```

### Quality Verification

```powershell
# Run code linter
npm run lint

# Run TypeScript typechecks
npm run typecheck

# Run full test suite (560+ tests)
npm test

# Build release package
npm run package
```

---

## Licence & Terms

Deskii is **proprietary software** owned by **XEON Protocol (Pty) Ltd**.

- Source code in this repository is accessible for security auditing and evaluation only. You may **not** fork, redistribute, sublicense, or build derivative commercial products from this codebase without written permission.
- The compiled application is licensed under the [Deskii End-User Licence Agreement (EULA)](https://deskii.app/terms).
- Third-party open-source libraries incorporated in Deskii remain under their respective licences (see [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)).

Full licence text: [`LICENSE.md`](./LICENSE.md)  
Legal enquiries: [legal@deskii.app](mailto:legal@deskii.app)
