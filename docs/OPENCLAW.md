# OpenClaw integration

## Status

Desky implements the OpenClaw Gateway v4 client surface required for F2. Contract fixtures are green. Against local OpenClaw 2026.8.1, the opt-in harness passes authentication, wrong-bootstrap rejection, stale-device-token rejection and fresh-credential recovery, advertised capabilities, session creation/subscription, approval deny, allow-once, expiry, first-answer-wins contention, duplicate acknowledgement, active-turn recovery from unexpected transport loss, a successful assistant stream, Desky action capability discovery, and a real model-issued Jump tool call. A packaged-app gate also passes cancellation during real shell-tool execution and a successful same-session turn immediately afterward. The remote transport contract now has real-socket evidence for strict TLS validation and terminal untrusted-certificate rejection. An operator-owned trusted remote Gateway matrix and macOS checks keep F2 open.

The implementation is pinned to official `openclaw/openclaw` revision `66c0a23a063908fa5d83d344cebff171c7dea832`. The recommended npm packages resolved on 2026-08-22 as empty `0.0.0` placeholder tarballs, so Desky temporarily owns a narrow internal wire client behind a replaceable boundary. See ADR 0003.

## Connection model

Desky acts as a Gateway `operator` client with these scopes:

- `operator.read` for sessions, history, and live events.
- `operator.write` for session creation, messages, and cancellation.
- `operator.approvals` for explicit reviewer decisions.

It advertises session-scoped events, structured tool events, unified approvals, exec approvals, and plugin approvals. Unknown client IDs are not used; Desky reports the canonical `gateway-client` ID with a human-readable display name.

## Desky avatar actions

The optional agent-action capability is supplied by the reviewed tool-only package in `integrations/openclaw-desky-actions`. It declares one structured OpenClaw tool, `desky_avatar_action`, with a finite `wave`/`jump` enum, plus a read-scoped `desky.actions.capabilities` discovery method. Desky accepts only the exact tool-start frame for the selected session and a live turn, deduplicates the tool-call identity, removes every other argument, and sends one ephemeral command to the motion queue. It never parses assistant text and never claims the animation completed merely because the Gateway executed the tool.

Gateway operators install/enable the plugin once and restart or reload the Gateway; restrictive `plugins.allow` and tool policies must also admit it. Ordinary users do not update agent prompts, workspace instructions, `AGENTS.md`, or `CLAUDE.md`: OpenClaw's tool catalog provides the model-facing schema and usage description. Optional personality wording is not protocol setup. See `docs/AGENT-ACTIONS.md` and the integration package README.

## First connection

1. Start the Gateway and confirm its URL and configured authentication mode.
2. Use `ws://127.0.0.1:18789/` only for a local loopback Gateway. Remote endpoints must use `wss://`.
3. Enter the token or password in Desky. Do not put credentials in the URL.
4. Desky waits for `connect.challenge`, signs the nonce-bound v3 device payload with its Ed25519 identity, and negotiates exactly protocol 4.
5. If the Gateway requires pairing, Desky displays the pairing request ID. Approve it through OpenClaw's device-management flow, then reconnect.
6. After `hello-ok`, Desky persists any returned device token using OS credential encryption and uses it on subsequent reconnects.
7. Select an existing session or create a new session before sending input.

Leaving the credential field blank uses saved access. Entering a credential explicitly bypasses any saved device token, allowing a rotated bootstrap credential to recover a stale pairing. Desky replaces saved access only after the new connection succeeds; a rejected replacement does not destroy the last saved profile.

## Reconnect and recovery

