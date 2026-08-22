# Product definition

## Vision

Desky makes an AI agent feel present without obscuring what it is doing. A compact character lives at the edge of the desktop, communicates the active session's state, accepts short instructions, surfaces approvals, and lets the user open a detailed conversation when needed.

Desky is a client, not a model provider and not an autonomous agent platform. Its durable value is the bridge between heterogeneous agent runtimes and a consistent, expressive desktop experience.

## Core user promise

> Connect the agent you already use. Desky gives it a trustworthy face on your desktop.

## Target users

1. People who already run a coding or general-purpose agent and want ambient progress rather than another full-screen chat window.
2. Users of local or self-hosted gateways who value privacy and provider choice.
3. Character and avatar communities who want useful, licensed desktop embodiments.
4. Teams that need a legible approval surface for long-running agent work.

## Jobs to be done

- Tell whether the agent is idle, listening, reasoning, using a tool, waiting for approval, speaking, complete, or blocked.
- Send a short instruction without changing context to another application.
- Review and approve or deny a sensitive action.
- See a concise result and open the full transcript only when necessary.
- Change character, runtime, and voice independently.
- Understand which service receives data before connecting it.

## Experience model

Desky has two coordinated surfaces:

### Companion surface

- Small, frameless, optionally always-on-top character window.
- Drag to reposition; remembers position per display arrangement.
- Speech bubble for short streamed responses and approval prompts.
- Click-through mode when the user wants an unobtrusive ambient presence.
- Reduced-motion and pause-rendering controls.
- Keyboard-accessible controls and an alternate non-animated status view.

### Control surface

- Standard accessible window for onboarding, connection setup, conversation history, permissions, avatar selection, diagnostics, and updates.
- Never hides security-sensitive details exclusively behind character animation.

## State language

The same normalized states apply to every runtime:

| State | User meaning | Typical expression |
| --- | --- | --- |
| `disconnected` | No runtime is available | asleep/offline |
| `idle` | Ready for input | breathing/looking around |
| `listening` | Input is being captured | attentive |
| `thinking` | The runtime is reasoning | focused |
| `working` | A tool or external action is active | task-specific activity |
| `approval` | The user must decide | clear pause and prompt |
| `speaking` | An answer is streaming | lip-sync or dialogue motion |
| `success` | The turn completed | brief celebration |
| `error` | The turn failed or connection broke | recoverable concern |

Animation never substitutes for text. Status, active tool, and approval scope remain readable.

## Product boundaries

Desky v1 will not:

- Train or host foundation models.
- Execute tools independently of the connected runtime.
- Guarantee that every avatar supports every animation.
- Sell NFTs or provide an NFT marketplace.
- Treat token ownership as a substitute for asset licensing.
- Expose unrestricted local-process control in the Mac App Store build.
- Add a social feed, character economy, or plugin marketplace before the core companion loop is reliable.

## Business and distribution model

The architecture supports a free open-source core and paid convenience without locking agent choice:

- Free core companion and adapter SDK.
- Optional paid character/animation packs with auditable licences.
- Optional hosted relay or synchronization service, never required for local gateways.
- Store purchase for convenience; direct-download builds for advanced local integrations.

Pricing and source licence are owner decisions. They must be settled before public beta and reflected consistently in the app, website, repositories, and store metadata.

## Success measures

Foundation telemetry is opt-in and contains no conversation text. Useful measures are:

- First successful runtime connection.
- Time from install to first completed turn.
- Approval delivery and response latency.
- Crash-free companion hours.
- GPU/CPU usage while idle and working.
- Avatar load success by VRM version and device class.
- Adapter reconnect success.
- Seven-day retained use.

## Quality bar

World-class means:

- Cold launch below three seconds on representative supported hardware.
- Idle CPU near zero when animation is paused or occluded, and a documented idle budget when visible.
- No renderer access to Node.js, credentials, or arbitrary filesystem paths.
- Keyboard and screen-reader access to every required action.
- Graceful degradation when WebGL, a remote avatar, or a gateway is unavailable.
- Deterministic adapter contract tests and versioned event schemas.
- Signed, reproducible release inputs with provenance and licence reports.
