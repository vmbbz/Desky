# ADR 0003: OpenClaw Gateway v4 client boundary

Status: Accepted for F2

## Context

Desky needs authenticated sessions, streamed assistant and tool activity, explicit approvals, cancellation, and reconnect without exposing gateway credentials to the renderer. OpenClaw's current documentation recommends `@openclaw/gateway-client` and `@openclaw/gateway-protocol`, but the npm packages resolved on 2026-08-22 as `0.0.0` placeholder tarballs containing no client or schemas.

The protocol was therefore verified against the official `openclaw/openclaw` source at immutable revision `66c0a23a063908fa5d83d344cebff171c7dea832`. That revision defines Gateway protocol version 4 and requires current general clients to negotiate exactly version 4.

## Decision

- Implement a small internal protocol-v4 wire client behind Desky's adapter host.
- Use the canonical `gateway-client` / `backend` identity because OpenClaw rejects unknown client IDs.
- Request only `operator.read`, `operator.write`, and `operator.approvals`.
- Advertise `session-scoped-events`, `tool-events`, `approvals`, `exec-approvals`, and `plugin-approvals`.
- Keep WebSocket, Ed25519 device identity, credentials, device tokens, retry state, and native frame validation in Electron's main process.
- Encrypt persisted credentials, device identity, and paired device tokens with Electron `safeStorage`; fail closed if OS encryption is unavailable.
- Permit plaintext `ws:` only for loopback and expose that state visibly. Require `wss:` everywhere else.
- Treat OpenClaw frames as untrusted input. Only normalized, redacted Desky events cross IPC.
- Preserve this boundary so the internal client can be replaced by the official package once it contains a usable, versioned implementation.

## Wire mapping

| Desky operation | OpenClaw v4 method/event |
| --- | --- |
| Authenticate | `connect.challenge` then `connect` with signed device payload |
| Discover sessions | `sessions.list`, `sessions.subscribe` |
| Select session | `sessions.messages.subscribe` with `includeApprovals: true` |
| Send | `chat.send` with an idempotency key |
| Stream | `chat`, `agent`, `session.tool`, `session.approval` events |
| Cancel | `sessions.abort` with session key and run ID |
| Resolve approval | `approval.resolve` with kind and explicit decision |
| Reconnect | fresh challenge/auth, resubscribe, refresh sessions/history |

## Compatibility policy

The upstream revision is evidence for implementation and fixtures, not vendored source. CI contract fixtures cover the fields Desky consumes. A protocol bump, removal of a required advertised method, event sequence gap, malformed security-sensitive event, or failed device signature is a visible compatibility failure; Desky does not silently guess.

## Consequences

F2 can proceed without depending on an empty package, while the bespoke protocol surface stays intentionally narrow. A real gateway verification remains mandatory before F2 exits; fixtures alone do not satisfy the milestone.
