# OpenClaw live verification — 2026-08-22

## Scope

- Desky lifecycle baseline: `2a88c15` (`fix: close OpenClaw terminal lifecycle gaps`), plus the renderer error-boundary changes recorded by this verification update.
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
| Stale device token | Pass | Gateway rejected a synthetic stale device token without echoing its value. |
| Required scopes and methods | Pass | Read/write/approval scopes and session/chat/abort/unified-approval methods were advertised. |
| Session create/select/subscribe | Pass | A fresh labelled session was selected with approval replay enabled. |
| Approval deny | Pass | Gateway recorded the synthetic approval as `denied`. |
| Approval allow once | Pass | Gateway recorded the synthetic approval as `allowed` with `allow-once`. |
| Approval expiry | Pass | Gateway expired a short-lived synthetic approval and Desky emitted the matching terminal approval event. |
| Reviewer contention | Pass | Concurrent allow-once and deny decisions produced one applied answer, one non-applied answer, and one canonical terminal state. |
| Duplicate approval response | Pass | Gateway returned `applied: false`; Desky now reports the authoritative existing terminal state instead of claiming a new decision was applied. |
| Active-turn transport loss and cancellation | Pass | The harness terminated the relayed socket after turn admission; Desky reconnected with the active run, restored the session subscription, cancelled through the authoritative RPC acknowledgement, and emitted exactly one terminal event. |
| Native terminal cleanup | Pass | The provider-cooldown error arrived as a native failed terminal; Desky cleared the active run instead of leaving cancellation controls active. |
| Assistant streaming | Blocked | The latest run reported all models failed because the configured OpenAI provider was in rate-limit cooldown, before assistant deltas could be generated. |

## Local quality gates

- `npm test`: 20 passed, 1 opt-in live test skipped.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run package`: passed for Windows x64.
- `npm audit --omit=dev`: 0 production findings.
- `npm audit`: 31 development-tool findings (1 critical, 24 high, 3 moderate, 3 low); this remains a public-release gate under `docs/SECURITY.md`.
- `npm run test:openclaw:live`: all cases above passed until the deliberately non-waivable assistant-stream assertion, which failed on the provider cooldown recorded above.

## Consequence

The live runs proved the transport, session, approval, cancellation, and reconnect boundaries. They exposed four lifecycle gaps that are now repaired:

1. Desky previously treated every successful `approval.resolve` RPC as newly applied. The host now validates the unified response and distinguishes first application from an already-terminal approval.
2. Terminal approval events had no renderer-level event, so a resolved or expired reviewer card could remain actionable. `approval.resolved` now closes only the matching card and is idempotent across RPC and stream races.
3. Desky discarded the structured `sessions.abort` result and depended entirely on a terminal stream event. A disconnect race could therefore leave a turn unresolved forever. The host now validates `aborted` versus `no-active-run` and emits one deduplicated terminal state when the stream event was missed.
4. Native turn-terminal handling cleared the active run and then restored it through the generic activity branch. Terminal and non-terminal transitions are now mutually exclusive, preventing a completed turn from leaving cancellation controls active.

The security review also found that the connection state stored a redacted error while the IPC invocation could still reject with the original exception, and that other OpenClaw IPC operations had no common error boundary. Every renderer-invoked operation now uses one bounded redactor, including exact submitted-secret removal. Unit tests exercise labeled, bearer, and exact-value redaction; the live harness verifies wrong-bootstrap and stale-device-token rejection against the real Gateway.

F2 remains open. A passing assistant delta plus terminal-success run is required after model capacity becomes available. Tool progress and response-stream interruption, clean-device contention, remote TLS, and macOS Keychain-backed persistence remain explicit gates.
