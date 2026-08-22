# OpenClaw live verification — 2026-08-22

## Scope

- Desky base commit: `2f836e7` (`feat: add OpenClaw gateway adapter foundation`).
- Platform: Windows, loopback WebSocket.
- Gateway: OpenClaw 2026.8.1 development profile on `ws://127.0.0.1:19001`, reached by Desky through a controllable loopback WebSocket relay.
- Authentication: token supplied to the test process without printing or embedding it in the URL or command line.
- Harness: `tests/openclaw-live.test.ts` through `npm run test:openclaw:live`.

The harness uses fresh Ed25519 test identities, creates a labelled session, and creates synthetic exec approval records. The approval command text is display-only; the harness does not execute it. Credentials, device tokens, private keys, prompts beyond fixed probes, and local paths are not recorded here.

## Observed results

| Case | Result | Evidence |
| --- | --- | --- |
| Challenge, device proof, protocol v4 | Pass | Gateway returned `hello-ok` for protocol 4. |
| Required scopes and methods | Pass | Read/write/approval scopes and session/chat/abort/unified-approval methods were advertised. |
| Session create/select/subscribe | Pass | A fresh labelled session was selected with approval replay enabled. |
| Approval deny | Pass | Gateway recorded the synthetic approval as `denied`. |
| Approval allow once | Pass | Gateway recorded the synthetic approval as `allowed` with `allow-once`. |
| Duplicate approval response | Pass | Gateway returned `applied: false`; Desky now reports the authoritative existing terminal state instead of claiming a new decision was applied. |
| Cancellation | Pass | Immediate abort produced one normalized cancelled terminal failure. |
| Unexpected transport loss | Pass | The harness terminated the relayed socket without a Desky disconnect request; Desky entered reconnecting state, reauthenticated, and restored the selected session subscription. |
| Assistant streaming | Blocked | The runtime returned the configured Codex account's subscription-usage-limit error before generating assistant deltas. |

## Consequence

The live run proved the transport, session, approval, cancellation, and reconnect boundaries. It also exposed an acknowledgement-handling gap: Desky previously treated every successful `approval.resolve` RPC as newly applied. The host now validates the unified response and distinguishes first application from an already-terminal approval.

F2 remains open. A passing assistant delta plus terminal-success run is required after model capacity becomes available. Unexpected transport loss, tool progress, approval expiry/contention, remote TLS, and macOS Keychain-backed persistence also remain explicit gates.
