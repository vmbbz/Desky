# Agent adapter protocol

## Purpose

Adapters translate a runtime's native protocol into Desky events and commands. They do not select animations, manipulate UI, or silently grant permissions.

The initial protocol is internal while semantics stabilize. A public adapter SDK begins only after two substantially different production adapters pass the same contract suite.

The provider-neutral platform is executable in `src/shared/agent-adapter.ts`, `src/main/adapters/runtime.ts`, and `src/main/adapters/registry.ts`. It owns safe descriptors, connection/session state, lifecycle commands, normalized events, and the separate typed agent-action lane. `AgentAdapterCapabilities` records sessions, streaming, tools, approvals, cancellation, reconnect, and typed agent-action availability. OpenClaw discovers its Desky action tool through a read-scoped plugin method; later runtimes must translate their supported native discovery surfaces into the same shape. Generic tool streaming alone never implies that the Desky action schema is installed.

## Adapter lifecycle

```ts
interface AgentAdapterRuntime {
  readonly descriptor: AdapterDescriptor;
  getState(): AdapterConnectionState;
  connect(configuration: unknown): Promise<AdapterConnectionState>;
  send(message: string): Promise<void>;
  cancel(): Promise<void>;
  resolveApproval(input: AdapterResolveApprovalInput): Promise<void>;
  disconnect(): Promise<AdapterConnectionState>;
  onEvent(listener: (event: AdapterEvent) => void): () => void;
  onAction(listener: (command: AgentActionCommand) => void): () => void;
}
```

An adapter instance owns one connection. It may expose multiple remote sessions, but concurrent turn semantics must be explicit in its descriptor. The renderer bridge uses a generic `{ adapterId, configuration }` connection envelope; the selected main-process runtime alone validates the opaque provider configuration. This keeps credentials and future authentication shapes out of a misleading lowest-common-denominator contract.

`AgentAdapterRegistry` is the single provider-aware dependency of IPC. It enumerates cloned safe descriptors, including explicit direct/Store release-profile availability, session-selection semantics, and turn concurrency, selects one active runtime, disconnects before switching, routes the full command surface, and forwards state/events/actions only from the active runtime. Provider-native frames and native state names never cross preload. The current renderer-local Simulation harness remains deliberately outside this production registry.

## Event envelope

Every event includes:

- `protocolVersion`: Desky protocol version.
- `eventId`: unique within the connection.
- `timestamp`: source time when reliable, otherwise adapter receipt time.
- `connectionId`: local connection identity.
- `sessionId`: runtime session identity when available.
- `turnId`: runtime or adapter-generated turn identity when relevant.
- `type`: discriminant.
- `payload`: type-specific, JSON-serializable data.

Initial semantic events:

| Type | Required meaning |
| --- | --- |
| `connection.ready` | authenticated and able to accept input |
| `connection.closed` | intentionally or unexpectedly unavailable |
| `user.input.accepted` | runtime accepted an input |
| `agent.thinking` | reasoning is active; never expose private chain-of-thought |
| `assistant.delta` | user-visible response fragment |
| `tool.started` | a named tool invocation began |
| `tool.progress` | bounded, user-safe progress update |
| `tool.completed` | tool returned successfully |
| `approval.requested` | runtime is blocked on an explicit user decision |
| `approval.resolved` | runtime recorded an allowed, denied, expired, or cancelled approval terminal state |
| `turn.completed` | terminal success for a turn |
| `turn.failed` | terminal non-success with a safe error and optional `error`/`cancelled` kind |

## Command semantics

- `send` accepts text initially; attachments require an explicit capability.
- `cancel` is idempotent. A runtime that cannot cancel must report that capability as false.
- `resolveApproval` is idempotent by request ID and fails closed for unknown or expired requests.
- No adapter interprets natural-language text as an approval.
- Every terminal approval clears only the matching pending request; late or duplicate terminal events are idempotent.
- Disconnect waits for safe teardown but has a bounded timeout.

### Ephemeral agent actions

Agent-requested companion behavior is a second, provider-neutral structured command lane, not an `AdapterEvent` and not a state mutation. Version 1 admits only `avatar.perform` with `wave` or `jump`. It carries connection, selected-session, turn, and deduplication identity; it is delivered to live renderers and never replayed from the companion snapshot or inferred from model text.

Adapters may expose this only when their runtime provides a registered structured tool/capability. Provider-native tool arguments are reduced to the finite semantic action before IPC. Unsupported runtimes keep explicit local actions and state animation but report agent actions unavailable. Full rules and integration requirements are in `docs/AGENT-ACTIONS.md`.

## Normalization rules