- A successful protocol-v4 WebSocket handshake proves transport and authentication, not that the Gateway is globally ready. Deskiii probes the same-origin `/startupz` lifecycle contract after authentication and every five seconds while the authenticated transport survives. An explicit `starting` or `draining` response immediately withdraws the green connected claim and blocks new sends with a restart-specific message. If that same transport survives and `/startupz` returns to `started`, Deskiii restores the connected claim without creating a second socket.
- Failure, absence, or an unrecognized response from `/startupz` is compatibility-neutral for older Gateways; it never overrides an otherwise valid authenticated v4 connection. The probe sends no credentials, follows no redirects, has a five-second timeout, and reads at most 8 KiB.
- If the Gateway begins draining during an admitted text or realtime turn, Deskiii retains the existing transport only to resolve that work. An already-visible text Stop, approval decision, realtime cancellation fallback, playback-mark acknowledgement, and voice-session close remain reachable; new messages, new voice sessions, and session mutation are rejected. When the Gateway closes, normal bounded reconnect takes over.
- `/startupz` is not a substitute for request-level admission. It can report `started` while an older Gateway build rejects one stale request root. That OpenClaw 2026.8.1 defect is handled by the corrected source runtime; Deskiii does not mislabel the global lifecycle probe as its fix.
- Unexpected disconnects retry after 1, 2, 4, 8, 16, then at most 30 seconds.
- Authentication and other explicitly terminal Gateway errors remain visible and do not spin indefinitely.
- Expired, not-yet-valid, untrusted, hostname-mismatched, and invalid TLS handshakes are sanitized terminal failures. They never enter the reconnect loop, and native certificate details never cross IPC.
- The WebSocket client disables redirects and compression, enforces platform certificate validation, bounds payloads, and closes on binary or malformed protocol frames.
- A reconnect refreshes sessions, re-subscribes the selected session with approval replay, and requests bounded history when supported.
- An event sequence gap triggers the same bounded reconciliation path.
- Desky deduplicates terminal events per run and never converts natural-language text into an approval.
- A native terminal event clears the active run in one exclusive transition; it cannot be reclassified as fresh activity by the same event.
- Once a run is terminal, late tool progress or result events for that run are discarded. They cannot resurrect cancellation controls or overwrite the terminal companion state.
- The structured `sessions.abort` acknowledgement is authoritative. If a terminal stream event was lost during reconnect, Desky emits one bounded terminal failure from the acknowledgement instead of leaving the turn active indefinitely.
- Terminal approval events clear only their matching reviewer card. Late, duplicate, malformed, or unrelated terminal events cannot clear a newer request.
- Agent action commands are live-only. Reconnect, history replay, a newly opened window, another session, a duplicate tool event, or a terminal turn cannot replay an old gesture.

## Realtime voice routing

Deskiii's OpenClaw live-voice surface is a continuous Gateway-relay Talk client. The reference GPT-Live Gateway uses `mode: "realtime"`, `transport: "gateway-relay"`, and `brain: "agent-consult"` under `talk.realtime`. It must leave `consultRouting` unset because OpenClaw rejects `force-agent-consult` for `gpt-live-1-codex`. The admitted source runtime prefers native Quicksilver delegation. If a finalized user turn produces no native delegation, OpenClaw starts the same bounded Gateway-owned agent consult after a short grace and appends its result as speakable session context; native events during the grace win and late duplicates are ignored. This is a Gateway correction, not Deskiii text parsing or a second model path. Other realtime providers may use `force-agent-consult` only when their advertised provider contract supports it. Deskiii never infers one routing policy from another provider.

Natural interruption is speech-driven. Deskiii keeps echo-cancelled microphone capture active while output plays and uses RMS at least `0.02`, peak at least `0.08`, for two consecutive capture frames. Sustained speech immediately clears local playback but keeps appending the exact interrupting microphone frame. GPT-Live/Frameless Bidi owns interruption from incoming audio; calling `talk.session.cancelOutput` would deliberately close that provider's relay turn and, after its bounded drain, the live session. The live dock intentionally contains phase, activity, and End only—there is no ordinary Interrupt button. The cancellation RPC remains available internally for playback overflow and bounded recovery, not ordinary GPT-Live speech barge-in.

