# Agent adapter protocol

## Purpose

Adapters translate a runtime's native protocol into Desky events and commands. They do not select animations, manipulate UI, or silently grant permissions.

Adapter Contract v1 is now an executable internal boundary. `src/main/adapters/contract.ts` validates every registered descriptor and initial state, every state returned through the registry, and every forwarded normalized event before it can cross IPC. OpenClaw and Codex both pass the same invariant suite. This freezes semantic identity, bounds, capability consistency, session uniqueness, finite agent-action claims, and the 16 KiB normalized-event payload ceiling without freezing provider-native wire formats. A separately versioned public adapter SDK remains gated on extracted author documentation and a third independently implemented adapter; internal TypeScript interfaces alone are not a supported extension API.

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

Connection retry counters are normalized state, not provider diagnostics. They remain inside Adapter Contract v1's `0..100` bound even during an indefinite outage; reaching 100 saturates the displayed counter but does not weaken the backoff or silently stop recovery. An explicit Connect starts a fresh retry budget before notifying renderer listeners, so a stale background count cannot make an otherwise valid connection fail contract admission.

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
- Current protocol evidence: `npm run codex:schema:verify` discovers the exact admitted CLI, generates its non-experimental JSON Schema set inside an isolated temporary `CODEX_HOME`, recursively canonicalizes JSON object keys, and verifies a committed 273-file SHA-256 baseline plus the individual schemas Desky consumes, including initialization and thread-start inputs. The generated 2.8 MB payload is deleted and never committed or shipped. `npm run codex:schema:refresh` is an explicit, review-required baseline refresh for a deliberately edited admitted version.
- Runtime status: the direct-profile `CodexRuntime` is registered and `production: true`. It passes fixtures for validated initialization/account state, bounded thread list/start/resume, active turns, assistant streaming, paired redacted tools, command/file approvals, cancellation, exactly-one terminal events, disconnect, bounded restart/reconnect, and malformed-consumed-notification shutdown. A recoverable process exit gets at most three fresh admission attempts at 0.5/1.5/4 seconds. Each attempt revalidates the workspace grant, executable/schema version and account, then resumes only a still-listed selected thread. Lost turns are failed exactly once and never replayed; approvals expire. Protocol/framing/termination failures never restart. Workspace consent remains main-owned and path-opaque. Both the authenticated source-runtime matrix and the packaged Windows Control Center now prove real streaming, denied and allowed write approvals, process-level cancellation, same-session recovery and reconnect in isolated workspaces. Typed actions remain unavailable.
- Process ownership: Windows disconnect uses shell-free `taskkill.exe /T /F`; Unix starts app-server in a detached process group, sends group `SIGTERM`, and escalates after 500 ms. The command itself is bounded to five seconds. A real Windows parent-plus-descendant fixture passed. Electron's first `before-quit` is now held behind a single ten-second adapter-disposal barrier, so asynchronous teardown is not abandoned during normal app exit.
- Typed-action disposition: **unsupported in the admitted Codex adapter**. The official `dynamicTools` thread-start field and `item/tool/call` callback are experimental and require `initialize.capabilities.experimentalApi`; Desky omits that capability, never sends `dynamicTools`, advertises no Codex agent actions, and rejects an unexpected client-tool request with JSON-RPC method-not-found. Stable MCP status/tool calls operate only against a separately configured external MCP server. Desky will not require a second user-installed product for this optional gesture feature. A helper is deferred unless native registration becomes stable or product evidence justifies a signed, automatically managed sidecar inside the one Desky installation.
- Provider admission: direct packages construct OpenClaw and Codex and expose an explicit provider picker; Store packages construct only OpenClaw, so no dormant local-process adapter exists behind the UI. Browsing another provider does not tear down the active connection; the registry performs the bounded disconnect/switch transaction only when the user presses Connect. The packaged authenticated matrix passed session creation, streaming, approval deny/allow, Stop during a real approved command, process-tree reconnect and recovery. WebSocket remains excluded because the official current surface labels it experimental and unsupported for production.

### Claude