- Runtime status names never pass directly into renderer logic.
- Private reasoning content is discarded; only a boolean/status signal becomes `agent.thinking`.
- Tool arguments are redacted according to adapter policy before crossing into the renderer.
- Paths default to basename or workspace-relative form.
- Tokens, authorization headers, environment values, and raw subprocess commands never enter event payloads.
- Unknown native events are logged as redacted diagnostics and ignored until mapped deliberately.
- A `turn.completed` or `turn.failed` event is emitted exactly once per accepted turn.
- Native aborts and acknowledged user cancellation set `turn.failed.payload.kind` to `cancelled`; missing or `error` kinds fail closed to the recoverable error state for backward compatibility.

## Planned adapters

### OpenClaw — first production adapter

- Transport: authenticated WebSocket Gateway protocol.
- Compatibility: protocol v4 pinned to official source revision `66c0a23a063908fa5d83d344cebff171c7dea832`; see ADR 0003.
- Package status: the recommended npm packages currently publish placeholder-only `0.0.0` tarballs, so the temporary internal wire client is isolated for later replacement.
- Distribution: Store and direct profiles.
- Why first: broad agent semantics, sessions, approvals, and an explicit control-plane protocol.
- Gate: handshake/version negotiation, reconnect, approval, cancellation, and transcript redaction tests.

### Codex

- Direct transport: supervised `codex app-server` JSONL over stdio.
- Possible remote transport: secure app-server endpoint only when the upstream WebSocket surface is production-supported.
- Distribution: direct profile initially; Store profile through a separately hosted/remote service if supported.
- Gate: version-generated schemas, thread/turn lifecycle, approval semantics, cancellation, and sandbox disclosure.
- Current foundation: a bounded JSONL JSON-RPC peer owns initialization, correlation, notifications, server requests, timeouts, stderr bounds/redaction, malformed/oversized-frame failure, and process teardown. Main-owned PATH discovery accepts only a real absolute executable with the expected `codex` filename, launches with a reviewed environment allowlist, and admits only the exact locally generated schema baseline.
- Current protocol evidence: `npm run codex:schema:verify` discovers the exact admitted CLI, generates its non-experimental JSON Schema set inside an isolated temporary `CODEX_HOME`, recursively canonicalizes JSON object keys, and verifies a committed 273-file SHA-256 baseline plus the individual schemas Desky consumes. The generated 2.8 MB payload is deleted and never committed or shipped. `npm run codex:schema:refresh` is an explicit, review-required baseline refresh for a deliberately edited admitted version.
- Runtime status: the unregistered `CodexRuntime` passes fixtures for validated initialization/account state, bounded thread list/start/resume, active turns, assistant streaming, paired redacted tools, command/file approvals, cancellation, exactly-one terminal events, disconnect, unexpected process exit, and malformed-consumed-notification shutdown. Safe projection validators cover every native field used for a Desky state transition; unknown unconsumed notifications remain ignored. A live installed-CLI smoke passed initialization, account read, and thread listing without starting a model turn. It remains `production: false`, unregistered, and reconnect/action unavailable.
- Remaining admission sequence: approved workspace picker and sandbox disclosure; restart/reconnect; typed actions only through a supported stable tool surface; direct-profile UI; packaged authenticated model/tool/approval/cancellation matrix. WebSocket is excluded because the official current surface labels it experimental and unsupported for production.

### Claude

- Direct transport candidate: supported SDK or structured stream output, never terminal scraping.
- Store transport: authenticated remote API/gateway subject to product terms and secure credential handling.
- Gate: supported authentication, stable streaming schema, approvals, cancellation, and permission-mode mapping.

### Hermes

- Transport remains a discovery item until its current supported programmatic interface is inspected.
- No terminal text scraping will be accepted as a production integration.

## Contract tests

Every adapter must pass fixtures for:

1. successful connection and clean disconnect;
2. authentication failure without token leakage;
3. text streaming order;
4. tool start/completion pairing;
5. approval allow, deny, expiration, and duplicate response;
6. cancellation during thinking, tool use, and streaming;
7. disconnect/reconnect during an active turn;
8. malformed and unknown native events;
9. exactly one terminal event;
10. bounded queues and backpressure.
11. typed agent-action admission, duplicate/wrong-session rejection, and no replay after reconnect.

The simulation adapter is a UI/state-machine harness only. It is always labeled `Simulation`, never persisted as a production connection, and cannot satisfy an integration milestone.

## Adapter-platform extraction timing

OpenClaw is the first production conformance runtime behind the generic platform, not the application-level bridge. `OpenClawRuntime` validates its exact token/password payload, maps native gateway/session/run names into the shared state, preserves redaction, and delegates transport behavior to the already-proven `OpenClawAdapterHost`. The renderer and preload expose only `desky.adapters` over `desky:adapter:*` channels. Codex is the next substantially different adapter; the public adapter SDK stabilizes only after both pass.

Claude then uses a supported structured interface, and Hermes proceeds only after supported programmatic transport discovery. Neither integration may scrape terminal presentation text. The desktop companion can proceed independently because it consumes only normalized `AdapterEvent` values.
