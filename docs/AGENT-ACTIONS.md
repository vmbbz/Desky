# Agent action commands

## Decision

Agent-requested avatar behavior uses a typed, provider-neutral command lane. Desky never searches assistant prose, hidden reasoning, prompts, or arbitrary tool summaries for animation names.

The command lane is deliberately separate from `AdapterEvent` state:

```text
agent tool catalog
  -> provider-native structured tool call
  -> adapter validation and normalization
  -> ephemeral AgentActionCommand
  -> typed main/preload IPC
  -> bounded motion cue admission
  -> the existing single body owner
```

State is durable enough to reconcile a newly opened window. An action is not: replaying an old Jump after reconnect or window creation would be wrong. Therefore `AgentActionCommand` is emitted only to live windows and is never added to the revisioned companion snapshot, transcript, settings, or draft store.

## Version 1 contract

The implemented shared command is:

```ts
interface AgentActionCommand {
  protocolVersion: 1;
  commandId: string;
  timestamp: string;
  connectionId: string;
  sessionId: string;
  turnId: string;
  type: "avatar.perform";
  payload: { action: "wave" | "jump" };
}
```

The action vocabulary is intentionally finite. Version 1 does not accept clip IDs, file paths, URLs, durations, amplitudes, arbitrary bone targets, code, or natural-language animation descriptions. New semantic actions require a reviewed schema and a deterministic/reduced-motion implementation before admission.

## Admission and lifecycle

- The adapter accepts only its exact registered integration tool, never a similar tool name.
- A command requires a bounded native tool-call ID plus session and turn identity.
- Main admits only commands for Desky's currently selected session.
- Commands for terminal turns, malformed actions, unknown actions, duplicate tool-call IDs, and other sessions fail closed.
- IPC contains only the normalized action; other native arguments are discarded.
- The renderer labels the cue source as `agent` and submits it to the same bounded priority/FIFO queue used by explicit user actions.
- Approval, cancellation, disconnection, error, reduced motion, queue limits, and the current higher-priority state remain authoritative.
- The tool result says the action was **requested**, not **performed**. A gateway cannot truthfully attest that a local renderer was connected, visible, capable, or allowed to animate.

Wave and Jump are local, reversible visual effects and do not need a reviewer approval. Any future command that reads data, changes files, contacts a service, controls another application, or has another external effect belongs to the runtime's normal tool/approval system instead of this lane.

## OpenClaw integration

OpenClaw receives the tool through the bundled source package at `integrations/openclaw-desky-actions`. The package declares one `defineToolPlugin` tool named `desky_avatar_action`; its TypeBox input schema is the same finite Wave/Jump enum. It also registers the read-scoped `desky.actions.capabilities` Gateway method. Desky queries that method after protocol negotiation and maps the answer into the provider-neutral `AgentAdapterCapabilities` contract. OpenClaw publishes tool-start arguments in the selected session's structured `agent` stream, which the adapter normalizes before IPC.

This requires one operator setup step on the Gateway:

1. install and enable the reviewed Desky Actions plugin;
2. admit it through `plugins.allow` or tool policy when those restrictive lists are configured;
3. restart/reload the Gateway; and
4. verify the runtime tool registration.

It does **not** require users to edit a system prompt, `AGENTS.md`, `CLAUDE.md`, workspace instructions, or each conversation. OpenClaw's tool catalog supplies the name, schema, and model-facing usage description. Optional instructions such as “gesture sparingly” may tune personality, but correctness cannot depend on them.

Desky must not silently change an external Gateway's plugin policy. The control center now reports either **typed Jump and Wave ready** or **Gateway plugin setup required** from negotiated discovery, rather than guessing from generic tool-event support. F4 onboarding must add an explicit, reviewable install path. Store builds may connect to a remote Gateway where only its operator can install the plugin.

## Other runtimes

Each adapter translates the runtime's supported structured extension surface into the same command:

| Runtime | Intended integration | User instruction changes |
| --- | --- | --- |
| OpenClaw | Reviewed tool-only plugin and structured session tool events | No; one-time Gateway plugin/policy setup |
| Direct Codex | Registered app-server/MCP tool when its supported adapter is implemented | No; tool registration is adapter setup |
| Claude | Supported SDK/MCP tool surface when implemented | No; tool registration is adapter setup |
| Hermes | Only after a supported structured tool interface is verified | No text parsing fallback |

If a runtime cannot register or expose structured tools, agent-originated actions remain unavailable for that adapter. Explicit local Wave/Jump controls and state motion continue to work.

### One-app MCP decision

Codex and Hermes do **not** make a Desky MCP helper a prerequisite for ordinary chat, streaming, tools, approvals, cancellation, sessions, or reconnect. Those adapters remain useful without agent-requested avatar gestures, and their current action capability therefore stays truthfully `unsupported`.

“Separate MCP helper” means a separate trust and process boundary required by the provider protocol; it does not have to mean a second product or a manual user installation. If Desky ever admits this topology, the helper must be shipped inside the signed Desky direct-download bundle, installed, configured, supervised, upgraded, and removed by Desky, and presented as one application experience. Users must not be asked to copy configuration, edit prompts, maintain another daemon, or reconcile helper versions. Store profiles need an independent policy review and may remain unsupported.

Desky will **not build that helper now**. Codex's stable MCP surface targets an externally configured server rather than a client-local callback, and Hermes owns MCP configuration process-wide on the gateway host. The extra executable, authentication, routing, lifecycle, signing, containment, and Store-review surface is not justified for Wave/Jump while both adapters otherwise work. This decision is revisited only if either:

1. Codex or Hermes ships a stable native client-local typed-tool registration surface; or
2. product evidence shows agent-requested companion actions are important enough to fund the bundled sidecar and its security/release matrix.

This decision never licenses prompt parsing as a shortcut. No user instruction-file changes are required for Codex or Hermes today because the unavailable action feature is not advertised to their agents.

## Release gates

- OpenClaw plugin manifest, runtime definition, action enum, and Desky parser remain contract-tested for drift.
- Live OpenClaw 2026.8.1 evidence proves capability discovery and a real model-issued Jump through the installed plugin. The separate Wave harness reached the same gateway and passed its pre-model lifecycle matrix on 2026-08-24, but the configured Codex provider rejected the final turn at its subscription limit. Wave remains capacity-deferred rather than falsely marked passed; duplicate, wrong-session, malformed, terminal-turn, and unavailable-client cases remain contract-tested.
- `AgentAdapterCapabilities` is now executable and provider-neutral. F5a still promotes the remaining host, connection, session, and command surfaces out of the OpenClaw-specific bridge.
- Rate limiting, pause-motion controls, occlusion suspension, and packaged Windows/macOS evidence remain required before Store release.
