# Agent adapter protocol

## Purpose

Adapters translate a runtime's native protocol into Desky events and commands. They do not select animations, manipulate UI, or silently grant permissions.

The initial protocol is internal while semantics stabilize. A public adapter SDK begins only after two substantially different production adapters pass the same contract suite.

## Adapter lifecycle

```ts
interface AgentAdapter {
  readonly descriptor: AdapterDescriptor;
  connect(options: ConnectionOptions): AsyncIterable<AdapterEvent>;
  send(input: UserInput): Promise<void>;
  cancel(turnId: string): Promise<void>;
  resolveApproval(requestId: string, decision: ApprovalDecision): Promise<void>;
  disconnect(reason?: string): Promise<void>;
}
```

An adapter instance owns one connection. It may expose multiple remote sessions, but concurrent turn semantics must be explicit in its descriptor.

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

The simulation adapter is a UI/state-machine harness only. It is always labeled `Simulation`, never persisted as a production connection, and cannot satisfy an integration milestone.
