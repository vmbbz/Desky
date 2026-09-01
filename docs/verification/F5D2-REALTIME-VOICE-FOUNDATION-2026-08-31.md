# F5d.2 realtime voice foundation — 2026-08-31

## Outcome

The provider-neutral full-duplex voice foundation, OpenClaw Gateway-relay mapping, bounded renderer audio pipeline, exclusive voice-mode UI, and provider-rejection recovery are implemented for Windows direct builds.

This remains a foundation claim rather than a successful assistant-audio claim. A later authentication refresh now proves GPT-Live session admission; microphone, audible output, and barge-in evidence remain in F5d.3.

## Implemented boundary

- Added a distinct `voiceConversation` capability and bridge; dictation is not widened into full duplex.
- Negotiates `realtime` + `gateway-relay` + `agent-consult` and provider-reported mono PCM16/G.711 formats from `talk.catalog`.
- Keeps remote identity, selected agent session, events, credentials, provider tools, and account id in main/OpenClaw.
- Enforces one dictation or realtime owner globally and closes the creating adapter's session on switch, disconnect, renderer destruction, or app disposal.
- Bounds canonical input IPC, serialized capture backlog, provider output, scheduled playback, transcript text, marks, error messages, and the create-response event handoff across runtime/IPC/renderer ownership.
- Cancels output by active session and optional turn id, clears local playback immediately, and acknowledges marks at playback time.
- Maps actual scheduled output to avatar Speaking rather than using assistant text as a fake audio signal.
- At the F5d.2 foundation snapshot, replaced the ambient and Control Center text composers during voice with Listening/Thinking/Speaking, contextual Interrupt, End, and Escape. F5d.3 subsequently removed the ordinary Interrupt control, added `Hearing you`, and adopted the official desktop client's guarded local speech detector plus turn-scoped cancellation for natural barge-in.
- Auto-dismisses final assistant voice text using the existing bounded reading interval.
- Fails Store profile voice closed pending its microphone manifest/certification gate.
- Downgrades asynchronous provider rejection to `setup-required` until reconnect instead of leaving a repeatedly failing headset control enabled.

## Primary-source audit

The implementation was checked against official OpenClaw commit `8ac6379011c20702875e5219268b40969c5b90b2`; provider admission was refreshed against `origin/main` at `da96a6870f73ec40d8e0fbcc3bfd6b88b7996897` and the official `2026.8.1` packages. Source paths, native-client behavior, adopted contracts, intentional bounded-queue divergence, and remaining gates are recorded in `docs/research/OPENCLAW-REALTIME-VOICE-AUDIT-2026-08-31.md`.

## Live Gateway evidence

The reference Gateway on loopback reports:

- OpenClaw `2026.8.1`;
- OpenAI realtime provider configured and ready in `talk.catalog`;
- `gateway-relay`, `agent-consult`, and barge-in;
- PCM16 24 kHz and G.711 mu-law 8 kHz input/output;
- model `gpt-live-1-codex` and the model-specific GPT-Live voice `spruce`.

The agent-specific official auth commands report this effective order:

1. `openai:runnercourage@gmail.com`;
2. `openai:cosychiruka@gmail.com`.

The runner profile was refreshed through the official OpenClaw OAuth command. Read-only metadata inspection reports that the record contains the required OAuth/account metadata. Secret values and the account id were not printed.

This order is historical evidence for the dated F5d.2 snapshot. The operator later exhausted and switched accounts. The replacement selection was reauthenticated and read-only verified on 2026-09-01; new functional claims still require their own fresh roundtrip evidence.

After updating the stale GA `cedar` selection to the current GPT-Live Codex V3 `spruce` voice, an authenticated `talk.session.create` succeeds and returns PCM16 24 kHz input/output. The CLI connection then ends and the Gateway releases its connection-owned probe session. No audio was sent. This supersedes the earlier account-entitlement diagnosis: the 403 was consistent with the overloaded invalid-voice response.

The pre-change OpenClaw configuration is recoverable at:

`C:\Users\cosyc\.openclaw-dev\backups\talk-realtime-20260831\openclaw-before-openai-realtime.json`

## Automated and packaged verification

- Focused adapter/host/audio suite: 3 files, 31 tests passed.
- Full suite: 96 files passed, 7 skipped; 527 tests passed, 12 skipped.
- TypeScript typecheck passed.
- ESLint passed.
- `git diff --check` passed.
- Production dependency audit: 0 reported vulnerabilities across all severities.
- `windows-direct` package and post-package ASAR capability verifier passed; commerce signatures remained absent.
- Ignored packaged ambient and Control Center captures under `artifacts/voice-ui-f5d2/` each report `voiceActive=true`, one Listening dock, no ambient/control text prompt, no launcher, and no visual-exercise error.

Skipped tests are pre-existing environment/credential/platform lanes; none is counted as realtime assistant-audio evidence.

## Remaining F5d.3 gate

From the clean package and now-admitted OAuth/model/voice session, prove:

1. microphone allow and deny;
2. real user and assistant transcript ordering;
3. audible output in each negotiated format used by the provider;
4. natural speech barge-in during playback and exact turn cancellation, without a UI button;
5. clear/mark order at the audible boundary;
6. queue overflow, malformed output, provider failure, disconnect, surface destruction, and recovery;
7. same selected-session continuity without replay;
8. device selection/headset removal recovery;
9. truthful audio-driven expression/viseme response;
10. Store and macOS permission/entitlement matrices.

Wake words and background listening remain out of scope.
