# ADR 0012 — Separate speech runtimes from agent adapters

## Status

Accepted for the F5d.4 foundation on 2026-09-01. OpenClaw remains the only admitted speech runtime until its live F5d.3 matrix closes and each later runtime passes the gates below.

## Context

Deskiii currently implements microphone capture, output playback, transcript projection, interruption, and cleanup through optional methods on the active `AgentAdapterRuntime`. That is correct for OpenClaw Talk because the Gateway owns both realtime speech and agent consultation. It is not a durable multi-provider boundary:

- The admitted Hermes `/v1` API Server exposes the text/run protocol but explicitly advertises `audio_api: false` and `realtime_voice: false`. Hermes's STT/TTS routes live on the separate Dashboard/Desktop web server and do not share the admitted server contract or lifecycle.
- Claude Agent SDK exposes text, tools, approvals, and cancellation but no programmatic audio transport. Claude Code's interactive dictation is a separate CLI feature that requires Claude.ai authentication, is unavailable with the API-key topology Deskiii admits, and does not provide assistant speech output.
- Codex app-server has a realtime audio surface in current source, but it is experimental and absent from the stable published API overview.
- Duplicating microphone, VAD, playback, and barge-in controllers inside every agent adapter would create inconsistent privacy and lifecycle behavior.

## Decision

Deskiii will evolve from adapter-owned voice methods to one provider-neutral speech plane:

```text
microphone / Web Audio
        |
        v
VoiceCoordinator -------------- one owner, one lifecycle, one UI state machine
        |
        +-- coupled realtime SpeechRuntime
        |      OpenClaw Talk owns speech + agent consultation
        |
        +-- cascade SpeechRuntime
               STT -> active AgentAdapterRuntime -> normalized text deltas -> TTS
```

- `AgentAdapterRuntime` continues to own sessions, model text, tools, approvals, cancellation, and reconnect.
- A future `SpeechRuntime` owns only speech capability discovery, capture/session transport, transcription, synthesis, audio events, and speech-specific cancellation.
- `VoiceCoordinator` owns the cross-plane transaction: one global microphone/output owner, bounded queues, user-gesture permission, VAD/barge-in policy, generation invalidation, adapter/speech-runtime pinning, and teardown.
- Coupled realtime is allowed only when the speech runtime owns the complete consultation topology. The first instance is OpenClaw Talk. It cannot be mislabeled as direct Codex, Claude, or Hermes voice merely because OpenClaw consults a similarly named model.
- Cascade voice converts a final user transcript into the same ordinary `send` command as typed input. It synthesizes only normalized user-visible assistant text and never private reasoning, raw tool arguments, approval secrets, or diagnostics.
- Barge-in while an agent turn is active requests that adapter's admitted cancellation path. Barge-in during playback invalidates and stops only the current synthesis generation before submitting the next transcript. No user audio or text is replayed after reconnect.
- A speech runtime may be selected independently from the active agent only after both advertise compatible cascade capability. The UI must name both roles when they differ.
- Provider credentials stay in the owning main-process runtime. Renderer code receives normalized audio/text events only.

## Provider decisions

- **OpenClaw:** keep the admitted coupled realtime mapping and existing dictation mapping. Extract behind `SpeechRuntime` without changing its wire contract only after F5d.3 audible/barge-in/recovery evidence passes.
- **Hermes:** keep voice disabled on the admitted `/v1` adapter. The preferred future route is a versioned audio contract on that same API Server. A second choice is to admit the Dashboard/Desktop web server as a distinct `SpeechRuntime` with its own endpoint, authentication, version, TLS, reconnect, and shutdown matrix. Deskiii must never assume the `/v1` bearer token authorizes that server and must never request resolved provider credentials from `/api/audio/voice-config`.
- **Codex:** keep direct voice disabled in production while `thread/realtime/*` requires the experimental API. A version-pinned laboratory probe may track it, but experimental success cannot promote the release capability. Stable direct Codex voice can use that native surface later; until then Codex may participate only as the agent side of an admitted cascade speech runtime.
- **Claude:** the Agent SDK remains an agent-only runtime. Its interactive CLI dictation is not reusable by an API-key SDK client and supplies no TTS/full-duplex contract. Claude voice requires the shared cascade speech plane and an independently admitted speech runtime after the Claude agent gate closes.
- **Cross-agent cascade:** the lowest-coupling route for Hermes, Codex, and Claude is an agent-independent speech runtime—operator-supplied, Deskiii-hosted, or a separately admitted vendor speech server. It must have its own disclosed credential/billing identity and pass the complete audio matrix before any provider's controls become available.

## Distribution and size decision

- OpenClaw, Hermes, and Codex remain separately installed/operator-run dependencies. Their executables, Python environments, native audio libraries, and models are not part of the Deskiii base artifact.
- Deskiii speech uses Electron Web Audio and the existing WebSocket/network stack. New speech runtimes must not add a local ML model or native audio engine to the base installer without a separate profile, byte budget, licence/SBOM review, and explicit user consent.
- The 337,745,056-byte Claude admission executable remains excluded from ordinary release packages. It cannot enter the base `windows-direct` or Store-free artifact under the current byte budget. Promotion requires either a separately signed optional direct-download provider pack or a reviewed hosted topology; Store profiles require their own certification decision.
- Local Hermes `faster-whisper` is an operator choice in the external Hermes installation. Its approximately 150 MB base model is not a Deskiii download, cache, update, or uninstall responsibility.

## Consequences

- Voice behavior stays coherent across providers and does not require edits to OpenClaw/Hermes/Claude/Codex instruction files.
- Hermes, Codex, and Claude can all participate as the agent side of cascade voice without changing their instruction files, but this is an architectural compatibility claim—not current runtime proof.
- No direct non-OpenClaw voice capability may be registered until its exact speech runtime and agent pairing passes authenticated capture, audible output, tool/approval coexistence, interruption, reconnect, crash, stale-event, and packaged lifecycle evidence.
- The extraction is a real architecture gate, not a type-only placeholder: current OpenClaw behavior must remain green before any second speech runtime is registered.