- Direct transport selected: the official TypeScript Claude Agent SDK, pinned exactly to `@anthropic-ai/claude-agent-sdk 0.3.241`. Desky consumes typed SDK messages and partial API stream events; it never parses terminal presentation text. The SDK runs the Claude Code agent loop as a local subprocess, so this topology is direct-profile only.
- Authentication policy: an explicit Anthropic API key is required. Anthropic's official Agent SDK documentation says third-party products may not offer Claude.ai login or rate limits without prior approval, so Desky neither discovers nor reuses the user's consumer Claude Code session. SDK initialization must report `apiKeySource=ANTHROPIC_API_KEY`; `none`/OAuth and malformed capability frames fail closed. A separately approved enterprise proxy is a future provider-specific auth mode, not silently equivalent.
- Current foundation: `ClaudeSdkClient` uses a reviewed environment allowlist, injects only the supplied `ANTHROPIC_API_KEY`, identifies `desky/<version>`, disables auto-memory, loads no user/project settings (`settingSources: []`), enables strict empty MCP configuration, typed partial streaming, exact session list/resume, and SDK `canUseTool` callbacks to the host. The SDK's exact bundled Claude Code `2.1.241` is admitted from its init frame; the unrelated older `claude` on PATH is neither discovered nor trusted. Init also has to echo the resolved workspace and requested permission mode and must not expose an ambient MCP server.
- `ClaudeRuntime` implements opaque workspace-grant resolution, plan/read-only and default/workspace-write disclosure, implicit fresh sessions, resume, one active query, partial text, paired tool/progress events, SDK permission allow/deny/persistent suggestions, cancellation, disconnect, session refresh, redaction, and exactly-once terminals behind Adapter Contract v1. Persistent approval is unavailable unless the SDK supplied typed permission-update suggestions.
- Permission boundary: Desky displays and resolves the SDK's actual `canUseTool` prompts. The SDK may resolve a call earlier through its own managed policy/permission flow; `canUseTool` is not falsely documented as a universal pre-tool hook. Desky supplies no `allowedTools`, no bypass/accept-edits mode, and no filesystem settings in this foundation. Authenticated adversarial tests must still prove the effective plan/default policy before admission.
- Credential gate: the provider-specific API-key record now uses Electron OS credential encryption. Blank-key reuse is explicit. New/rotated access is written, and opt-out removal is honored, only after a successful API-key-authenticated turn; a rejected key, policy/version drift, cancellation, or failed turn leaves the previous record untouched. Renderer input is one-use and the key never enters normalized state/events.
- Admission status: descriptor remains `production: false`, direct-only, and unregistered. The development machine has no authorized `ANTHROPIC_API_KEY`; its consumer CLI login is intentionally irrelevant. Offline API-key custody, SDK/CLI policy-drift, redaction, and effective option-isolation fixtures now pass. An exact-exercise Control Center path and `package:claude:admission` profile exist only for conformance; the latter explicitly places the exact platform SDK executable in resources and the runtime receives that path. Windows packaging and the upstream executable's valid Anthropic Authenticode signature are proved, but an authenticated packaged launch is not. Live real-model streaming, deny/allow, interruption during execution, crash/cleanup, and encrypted second-process reuse remain the explicit admission matrix. Typed avatar actions are unsupported and the one-app MCP sidecar decision is deferred.
- Store transport would require a separately authenticated remote service, product-terms review, and its own package profile; the local SDK is not instantiated in Store builds.

### Hermes

