# Codex app-server protocol decision — 2026-08-24

> Status update: the planned direct-profile admission sequence completed on 2026-08-24; see `../verification/F5A2-CODEX-DIRECT-ADMISSION-2026-08-24.md`. Experimental WebSocket and typed client tools remain excluded.

## Decision

Desky's direct-download Codex adapter will supervise a local `codex app-server` process over its default stdio JSONL transport. It will not use terminal scraping, `codex exec`, or the experimental WebSocket listener.

Official current documentation identifies app-server as the rich-client surface for authentication, history, approvals, and streamed events. It defines newline-delimited JSON over stdio, an `initialize` request followed by `initialized`, thread/turn/item primitives, streamed `item/agentMessage/delta`, server-initiated approval requests, `turn/interrupt`, and terminal `turn/completed` statuses. It explicitly labels the WebSocket command/transport experimental and unsupported for production. Source: [Codex App Server](https://developers.openai.com/codex/app-server/).

## Typed Desky-action disposition

**Decision: unsupported in the admitted Codex adapter.** The documented client-local mechanism is `thread/start.dynamicTools` with app-server invoking `item/tool/call`. Both are part of the experimental API and require the client to opt into `initialize.params.capabilities.experimentalApi`. Desky does not enable that capability and does not ship an experimental protocol as a production integration.

The current CLI's generated schemas independently confirm the boundary: a non-experimental generation has no top-level `dynamicTools` property in `v2/ThreadStartParams.json`, while generation with `--experimental` does. Desky pins the non-experimental initialize and thread-start input schemas, keeps `codexFoundationCapabilities.agentActions` at `unsupported`, and explicitly rejects an unexpected `item/tool/call` request.

The stable surface does include MCP server status discovery and MCP tool calls. That is not equivalent to Desky registering an in-process action callback: it requires a separately configured MCP server or helper. Such a design remains viable later, but must first specify signed executable provenance, process containment, local authentication/configuration, upgrade ownership, Store/direct reachability and user removal. Until that independent architecture passes review, users do not need to edit Codex instructions or configuration to make Desky actions work—Codex simply does not advertise them. OpenClaw's already supported normalized action channel remains provider-specific below the common capability contract.

## Local protocol evidence

Inspected on 2026-08-24:

- executable: the current installed `codex.exe` supplied by the OpenAI editor extension;
- reported version: `codex-cli 0.146.0-alpha.3`;
- `codex app-server --help`: stdio default plus schema-generation commands;
- `codex app-server generate-ts --out <temporary-directory>`: completed successfully and produced the current v2 request, response, notification, approval, thread, turn, and item types.

The generated files were inspected from a temporary directory and not copied into the repository. App-server documentation states that generated schemas are exact to the CLI version that produced them. Desky therefore needs a repeatable build/admission step and an explicit supported-version policy; it must not silently treat a hand-written partial type set as the authoritative protocol.

## Provider-to-Desky mapping

| Codex app-server | Desky contract |
| --- | --- |
| process initialized and account usable | `connection.ready` |
| `thread/list`, `thread/start`, `thread/resume` | session list/create/select |
| accepted `turn/start` | `user.input.accepted` |
| `turn/started` / reasoning lifecycle | `agent.thinking` without private reasoning |
| `item/agentMessage/delta` | `assistant.delta` |
| command/file/MCP item lifecycle | redacted `tool.started` / `tool.completed` |
| command/file server request | `approval.requested`; generic decision mapped back to Codex decision |
| `turn/interrupt`, then supervised tree recycle | process-level cancel and selected-thread restoration |
| `turn/completed` completed/interrupted/failed | exactly one terminal event |

Raw reasoning text, raw command output, absolute paths, file diffs, tool arguments, environment data, and native JSON-RPC messages will not cross preload.

## Release-profile posture

- Direct Windows/macOS: candidate after trusted discovery/version admission and full conformance.
- Microsoft Store: disabled unless a separately reviewed Store-safe hosted transport exists.
- Mac App Store: disabled; it may not launch an arbitrary installed runtime.
- Renderer Simulation: unrelated and cannot satisfy Codex conformance.

## Remaining gates

1. ~~Discover a trusted absolute executable in main without renderer path input; record version and source in redacted diagnostics.~~ Implemented for PATH discovery with exact baseline admission; broader installer/signature provenance remains a release-hardening item.
2. ~~Define supported CLI versions and generate/pin protocol schemas reproducibly.~~ Exact `0.146.0-alpha.3` admission and the canonical 273-file generated-schema digest are committed. Generated files remain ephemeral because the generator is experimental and one aggregate file has nondeterministic object-key order; recursive canonicalization was proven stable across two fresh generations.
3. ~~Validate every consumed response, notification, and server request against the admitted schema subset.~~ The full schema bundle and each consumed schema are individually pinned. Bounded safe projection validators cover initialization, account state, session list, thread/turn responses, consumed notifications, and command/file approvals. Malformed state-bearing notifications close the runtime; malformed approvals decline.
4. ~~Implement thread lifecycle, streaming normalization, tool pairing, approval response mapping, interruption, restart/reconnect, and exactly-one-terminal semantics.~~ Fixture conformance now covers all of these. Restart is process replacement with three bounded fresh-admission attempts; selected thread resume is allowed, but lost turns and approvals are never replayed.
5. Decide and disclose the default `cwd`, sandbox policy, approval policy, model selection, and inherited-environment policy. Workspace/sandbox/environment are now resolved: user-picked opaque main grants, `read-only` default, optional natively confirmed `workspace-write`, fixed `on-request`, and the reviewed environment allowlist. Model selection remains upstream-default until a later capability-driven picker is admitted.
6. ~~Decide whether stable typed client-action registration exists.~~ It does not: `dynamicTools` is experimental. Desky reports actions as unsupported; stable MCP is a separate future helper topology.
7. Pass the shared adapter suite plus malformed input, backpressure, process crash, missing executable, unsupported version, unauthenticated account, usage limit, and package lifecycle tests. The authenticated source-runtime stream/approval/cancellation/crash matrix now passes; direct-profile packaged UI repetition remains.
8. Only then register the runtime and expose a direct-profile Codex connection form. It remains unregistered and `production: false`.
