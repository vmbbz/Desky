<div align="center">

  <img src="branding/logo/desky-lockup-on-dark.svg" alt="Deskii Logo" width="360">

  <h3>The ambient desktop companion for developer AI agents.</h3>

  <p>Stop context-switching to check logs. Deskii gives OpenClaw, Codex, Hermes, and Claude a living 3D presence beside your code.</p>

  <p>
    <a href="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white"><img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
    <a href="https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB"><img src="https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React 19"></a>
    <a href="https://img.shields.io/badge/Electron-47848F?style=for-the-badge&logo=electron&logoColor=white"><img src="https://img.shields.io/badge/Electron-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron"></a>
    <a href="https://img.shields.io/badge/Three.js-000000?style=for-the-badge&logo=three.js&logoColor=white"><img src="https://img.shields.io/badge/Three.js-000000?style=for-the-badge&logo=three.js&logoColor=white" alt="Three.js"></a>
    <a href="https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white"><img src="https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows"></a>
    <a href="https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white"><img src="https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white" alt="macOS"></a>
  </p>

  <p>
    <a href="https://img.shields.io/badge/License-Proprietary-red?style=for-the-badge"><img src="https://img.shields.io/badge/License-Proprietary-red?style=for-the-badge" alt="License"></a>
    <a href="https://img.shields.io/badge/Tests-562%20Passing-brightgreen?style=for-the-badge"><img src="https://img.shields.io/badge/Tests-562%20Passing-brightgreen?style=for-the-badge" alt="Tests"></a>
    <a href="https://deskii.app"><img src="https://img.shields.io/badge/Website-deskii.app-75e6d7?style=for-the-badge" alt="Website"></a>
  </p>

  <br>

  <video src="branding/deskii-demo.mp4" controls width="100%" poster="branding/poster/desky-through-the-screen-x.png" style="border-radius: 14px; box-shadow: 0 20px 50px rgba(0,0,0,0.5);"></video>

  <br><br>

</div>

---

## Why Deskii for Developers

When you run autonomous coding agents, checking their progress shouldn't mean constant tab-switching, terminal polling, or reading raw logs.

**Deskii** sits quietly beside your IDE. It transforms raw agent events—thinking, shell command execution, file modifications, tool approvals, and responses—into an expressive 3D companion state that is readable at a glance.

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

- **Bring your agent** — Connect OpenClaw, Codex, Hermes, or Claude. Deskii acts as the universal desktop client for whichever agent runtime you already use.
- **Voice-first interaction** — Speak naturally and hear replies in real time with live streaming transcripts, speech viseme lip-sync, and instant barge-in controls.
- **Living 3D avatars** — VRM 0.x and 1.0 humanoid avatar rendering (Milk mascot, VRoid models, or custom characters) with state-driven motion arbitration.
- **Ambient desktop presence** — Frameless, transparent, draggable companion that stays out of your code until needed, with click-through support and tray recovery.
- **Instant tool approvals** — One-click interactive safety gate to approve or deny sensitive shell commands, file edits, or network calls right from your desktop.
- **Isolated & secure** — API keys and tokens are strictly isolated in Electron's main process and protected by OS-level credential encryption (`contextIsolation: true`).

---

## Supported Agent Runtimes

Deskii normalizes events across multiple runtimes into a single companion state machine (`disconnected`, `idle`, `listening`, `thinking`, `working`, `approval`, `speaking`, `success`, `error`):

| Runtime | Integration Type | Key Capabilities |
|---|---|---|
| **OpenClaw** | Gateway WebSocket (Protocol v4) | Encrypted device pairing, real-time voice streaming, tool execution, remote/local gateways |
| **Codex** | Local App Server / CLI | Workspace grants, local execution policy, shell tool approvals |
| **Hermes** | API Protocol / Vault | Secure token vault, protocol-level state tracking, session management |
| **Claude** | Agent SDK | CLI executable discovery, agent session streaming, tool authorization |

---

## Roadmap & Creator Ecosystem

