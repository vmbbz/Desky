# Voice provider topology and package-size audit — 2026-09-01

## Result

The scalable design is one Deskii speech plane composed with the selected agent adapter. Voice itself does not require a heavyweight dependency in the base application. OpenClaw, Hermes, and Codex remain external runtimes; Claude is the exception because its current direct Agent SDK admission topology needs a large platform executable, which remains excluded from ordinary packages.

This is a source/protocol disposition, not live proof that Hermes, Codex, or Claude voice currently works in Deskii. OpenClaw is the only implemented speech path, and its post-hardening audible F5d.3 matrix remains open.

## Current provider matrix

| Agent route | Official/current speech evidence | Deskii release decision | Base-installer impact |
| --- | --- | --- | --- |
| OpenClaw Gateway | Admitted Talk catalog/session/event relay with realtime agent consultation | Keep as the first coupled realtime speech runtime; finish the live matrix | No gateway or model bundled; current Web Audio/WebSocket code only |
| Hermes API Server | The admitted `/v1` server explicitly reports `audio_api: false` and `realtime_voice: false`; voice routes are on a separate Dashboard/Desktop web server | Keep direct Hermes voice disabled. Prefer a future versioned `/v1` audio contract; otherwise admit the second server as a separate speech runtime with a full security/lifecycle matrix | No Hermes/Python/model payload in Deskii; external Hermes may install optional voice dependencies |
| Codex app-server | Current pinned official source contains experimental `thread/realtime/start`, audio append/output, transcript, stop, and voice-list methods | Lab probe only until the surface is stable and published; otherwise use an admitted cascade speech runtime around the stable text adapter | No Codex executable bundled today; schema/bridge work is small |
| Claude Agent SDK | Official Agent SDK documents text/tool streaming, not programmatic audio. Interactive Claude Code dictation requires Claude.ai login, is unavailable with an API key, and provides transcription rather than assistant speech | Use an independently admitted cascade speech runtime after Claude's authenticated adapter gate; do not claim native Claude voice | Voice adds no large library, but the current Claude agent executable would add 337,745,056 bytes and stays excluded |

Primary references:

