# OpenClaw live verification — 2026-08-22

## Scope

- Desky baseline: `5901131` (`fix: recover stale OpenClaw device access`), plus the late-tool-terminal guard recorded by this verification update.
- Platform: Windows, loopback WebSocket.
- Gateway: OpenClaw 2026.8.1 development profile on `ws://127.0.0.1:19001`, reached by Desky through a controllable loopback WebSocket relay.
- Authentication: token supplied to the test process without printing or embedding it in the URL or command line.
- Harness: `tests/openclaw-live.test.ts` through `npm run test:openclaw:live`.

The harness uses fresh Ed25519 test identities, creates a labelled session, and creates synthetic exec approval records. The approval command text is display-only; the harness does not execute it. Credentials, device tokens, private keys, prompts beyond fixed probes, and local paths are not recorded here.

## Observed results

| Case | Result | Evidence |
| --- | --- | --- |
| Challenge, device proof, protocol v4 | Pass | Gateway returned `hello-ok` for protocol 4. |
| Wrong bootstrap credential | Pass | Gateway rejected a fresh invalid token; the host state and caller received the same bounded message without the submitted value. |
| Stale device token and recovery | Pass | Gateway rejected a synthetic stale token without echoing it; an explicit valid bootstrap credential bypassed the saved token and replaced it only after successful authentication. |
| Required scopes and methods | Pass | Read/write/approval scopes and session/chat/abort/unified-approval methods were advertised. |
| Session create/select/subscribe | Pass | A fresh labelled session was selected with approval replay enabled. |
| Approval deny | Pass | Gateway recorded the synthetic approval as `denied`. |
| Approval allow once | Pass | Gateway recorded the synthetic approval as `allowed` with `allow-once`. |
| Approval expiry | Pass | Gateway expired a short-lived synthetic approval and Desky emitted the matching terminal approval event. |
| Reviewer contention | Pass | Concurrent allow-once and deny decisions produced one applied answer, one non-applied answer, and one canonical terminal state. |
| Duplicate approval response | Pass | Gateway returned `applied: false`; Desky now reports the authoritative existing terminal state instead of claiming a new decision was applied. |
| Active-turn transport loss and cancellation | Pass | The harness terminated the relayed socket after turn admission; Desky reconnected with the active run, restored the session subscription, cancelled through the authoritative RPC acknowledgement, and emitted exactly one terminal event. |
| Native terminal cleanup | Pass | The provider-cooldown error arrived as a native failed terminal; Desky cleared the active run instead of leaving cancellation controls active. |
| Assistant streaming | Pass | After refreshing the actual Gateway OAuth profile and selecting the compatible `openai/gpt-5.4` route, the harness streamed `DESKY_LIVE_OK` and reached one non-aborted terminal state. |
| Real tool interruption | Pass | Packaged Desky started a harmless 90-second PowerShell tool at 14:08:09, invoked Stop at 14:08:10, received the abort acknowledgement and errored tool result at 14:08:10, and received the cancelled terminal at 14:08:11. The completion marker was not produced. |
| Same-session recovery | Pass | The packaged app sent a follow-up after cancellation, streamed `DESKY_FIXED_RECOVERY_OK`, and reached a non-aborted terminal at 14:08:20. The prompt control had returned from Stop to Send. |

## Local quality gates

- `npm test`: 22 passed, 1 opt-in live test skipped.
- `npx vitest run tests/openclaw-host.test.ts`: 9 passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run package`: passed for Windows x64.
- `npm audit --omit=dev`: 0 production findings.
- `npm audit`: 31 development-tool findings (1 critical, 24 high, 3 moderate, 3 low); this remains a public-release gate under `docs/SECURITY.md`.
- `npm run test:openclaw:live`: passed, including the deliberately non-waivable assistant-stream assertion.

## Consequence

The live runs proved the transport, session, approval, cancellation, and reconnect boundaries. They exposed four lifecycle gaps that are now repaired:

1. Desky previously treated every successful `approval.resolve` RPC as newly applied. The host now validates the unified response and distinguishes first application from an already-terminal approval.
2. Terminal approval events had no renderer-level event, so a resolved or expired reviewer card could remain actionable. `approval.resolved` now closes only the matching card and is idempotent across RPC and stream races.
3. Desky discarded the structured `sessions.abort` result and depended entirely on a terminal stream event. A disconnect race could therefore leave a turn unresolved forever. The host now validates `aborted` versus `no-active-run` and emits one deduplicated terminal state when the stream event was missed.
4. Native turn-terminal handling cleared the active run and then restored it through the generic activity branch. Terminal and non-terminal transitions are now mutually exclusive, preventing a completed turn from leaving cancellation controls active.

The security review also found that the connection state stored a redacted error while the IPC invocation could still reject with the original exception, and that other OpenClaw IPC operations had no common error boundary. Every renderer-invoked operation now uses one bounded redactor, including exact submitted-secret removal. Unit tests exercise labeled, bearer, and exact-value redaction; the live harness verifies wrong-bootstrap and stale-device-token rejection against the real Gateway.

A final authentication audit found that cached device-token precedence could prevent recovery even when the user explicitly supplied a fresh bootstrap credential. Explicit credentials now bypass cached device access. The new profile is persisted only after successful authentication, while a rejected attempt restores the previous in-memory profile and leaves its encrypted vault record untouched. Both failure preservation and real-Gateway replacement are verified.

The actual tool-interruption run then exposed a fifth lifecycle gap: the cancellation acknowledgement made the run terminal, but a later errored tool-result event reactivated the same run and restored the Stop control. The host now discards non-terminal events for run IDs already recorded as terminal. A contract fixture reproduces the late result, and the rebuilt packaged app proves immediate same-session recovery.

F2 remains open for response-stream interruption, live allow-always where offered, clean-device and cross-device pairing/rotation cases, remote TLS, and macOS Keychain-backed persistence. The successful assistant-stream and actual-tool-interruption gates required before F3 are closed.