Deskii is building towards a creator-first avatar marketplace and agent-native commerce infrastructure:

```text
┌───────────────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐
│   Phase 1: Core Client    │ ───► │  Phase 2: Creator Market  │ ───► │  Phase 3: x402 Commerce   │
│ Multi-Agent + 3D Companion│      │ Avatar & Motion Packs     │      │ Agent-Initiated Rentals   │
└───────────────────────────┘      └───────────────────────────┘      └───────────────────────────┘
```

### 1. Avatar & Motion Marketplace
- **Publish & Monetize:** 3D artists and character designers can upload, sell, or rent custom VRM avatars, outfits, and motion packs.
- **Proven Provenance:** Built-in cryptographic SHA-256 asset provenance and licensing sidecars.

### 2. x402 Agent Commerce & Licensing
- **Autonomous Agent Rentals:** AI agents can programmatically rent specialized avatars or motion packs on demand using **x402 micro-payment rails** on-chain.
- **User Payments:** Manual purchases and rentals via credit cards or Web3 wallets (MetaMask integration with zero private-key exposure).
- **License Proofs:** On-chain verifiable licensing ensuring creators retain rights while users hold authentic asset entitlements.

---

## Development & Setup

**Prerequisites:** Node.js ≥ 22.0.0, npm ≥ 11.0.0 on Windows 10/11 or macOS.

```powershell
# Clone repository
git clone https://github.com/vmbbz/Desky.git
cd Desky

# Install dependencies
npm install

# Start in development mode
npm start
```

### Quality & Verification Matrix

```powershell
# Run code linter
npm run lint

# Run TypeScript typechecks
npm run typecheck

# Run full test suite (562 passing tests)
npm test

# Build production executable package
npm run package
```

---

## Documentation Index

| Document | Description |
|---|---|
| [PRODUCT.md](docs/PRODUCT.md) | Product vision, target users, jobs to be done, and experience model |
| [ADAPTERS.md](docs/ADAPTERS.md) | Universal agent adapter architecture and runtime event normalization |
| [COMPANION-EXPERIENCE.md](docs/COMPANION-EXPERIENCE.md) | Desktop windowing, positioning, interaction bounds, and accessibility |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, main/renderer process isolation, and IPC bridges |
| [AVATAR-MARKETPLACE.md](docs/AVATAR-MARKETPLACE.md) | Avatar marketplace, creator royalties, and licensing specification |
| [COMMERCE-ENTITLEMENTS.md](docs/COMMERCE-ENTITLEMENTS.md) | x402 on-chain payment rails, entitlement validation, and NFTs |
| [ANIMATION-PIPELINE.md](docs/ANIMATION-PIPELINE.md) | 3D VRM 0.x/1.0 loading, FBX clip converter, and motion arbitration |
| [OPENCLAW.md](docs/OPENCLAW.md) | OpenClaw gateway protocol, device auth, and voice integration |
| [SECURITY.md](docs/SECURITY.md) | Process isolation, CSP policy, credential vault, and tool approval gates |
| [ASSETS.md](docs/ASSETS.md) | Avatar provenance, licensing metadata, and asset broker policy |
| [DISTRIBUTION.md](docs/DISTRIBUTION.md) | Release profiles (Microsoft Store free vs direct-download signed) |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | Open-source dependencies and third-party asset licensing notices |

---

## Licence & Rights

Deskii is **proprietary software** owned and published by **XEON Protocol (Pty) Ltd**.

- Source code in this repository is accessible for security auditing and transparency only. You may **not** copy, fork, redistribute, sublicense, or build derivative commercial products without explicit written authorization.
- The compiled application is licensed under the [Deskii End-User Licence Agreement (EULA)](https://deskii.app/terms).
- Third-party open-source libraries incorporated in Deskii retain their respective licences (see [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)).

Full licence text: [`LICENSE.md`](./LICENSE.md)  
Legal & Licensing enquiries: [legal@deskii.app](mailto:legal@deskii.app)