- [Codex app-server documentation](https://developers.openai.com/codex/app-server/) describes the stable/experimental opt-in boundary. The stable published API overview does not list `thread/realtime/*`; pinned official source revision `6478a751fde8884b2fdc76486fe23175a8e795d4` marks the realtime methods experimental.
- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) and [streaming-output reference](https://code.claude.com/docs/en/agent-sdk/streaming-output) document the programmatic text/tool event surface. [Claude Code voice dictation](https://code.claude.com/docs/en/voice-dictation) is an interactive CLI/VS Code transcription feature, requires Claude.ai authentication, and is explicitly unavailable with API-key, Bedrock, Vertex, or Foundry configurations.
- [Hermes voice mode](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/voice-mode.md) documents continuous voice, relay/client-direct topology, VAD, and barge-in.
- [Hermes streaming TTS](https://github.com/NousResearch/hermes-agent/blob/main/docs/streaming-tts.md) documents sentence-chunked provider synthesis and raw PCM streaming. The admitted local source pin is `057dcdf236f8a6a26721c10fcc6ccb72726e272a`.
- At that pin, [`gateway/platforms/api_server.py`](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/gateway/platforms/api_server.py#L3361-L3366) reports both audio capability flags false, while [`hermes_cli/web_server.py`](https://github.com/NousResearch/hermes-agent/blob/057dcdf236f8a6a26721c10fcc6ccb72726e272a/hermes_cli/web_server.py#L5175) owns the `/api/audio/*` routes.

## Security disposition

Hermes's official desktop can fetch resolved STT/TTS configuration, including a provider credential, through `GET /api/audio/voice-config` and call providers directly. Deskii will not use that path. The current relay endpoints are also not silently reusable: they are served by `hermes_cli.web_server`, whereas Deskii's admitted Hermes adapter connects to `gateway.platforms.api_server` under `/v1`. A future implementation must either add/admit audio on the `/v1` server or model the web server as a separate authenticated speech runtime. Tokens, TLS policy, capability discovery, origin policy, reconnect, and shutdown must be proved independently.

The shared cascade path must enforce:

1. Explicit user gesture and OS microphone permission.
2. One global capture/playback owner across all windows and adapters.
3. Bounded recording, upload, transcript, text, synthesis, and playback queues.
4. Exact speech-runtime and agent-runtime generation identities; no stale audio or transcript replay.
5. User-visible naming when the speech runtime differs from the agent runtime.
6. Transcription enters the ordinary agent `send` boundary; private reasoning and raw tool/approval data never enter TTS.
7. Interruption cancels the active agent turn only through its admitted cancellation semantics and independently invalidates current playback.
8. No wake word, launch-time capture, or background listening without a later privacy/lifecycle gate.

## Exact Windows-direct size baseline

`npm run make:windows:direct:dev` completed on 2026-09-01 and its release verifier passed.

| Artifact | Exact bytes | Approximate size |
| --- | ---: | ---: |
| Installed package directory | 387,571,359 | 387.57 MB |
| `resources/app.asar` | 13,197,736 | 13.20 MB |
| Squirrel setup executable | 148,328,448 | 148.33 MB |
| Full Squirrel update package | 147,282,790 | 147.28 MB |

The installer is 65,536 bytes larger than the recorded 2026-08-26 development installer; that delta spans every intervening product change and must not be attributed solely to voice. It remains 46,671,552 bytes below the committed 195,000,000-byte direct-installer budget.

The ASAR has only these payload classes: compiled main bundle, compiled renderer bundle, preload bundle, renderer HTML/licence output, package metadata, and an empty packaged `node_modules` directory. The lockfile contains no OpenClaw, Hermes, Whisper, sounddevice, Python, or local speech-model dependency. The exact OpenClaw playback-hardening commit changed no package manifest.

Release verification now also rejects exact external-runtime payloads such as `claude.exe`, `openclaw.mjs`, Python launchers, Hermes CLI packages, `faster_whisper`, and CTranslate2 from ordinary Windows packages. This complements the existing ASAR policy, which already rejects Claude SDK and commerce signatures from admitted release artifacts.

## Implementation gates

### F5d.4a — speech-plane extraction

- Introduce a main-owned `SpeechRuntime`/registry and `VoiceCoordinator` without changing the renderer voice contract.
- Move global dictation/conversation exclusion and session ownership out of `AgentAdapterRegistry`.
- Adapt current OpenClaw Talk behind the new runtime.
- Prove identical permission, overflow, interruption, stale-event, adapter-switch, disconnect, and surface-destruction behavior.

### F5d.4b — cascade speech-runtime selection and admission

- Select one release topology: a versioned Hermes `/v1` audio extension, a separately admitted Hermes Dashboard/Desktop speech server, an operator-supplied speech provider, or a Deskii-hosted speech relay.
- Reject any topology that exports resolved upstream provider credentials to the renderer, reuses an agent token across an unproved server boundary, or adds a hidden local model/runtime payload.
- Implement bounded recorded-audio transcription and streaming TTS behind `SpeechRuntime` only after version, capability, authentication, billing identity, privacy, and failure semantics are pinned.
- Compose transcript -> selected agent text run -> normalized assistant deltas -> synthesis.
- Prove VAD, barge-in during thinking and playback, approval/tool coexistence, Stop, disconnect, same-session recovery, and server-side credential isolation.
- Run local and packaged Windows matrices; remote HTTPS remains a separate operational matrix.

### F5d.4c — cross-agent cascade

- Allow the admitted cascade speech runtime to surround Codex, Hermes, and later Claude text adapters.
- Pin both runtime identities for the session and disclose the pairing in UI/diagnostics.
- Prove each agent's approval, cancellation, reconnect, and exactly-once terminal semantics remain authoritative.

### F5d.4d — Codex realtime watch gate

- Maintain a non-production version/schema probe for `thread/realtime/*` only if explicitly enabled.
- Promote native Codex voice only after the API is stable, documented, version-admitted, and passes the full packaged audio matrix.

### F5d.4e — Claude voice and distribution gate

- First complete Claude's authenticated text/tool/package matrix with an authorized API key.
- Use cascade speech; do not reuse interactive Claude Code dictation or add a fake Claude-native voice capability.
- Keep the 337,745,056-byte executable outside the base installer. Select and verify either an optional signed direct provider pack or a hosted topology before registering Claude in a release profile.
