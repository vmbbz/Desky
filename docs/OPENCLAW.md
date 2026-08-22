# OpenClaw integration

## Status

Desky implements the OpenClaw Gateway v4 client surface required for F2. Contract fixtures are green. The opt-in live harness passes authentication, advertised capabilities, session creation/subscription, approval deny, allow-once, expiry, first-answer-wins contention, duplicate acknowledgement, and active-turn recovery from unexpected transport loss against local OpenClaw 2026.8.1. A successful assistant stream remains blocked by the configured OpenAI provider's rate-limit cooldown, so F2 is not complete.

The implementation is pinned to official `openclaw/openclaw` revision `66c0a23a063908fa5d83d344cebff171c7dea832`. The recommended npm packages resolved on 2026-08-22 as empty `0.0.0` placeholder tarballs, so Desky temporarily owns a narrow internal wire client behind a replaceable boundary. See ADR 0003.

## Connection model

Desky acts as a Gateway `operator` client with these scopes:

- `operator.read` for sessions, history, and live events.
- `operator.write` for session creation, messages, and cancellation.
- `operator.approvals` for explicit reviewer decisions.

It advertises session-scoped events, structured tool events, unified approvals, exec approvals, and plugin approvals. Unknown client IDs are not used; Desky reports the canonical `gateway-client` ID with a human-readable display name.

## First connection

1. Start the Gateway and confirm its URL and configured authentication mode.
2. Use `ws://127.0.0.1:18789/` only for a local loopback Gateway. Remote endpoints must use `wss://`.
3. Enter the token or password in Desky. Do not put credentials in the URL.
4. Desky waits for `connect.challenge`, signs the nonce-bound v3 device payload with its Ed25519 identity, and negotiates exactly protocol 4.
5. If the Gateway requires pairing, Desky displays the pairing request ID. Approve it through OpenClaw's device-management flow, then reconnect.
6. After `hello-ok`, Desky persists any returned device token using OS credential encryption and uses it on subsequent reconnects.
7. Select an existing session or create a new session before sending input.

## Reconnect and recovery

- Unexpected disconnects retry after 1, 2, 4, 8, 16, then at most 30 seconds.
- Authentication and other explicitly terminal Gateway errors remain visible and do not spin indefinitely.
- A reconnect refreshes sessions, re-subscribes the selected session with approval replay, and requests bounded history when supported.
- An event sequence gap triggers the same bounded reconciliation path.
- Desky deduplicates terminal events per run and never converts natural-language text into an approval.
- A native terminal event clears the active run in one exclusive transition; it cannot be reclassified as fresh activity by the same event.
- The structured `sessions.abort` acknowledgement is authoritative. If a terminal stream event was lost during reconnect, Desky emits one bounded terminal failure from the acknowledgement instead of leaving the turn active indefinitely.
- Terminal approval events clear only their matching reviewer card. Late, duplicate, malformed, or unrelated terminal events cannot clear a newer request.

## Live F2 verification

The live harness is deliberately excluded from normal `npm test` execution. It creates a clearly labelled verification session and synthetic approval records in the selected Gateway; it never executes the approval probe commands. Provide credentials through the process environment, never in the URL or command arguments.

PowerShell:

```powershell
$env:DESKY_OPENCLAW_LIVE_URL = 'ws://127.0.0.1:19001'
$env:DESKY_OPENCLAW_LIVE_CREDENTIAL = Read-Host 'Gateway token' -MaskInput
npm run test:openclaw:live
Remove-Item Env:DESKY_OPENCLAW_LIVE_URL, Env:DESKY_OPENCLAW_LIVE_CREDENTIAL
```

The test must fail if the real assistant turn cannot stream `DESKY_LIVE_OK`; transport and approval passes do not waive that gate. See the dated verification record in `docs/verification/` for the latest redacted result.

Record the Gateway version, Desky commit, platform, connection profile, and redacted result for each case:

1. Clean profile: connect, pair, create a new session, send one message, observe ordered deltas, and receive one terminal success.
2. Tool run: observe start/progress/completion without raw environment values or absolute paths crossing into the renderer.
3. Approval: exercise allow once, persistent allow only when offered, deny, expiry, and a duplicate response. The Gateway acknowledgement must be authoritative.
4. Cancellation: abort during thinking, tool execution, and streaming. Confirm queued work is cleared and exactly one terminal state remains.
5. Network loss: disconnect during a run, restore transport, confirm session subscription/history reconciliation, and verify no duplicate terminal event.
6. Authentication: wrong token, stale device token, unapproved pairing, and scope rejection must expose bounded redacted errors.
7. Transport: remote `ws://`, URL credentials, URL queries, malformed frames, binary frames, oversized frames, and request backpressure must fail closed.
8. Remote Store profile: connect through trusted `wss://`; confirm a bad or untrusted certificate cannot be bypassed.

## Diagnostics policy

Safe diagnostics may include Gateway origin, protocol/server version, connection status, retry count, advertised method names, session key, run ID, error code, and redacted message. They must never include credentials, device private keys, device tokens, authorization headers, full prompts, raw tool arguments, environments, or precise filesystem paths.