- Supported transport selected: Hermes API Server HTTP resources plus structured run-event SSE. Official Hermes also exposes ACP and a richer TUI Gateway, but the API Server is the first Desky topology because it is language-neutral, explicitly intended for external UIs, authenticated, remotely deployable, and does not require terminal parsing or ownership of a local interactive process.
- Source admission pin: official `NousResearch/hermes-agent` revision `057dcdf236f8a6a26721c10fcc6ccb72726e272a`. The implementation was derived from `gateway/platforms/api_server.py`, its run/session tests, and the official programmatic-integration/API-server guides. A future Hermes version must still pass live capability admission rather than relying on this research snapshot.
- Current foundation: `HermesApiClient` requires HTTPS except for explicit loopback HTTP, rejects URL credentials/query/fragment material, sends bearer auth only from main, caps JSON at 512 KiB and each SSE frame at 256 KiB, requires the server-owned execution topology and the exact stable run/session/capability surface, and admits a canonical `/health` runtime version. Its SSE decoder tolerates fragmentation/comments but fails closed on malformed or incomplete frames.
- `HermesRuntime` implements session list/create/select, one active run, ordered assistant/tool/subagent events, per-run command approvals, server-acknowledged Stop, exactly-once terminal handling, disconnect cancellation, bounded reconnect and renderer-safe redaction behind Adapter Contract v1. Approval IDs are local and per-run because the Hermes endpoint resolves the current approval in the run's isolated authorization queue; unsupported permanent scope is rejected rather than widened. Passive 30-second admission checks detect idle server loss. Active SSE or REST transport loss expires approvals, fails the lost turn exactly once, closes the old connection identity, and makes at most three fresh admissions after 0.5/2/6.5 seconds. The selected session is restored only if it remains in the authoritative list; input is never replayed. Authentication, malformed protocol, capability drift, and runtime version/model drift are terminal.
- Live verification is intentionally split. `npm run test:hermes:live` requires `DESKY_HERMES_LIVE_TOKEN` and proves wrong-bearer rejection, authenticated version/capability admission, and REST session create/delete without requiring a model call. `npm run test:hermes:matrix:live` additionally requires an authenticated Hermes model provider and `approvals.mode=manual`; it proves a real streamed assistant turn, approval denial, approval allow-once, Stop during an executing command, exactly-one terminal behavior, passive idle recovery, active transport recovery, no replay, and a fresh successful turn after recovery. `DESKY_HERMES_LIVE_URL` defaults to loopback `http://127.0.0.1:8642`. The optional `DESKY_HERMES_PROCESS_RESTART_LIVE=1` gate requires an absolute `DESKY_HERMES_RESTART_EXECUTABLE` and proves re-admission plus model recovery across a real gateway service restart without invoking a shell.
- The full matrix is deliberately opt-in because Hermes tools execute on the API-server host. Hermes `approvals.mode=manual` guards safety-flagged actions rather than every terminal call, so the approval probes use `chmod 777` against unique nonexistent `/tmp/desky-hermes-*` paths. The denied probe cannot execute; the allow-once probe has no filesystem effect and proceeds to a bounded sleeping Python process so Stop is exercised during real tool execution. Hermes redacts the path in the approval event, Desky verifies that redaction, and every temporary Desky session is deleted after the test. The bearer is read only from the process environment and is never printed.
- Admission status: Hermes is now a `production: true`, direct-profile adapter on Windows. Its bearer is main-owned and may be stored only through Electron OS credential encryption after complete endpoint admission; saved access is scoped to the exact canonical endpoint, blank-token reuse never crosses endpoints, failed replacement preserves the prior ciphertext, and successful opt-out removes it. The packaged Control Center matrix proves a clean-profile connection, encrypted reuse, a new session, real `gpt-5.4` streaming, approval plus Stop during execution, bounded app exit, no rendered secret, and a second process launch using only saved access. Store packages do not instantiate Hermes. The locally executable remote-TLS contract is complete; a trusted operator ingress and macOS credential/package evidence remain open.
- Remote and action disposition: the pinned Hermes API Server binds an aiohttp `TCPSite` without a native TLS context. A remote deployment therefore requires an operator-owned HTTPS terminator or trusted private-network ingress in front of Hermes; Desky never accepts remote plaintext and has no certificate-bypass switch. System trust-store certificate trust/name/validity/protocol failures are terminal, renderer-safe, and shared with OpenClaw's `wss://` policy. A real-socket harness proves untrusted HTTPS and WSS rejection; `deploy/hermes/Caddyfile.example` documents a streaming-safe ingress boundary. `/v1/capabilities` and `/v1/toolsets` provide stable read-only discovery, but the API Server exposes no client-local tool registration endpoint and declares `admin_config_rw: false`. Hermes can load tools from separately configured MCP servers, with schemas owned process-wide and refreshed through Hermes configuration/reload. Desky will not silently edit that config or treat prompt text as an action. Typed avatar actions remain unsupported; no helper will be built now. If later justified, it must be a signed, authenticated, Desky-managed sidecar or gateway component with a one-app user experience, not a separately configured user dependency.
- No terminal text scraping is used or accepted.

