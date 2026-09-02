# F5d.4a provider voice admission correction — 2026-09-01

## Outcome

The provider-neutral cascade architecture remains valid, but no direct Hermes, Codex, or Claude speech runtime is currently admitted. An earlier planning statement incorrectly treated Hermes Dashboard/Desktop audio routes as routes on the already admitted Hermes `/v1` API Server. They are separate server surfaces and cannot share trust, capability, lifecycle, or release evidence by assumption.

This correction is fail-closed. It removes no working voice feature: OpenClaw remains the only implemented speech path, while Hermes, Codex, and Claude already reported both voice contracts unsupported.

## Exact provider disposition

| Direct agent | Verified provider surface | Release state |
| --- | --- | --- |
| Hermes | Pinned `gateway/platforms/api_server.py` advertises `audio_api: false` and `realtime_voice: false`. `/api/audio/transcribe` and `/api/audio/speak-stream` are implemented by separate `hermes_cli.web_server`. | Voice remains unsupported. Prefer a future versioned `/v1` audio contract; otherwise separately admit the Dashboard/Desktop server or another speech runtime. |
| Codex | Official app-server docs require `experimentalApi` for experimental methods. Pinned official source labels every `thread/realtime/*` audio method and event experimental. | Native voice remains lab-only. Stable Codex text may later be surrounded by an independently admitted cascade speech runtime. |
| Claude | Official Agent SDK documents programmatic text/tool streaming. Claude Code voice dictation is an interactive transcription feature requiring Claude.ai authentication; it is unavailable with the API-key topology Deskii admits and does not provide assistant speech output. | Voice remains unsupported. Claude may enter cascade only after authenticated agent/package admission and independent speech-runtime admission. |

Primary evidence:

- [Codex app-server experimental boundary](https://developers.openai.com/codex/app-server/)
- [Pinned Codex realtime methods](https://github.com/openai/codex/blob/6478a751fde8884b2fdc76486fe23175a8e795d4/codex-rs/app-server/README.md#L386)
- [Pinned Hermes API Server capability flags](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/platforms/api_server.py#L3361-L3366)
- [Pinned Hermes Dashboard/Desktop audio server](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/hermes_cli/web_server.py#L5175)
- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [Claude Code voice dictation restrictions](https://code.claude.com/docs/en/voice-dictation)

## Universal cascade compatibility

Hermes, Codex, and Claude can all participate on the agent side of the same cascade:

```text
microphone -> admitted STT -> final transcript -> selected AgentAdapterRuntime
           -> normalized visible assistant text -> admitted TTS -> speakers
```

That compatibility is conditional on the existing text adapter and a separate `SpeechRuntime`; it is not a native provider voice claim. The coordinator must preserve the selected adapter's tools, approvals, cancellation, reconnect, and exactly-once terminal semantics. A speech/agent pairing cannot be exposed until it passes authenticated microphone permission, transcription, audible output, tool/approval coexistence, interruption during thinking and playback, disconnect/crash, stale-event suppression, same-session recovery, and clean-package lifecycle evidence.

## Product guard

- Hermes, Codex, and Claude retain `voiceInput.availability: unsupported` and `voiceConversation.availability: unsupported`.
- Their transports remain `none`; full-duplex formats remain empty and barge-in remains false.
- Renderer controls are therefore unavailable rather than optimistically exposed.
- No provider instruction or system-prompt update is required for cascade voice.
- No external gateway, Python runtime, local speech model, or Claude executable is added to the base package by this correction.

## Verification

- Focused Hermes/Codex/Claude adapter and contract matrix: 4 files, 29 tests passed.
- Full repository suite: 98 files passed, 7 skipped; 536 tests passed, 12 skipped.
- TypeScript typecheck passed.
- ESLint passed.
- Production dependency audit reported zero vulnerabilities.

## Next implementation gate

1. Finish the real OpenClaw F5d.3 audible/barge-in/recovery matrix.
2. Extract that proven lifecycle behind `SpeechRuntime` and `VoiceCoordinator` without behavior drift.
3. Select the first cascade speech topology and pin its authentication, billing identity, privacy, version/capability, output format, cancellation, and failure contracts.
4. Prove Hermes and Codex separately against that runtime; Claude follows only after its existing agent/package gate.
