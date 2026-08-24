# Codex app-server protocol decision — 2026-08-24

## Decision

Desky's direct-download Codex adapter will supervise a local `codex app-server` process over its default stdio JSONL transport. It will not use terminal scraping, `codex exec`, or the experimental WebSocket listener.

Official current documentation identifies app-server as the rich-client surface for authentication, history, approvals, and streamed events. It defines newline-delimited JSON over stdio, an `initialize` request followed by `initialized`, thread/turn/item primitives, streamed `item/agentMessage/delta`, server-initiated approval requests, `turn/interrupt`, and terminal `turn/completed` statuses. It explicitly labels the WebSocket command/transport experimental and unsupported for production. Source: [Codex App Server](https://learn.chatgpt.com/docs/app-server.md).

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
| `turn/interrupt` | cancel active turn |
| `turn/completed` completed/interrupted/failed | exactly one terminal event |

Raw reasoning text, raw command output, absolute paths, file diffs, tool arguments, environment data, and native JSON-RPC messages will not cross preload.

## Release-profile posture

- Direct Windows/macOS: candidate after trusted discovery/version admission and full conformance.
- Microsoft Store: disabled unless a separately reviewed Store-safe hosted transport exists.
- Mac App Store: disabled; it may not launch an arbitrary installed runtime.
- Renderer Simulation: unrelated and cannot satisfy Codex conformance.

## Remaining gates

1. ~~Discover a trusted absolute executable in main without renderer path input; record version and source in redacted diagnostics.~~ Implemented for PATH discovery with exact baseline admission; broader installer/signature provenance remains a release-hardening item.
2. Define supported CLI versions and generate/pin protocol schemas reproducibly. Exact `0.146.0-alpha.3` admission is implemented; reproducible generated-artifact integration remains.
3. Validate every consumed response, notification, and server request against the admitted schema subset. Bounded validators cover the currently consumed core shapes; generated-schema coverage remains.
4. Implement thread lifecycle, streaming normalization, tool pairing, approval response mapping, interruption, restart/reconnect, and exactly-one-terminal semantics. All except automatic restart/reconnect now pass fixture conformance.
5. Decide and disclose the default `cwd`, sandbox policy, approval policy, model selection, and inherited-environment policy.
6. Pass the shared adapter suite plus malformed input, backpressure, process crash, missing executable, unsupported version, unauthenticated account, usage limit, and package lifecycle tests.
7. Only then register the runtime and expose a direct-profile Codex connection form. It remains unregistered and `production: false`.