Authenticated evidence is recorded in `docs/verification/F5B2-HERMES-AUTHENTICATED-MATRIX-2026-08-24.md` and `docs/verification/F5B3-HERMES-RESILIENCE-2026-08-24.md`.

## Contract tests

Every adapter must first pass the executable descriptor/state/event invariants and then fixtures for:

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
12. voice capability discovery, microphone/session ownership, bounded audio backpressure, partial/final transcript isolation, cancel/disconnect cleanup, and unsupported-provider behavior.
13. full-duplex format negotiation, bounded capture/playback, mark timing, turn-scoped barge-in, provider rejection downgrade, adapter-switch cleanup, and text/voice UI exclusivity.

## Voice input contract

`AgentAdapterCapabilities.voiceInput` is the only renderer authority for showing an enabled microphone. `available` requires the exact `streaming-transcription` transport, `g711_ulaw` encoding, and 8000 Hz input. An unavailable adapter must advertise `transport: none` and no audio format. Provider runtimes may implement the optional main-process voice methods only when that capability is true; the registry rejects all other starts.

Gateway method discovery proves the transport surface, not provider credentials. A missing or unconfigured transcription provider during session creation must downgrade the current connection to `setup-required` and disable capture until reconnect; it must not leave a repeatedly failing microphone button labeled ready.

OpenClaw maps the generic contract to its authenticated transcription-only Talk shape: `talk.session.create({ mode: "transcription", transport: "gateway-relay", brain: "none" })`, serialized `talk.session.appendAudio`, `talk.event`, then `talk.session.close`. The native remote session id used for append/close and the transcription event id are tracked separately. Only events matching the active transcription identity become provider-neutral transcript/error/closed events. The existing `operator.write` scope satisfies OpenClaw's Talk authorization; Deskiii does not request admin or Talk-secret scope.

Codex, Hermes, Claude, and Simulation direct adapters remain explicitly unsupported in the current voice implementation. This does not prevent their text adapters from working. Deskiii will not quietly transcribe audio and feed it into them while claiming a native provider voice feature. If OpenClaw itself is configured to use a similarly named model/runtime as its selected agent brain, Talk remains an OpenClaw capability: OpenClaw owns that consultation, tools, approvals, credentials, and session identity.

F5d.4 admits a future explicit cascade topology instead: a separately named speech runtime performs STT, the final transcript crosses the same normalized `send` boundary as typed text, the selected agent adapter remains authoritative for tools/approvals/cancellation, and only normalized visible assistant text enters TTS. When speech and agent runtimes differ, the UI and diagnostics name both. This is not a substitute hidden inside an agent adapter; it is the provider-neutral architecture in ADR 0012.

## Realtime voice-conversation contract

`AgentAdapterCapabilities.voiceConversation` is independent of dictation. `available` requires `gateway-relay-realtime`, at least one validated mono input and output format, and an optional truthful barge-in flag. Non-available states must expose `transport: none`, no formats, and `supportsBargeIn: false`. The registry admits one dictation or realtime session across all adapters, pins cleanup to the runtime that created it, and closes that session before adapter/session switching or disposal.

OpenClaw is the first mapping: `talk.catalog` must report a configured ready realtime provider, `gateway-relay`, and compatible PCM16 or G.711 formats; Deskiii then requests `talk.session.create({ sessionKey, mode: "realtime", transport: "gateway-relay", brain: "agent-consult" })`. Audio append, output cancellation, playback marks, close, and `talk.event` remain main-owned. The renderer receives a generated session id plus negotiated formats, not Gateway/provider credentials or tool authority. Provider-side agent consultation continues through OpenClaw's existing policy and selected session.

Method/catalog readiness is not an entitlement claim. A synchronous creation error or asynchronous provider rejection disables further starts on that connection and publishes `setup-required`. The actual bounded provider error is still shown for diagnosis. On the reference Gateway, the freshly authenticated `cosychiruka@gmail.com` OAuth profile is explicitly first and Runner Courage is second. Current OpenClaw admits a real `gpt-live-1-codex`/`spruce` session with PCM16 24 kHz after correcting the stale GA voice selection and after the account switch; live assistant audio remains an unproved F5d.3 claim.