The renderer shows `Hearing you` after the provider acknowledges partial user speech. If that utterance never finalizes, a 12-second watchdog fails visibly and ends the unhealthy live session instead of leaving an indefinite Listening/Thinking claim or pretending the relay recovered. Final agent results remain OpenClaw-owned; a short provider acknowledgement such as “let me check” is not treated as task completion. The 2026-09-01 reference run finalized the skills request and produced a short assistant acknowledgement but no native delegation or agent run while `/startupz` remained healthy. That evidence motivated the source-runtime fallback above. Its unit and owner-lifecycle suites pass. The selected OAuth profile has since been reauthenticated and the corrected source Gateway restarted successfully; the three-skills result and natural-barge-in packaged roundtrip remain the live gate.

## Live F2 verification

The live harness is deliberately excluded from normal `npm test` execution. It creates a clearly labelled verification session and synthetic approval records in the selected Gateway; it never executes the approval probe commands. Provide credentials through the process environment, never in the URL or command arguments.

PowerShell:

```powershell
$env:DESKY_OPENCLAW_LIVE_URL = 'ws://127.0.0.1:19001'
$env:DESKY_OPENCLAW_LIVE_CREDENTIAL = Read-Host 'Gateway token' -MaskInput
npm run test:openclaw:live
Remove-Item Env:DESKY_OPENCLAW_LIVE_URL, Env:DESKY_OPENCLAW_LIVE_CREDENTIAL
```

The test must fail if the real assistant turn cannot stream `DESKY_LIVE_OK`, if action capability discovery is absent, or if the subsequent turn does not emit a typed Jump command. Transport and approval passes do not waive those gates. See the dated verification record in `docs/verification/` for the latest redacted result.

Record the Gateway version, Desky commit, platform, connection profile, and redacted result for each case:

1. Clean profile: connect, pair, create a new session, send one message, observe ordered deltas, and receive one terminal success.
2. Tool run: observe start/progress/completion without raw environment values or absolute paths crossing into the renderer.
3. Approval: exercise allow once, persistent allow only when offered, deny, expiry, and a duplicate response. The Gateway acknowledgement must be authoritative.
4. Cancellation: abort during thinking, tool execution, and streaming. Confirm queued work is cleared and exactly one terminal state remains.
5. Network loss: disconnect during a run, restore transport, confirm session subscription/history reconciliation, and verify no duplicate terminal event.
6. Authentication: wrong token, stale device token, unapproved pairing, and scope rejection must expose bounded redacted errors.
7. Transport: remote `ws://`, URL credentials, URL queries, malformed frames, binary frames, oversized frames, and request backpressure must fail closed.
8. Remote Store profile: connect through trusted `wss://`; confirm a bad or untrusted certificate cannot be bypassed.

The 2026-08-22 packaged Windows gate additionally started a harmless 90-second shell command, invoked Desky's visible Stop control after the structured tool-start event, observed an authoritative abort acknowledgement, an errored tool result, and an aborted lifecycle terminal, then completed a new assistant turn in the same session. See the dated verification record for the redacted timings.

The 2026-08-26 transport-security gate exercised actual HTTPS and `wss://` sockets against an ephemeral untrusted certificate generated outside the repository. Both Hermes and OpenClaw rejected the connection terminally without leaking certificate detail. This proves fail-closed client behavior, not a successful trusted public deployment. See `docs/verification/F5B6-REMOTE-TRANSPORT-SECURITY-2026-08-26.md`.

## Diagnostics policy

Safe diagnostics may include Gateway origin, protocol/server version, connection status, retry count, advertised method names, session key, run ID, error code, and redacted message. They must never include credentials, device private keys, device tokens, authorization headers, full prompts, raw tool arguments, environments, or precise filesystem paths.

All renderer-invoked OpenClaw operations pass through one main-process error boundary. It removes known submitted secrets and credential-shaped fields, caps the message length, and returns the same safe connection error recorded in adapter state. Raw Gateway exceptions never cross IPC.
