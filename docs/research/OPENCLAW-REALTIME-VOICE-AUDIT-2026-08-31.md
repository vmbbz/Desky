# OpenClaw realtime voice audit — 2026-08-31

## Decision

Deskiii may consume OpenClaw's authenticated Gateway-relay Talk surface as its first full-duplex voice adapter. It must remain a provider-neutral optional capability, separate from dictation, and must not copy native-client implementation details that weaken desktop queue or lifecycle bounds.

The implementation audit began against the official local OpenClaw checkout:

- repository: `C:\dev-shared\openclaw-projects\openclaw_browser_talk_fixed`;
- commit: `8ac6379011c20702875e5219268b40969c5b90b2`;
- primary contract: `docs/nodes/talk.md`;
- Gateway relay: `src/gateway/talk-realtime-relay-state.ts`, `talk-realtime-relay-operations.ts`, and `talk-realtime-relay-session-create.ts`;
- OpenAI OAuth/session path: `extensions/openai/realtime-quicksilver-session.ts` and `realtime-quicksilver-wire.ts`;
- Android lifecycle reference: `apps/android/app/src/main/java/ai/openclaw/app/voice/TalkModeManager.kt`;
- Apple capture/playback references: `apps/macos/Sources/OpenClaw/VoiceWakeRuntime.swift` and the iOS Talk relay sources.

Provider admission was refreshed against `origin/main` at
`da96a6870f73ec40d8e0fbcc3bfd6b88b7996897` and the official npm packages
`openclaw@2026.8.1` / `@openclaw/codex@2026.8.1`. The historical contribution
checkout remains unchanged and is not the running Gateway.

The public primary reference is <https://docs.openclaw.ai/nodes/talk>.

## Verified upstream behavior

`talk.catalog` is the canonical discovery surface. It reports mode, transport, brain strategy, provider configuration/readiness, audio formats, and barge-in support. Full-duplex Gateway relay uses:

```text
talk.session.create
talk.session.appendAudio
talk.session.cancelOutput
talk.session.acknowledgeMark
talk.session.close
talk.event
```

The admitted topology is `mode=realtime`, `transport=gateway-relay`, and `brain=agent-consult`. The Gateway owns provider credentials and the OpenClaw agent/tool policy. A relay client exchanges bounded audio and normalized events; it does not receive a provider token or direct tool authority.

The OpenAI GPT-Live relay prefers an OpenClaw ChatGPT OAuth profile and extracts its `chatgpt-account-id`. Platform `/v1/live` access remains separately gated. OpenClaw documents an overloaded 403: it can mean an invalid account, model, or voice. Current GPT-Live uses the separate Codex V3 voice contract (`arbor`, `breeze`, `cove`, `ember`, `juniper`, `maple`, `sol`, `spruce`, and `vale`); GA Realtime voices such as `cedar` are not interchangeable. The admitted reference configuration therefore uses `gpt-live-1-codex` with the currently roundtrip-verified `spruce` voice.

OpenClaw enforces session limits and a 30-minute relay TTL. The relay supports input audio, assistant audio, transcript, clear, playback mark, tool progress, error, and close events. Turn-scoped output cancellation is a first-class request, not a text command.

The native clients model Listening, Thinking, and Speaking separately. macOS derives Speaking from playback activity and exposes pause/stop gestures. Android makes dictation, voice-note recording, and Talk mutually exclusive and stops foreground-sensitive capture paths on lifecycle changes. The current Android playback channel is unbounded; Deskiii does not inherit that choice.

## Deskiii mapping

Deskiii adds a distinct `AgentAdapterCapabilities.voiceConversation` contract and bridge rather than widening `voiceInput`. Admission requires the complete method/event set, ready configured provider, Gateway relay, and validated mono PCM16/G.711 input/output formats. Other adapters report unsupported.

Main owns the remote session, exact selected agent session, renderer ownership, native-event filtering, redaction, and provider-rejection downgrade. IPC accepts only canonical bounded base64, identifiers, timestamp, output-cancel, mark acknowledgement, and close commands. Store profiles fail the capability closed.

Renderer capture uses one user gesture, echo cancellation, noise suppression, automatic gain control, negotiated resampling/encoding, and a bounded serialized append queue. It stops rather than dropping delayed microphone audio. Playback uses a bounded eight-second Web Audio schedule; clear/cancel invalidates sources and timers, marks are acknowledged when playback reaches them, and speaking state follows actual scheduled audio.

Text dictation and realtime conversation are globally mutually exclusive. Starting realtime voice replaces the text composer with a dedicated state dock containing only phase, activity, contextual Interrupt, End, and Escape. No wake word, background listener, launch-time capture, or persisted audio is present.

## Live reference-device evidence

The development Gateway at `ws://127.0.0.1:18789` advertises OpenAI realtime Gateway relay, PCM16 24 kHz and G.711 mu-law 8 kHz input/output, agent consultation, and barge-in. The applied Talk configuration is:

```text
provider=openai
model=gpt-live-1-codex
speakerVoice=spruce
mode=realtime
transport=gateway-relay
brain=agent-consult
```

The intended reference profile is now `openai:cosychiruka@gmail.com`, first in the persisted agent-specific order after the operator reported that Runner Courage had exhausted its available usage. Cosy Chiruka was refreshed through the official `openclaw models auth login --provider openai` browser flow and currently expires on 2026-09-10. Runner Courage remains explicitly second rather than being silently selected. Official read-only profile inspection reports OAuth metadata only. No OAuth token, Gateway token, or account-id value was printed or copied into Deskiii.

The current Gateway catalog reports GPT-Live ready, its model-specific voice set, Gateway relay, agent consultation, PCM16 24 kHz and G.711 mu-law 8 kHz input/output, and barge-in. A real `talk.session.create` now succeeds with `gpt-live-1-codex`, `spruce`, and negotiated PCM16 24 kHz. The previous 403 is therefore resolved as a stale voice-contract mismatch, not a proven account-entitlement failure. The CLI probe disconnected immediately after admission, so the Gateway correctly released the connection-owned session; no microphone audio was sent and no assistant-audio or interruption claim is made yet.

## Remaining admission matrix

With GPT-Live authentication and session admission now proven:

1. microphone allow and deny from a clean direct-package profile;
2. user partial/final transcript ordering and assistant transcript correlation;
3. audible assistant PCM/G.711 output and avatar speaking duration;
4. Interrupt during real audible output, with exact turn cancellation and immediate local clear;
5. mark acknowledgement after playback, never at network receipt;
6. output queue overflow, malformed audio, provider error, Gateway disconnect, and window destruction;
7. same selected-session recovery without replay;
8. input/output device selection, headset removal, and default-device recovery;
9. measured expression/viseme response derived from real audio rather than fabricated phonemes;
10. Windows Store manifest/privacy/WACK matrix and macOS hardware/entitlement matrix.

Wake words, background listening, recording retention, voice cloning, and synthetic claims for Codex/Hermes/Claude are outside this gate.