The renderer serializes a bounded capture queue and stops instead of silently dropping microphone audio. Output is decoded into a bounded Web Audio schedule; clear/cancel stops already scheduled sources, playback marks are acknowledged at their audible boundary, and avatar `speaking` follows scheduled audio rather than transcript arrival. The live-voice dock replaces the text composer for the session and exposes phase, Interrupt when meaningful, End, Escape, and reduced-motion-safe activity. No wake word, launch-time capture, persistence, or background listener is admitted.

The simulation adapter is a UI/state-machine harness only. It is always labeled `Simulation`, never persisted as a production connection, and cannot satisfy an integration milestone.

## Multi-provider speech disposition

Voice does not become four separate copies of microphone/VAD/playback logic. The implementation sequence is:

1. Close OpenClaw F5d.3 live evidence.
2. Extract the proven OpenClaw path behind a main-owned speech-runtime registry and `VoiceCoordinator`, keeping renderer behavior and wire semantics unchanged.
3. Admit Hermes relay transcription and streaming PCM TTS as the first cascade runtime. Deskiii deliberately avoids Hermes client-direct `/api/audio/voice-config`, because that route can return resolved provider credentials.
4. Compose the admitted cascade with direct Hermes and Codex agents. Cancellation, approvals, tools, reconnect, and exactly-once terminals remain owned by the active agent adapter.
5. Keep native Codex realtime non-production while `thread/realtime/*` requires `experimentalApi`; use only a version-pinned lab probe to watch stabilization.
6. Add Claude to the cascade only after its authenticated agent/package gate. The supported Agent SDK does not define native audio.

No provider instruction file or system prompt has to be edited. The speech plane submits ordinary user text and consumes normalized assistant text. Full topology, package implications, and evidence are in `docs/research/VOICE-PROVIDER-TOPOLOGY-2026-09-01.md`.

## Provider conversation handoff

Opening a provider UI is deliberately separate from the adapter wire contract. The renderer sends one argument-free `desky:conversation:open` intent. Main reads the active adapter, selects only a fixed reviewed route, confirms an OS protocol handler, and either opens that provider client or opens Deskiii's synchronized control center. Provider output, session labels/ids, endpoints, credentials, and prompt text can never choose an executable or URI.

- **OpenClaw:** admitted on Windows through the official `openclaw://chat` deep link. The OpenClaw client owns its chat/session navigation.
- **Claude:** Claude Desktop officially supports `claude://` chat and Code links, but Deskiii's Claude Agent SDK session id is not a Claude.ai conversation id. No mapping is guessed, so Claude falls back to Deskiii.
- **Hermes:** Hermes Desktop officially shares backend sessions and exposes session search, but no stable public conversation-opening URI is documented. Its MCP-install deep link is unrelated and is not reused. Hermes falls back to Deskiii.
- **Codex:** no stable documented desktop conversation deep link is admitted. Codex falls back to Deskiii.

Adding a route requires primary upstream documentation, an exact-session compatibility decision, installed-handler and failure-path tests, no secrets in the link, and review in every release profile. Detecting an executable alone is insufficient.

## Adapter-platform extraction timing

OpenClaw is the first production conformance runtime behind the generic platform, not the application-level bridge. `OpenClawRuntime` validates its exact token/password payload, maps native gateway/session/run names into the shared state, preserves redaction, and delegates transport behavior to the already-proven `OpenClawAdapterHost`. The renderer and preload expose only `desky.adapters` over `desky:adapter:*` channels. Codex is the second substantially different production adapter and both now pass executable Contract v1 invariants.

Hermes is admitted in direct builds through its authenticated API-server resources and run-event SSE contract; Claude follows through the supported Agent SDK. Hermes has authenticated streaming, approval, cancellation, resilience, OS-encrypted credential, packaged Windows lifecycle, and local remote-transport security evidence. It remains structurally excluded from Store builds; an operator-owned trusted ingress, typed actions, and macOS stay explicit. Neither integration may scrape terminal presentation text or inherit consumer login without explicit upstream permission. The desktop companion can proceed independently because it consumes only normalized `AdapterEvent` values.
