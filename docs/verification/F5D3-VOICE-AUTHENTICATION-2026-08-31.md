# F5d.3 voice authentication and session admission — 2026-08-31

## Outcome

The reference Windows-direct environment now passes the OpenClaw GPT-Live authentication, model, voice, Gateway relay, and session-creation boundary. This record does not claim microphone input, assistant audio, or successful barge-in; those require the user-driven packaged exercise.

## Root cause corrected

The earlier `403 Voice session access denied` was treated too narrowly as an account-entitlement failure. Current official OpenClaw documents that this response is overloaded and that GPT-Live uses a voice contract distinct from GA Realtime. The old configuration combined `gpt-live-1-codex` with GA voice `cedar`.

The repaired configuration is:

```text
provider=openai
model=gpt-live-1-codex
speakerVoice=spruce
mode=realtime
transport=gateway-relay
brain=agent-consult
```

`spruce` is in the current GPT-Live Codex V3 voice set and has an upstream ChatGPT OAuth speech-roundtrip record.

## Authentication and runtime

- Refreshed `openai:cosychiruka@gmail.com` using the official `openclaw models auth login --provider openai` flow after the operator reported the previous Runner Courage account had exhausted its available usage.
- Put the Cosy Chiruka profile first in the agent-specific auth order while retaining Runner Courage only as the explicit second profile.
- Installed official `openclaw@2026.8.1` without changing the historical upstream contribution checkout.
- Installed and pinned official `@openclaw/codex@2026.8.1` after reviewing its declared boundary. Optional computer use, native plugin access, raw transcripts, supervision, and write controls remain off.
- Persisted the previously approved 64-character local Gateway token into the dev profile without printing it.
- Verified Deskiii's OS-encrypted saved endpoint and credential only by equality/metadata checks; no secret value was logged.
- Started one Gateway on the saved loopback endpoint `127.0.0.1:18789`.

## Live evidence

Gateway health reports:

- `ok: true`, no plugin errors or unavailable plugins;
- `codex`, `openai`, and `talk-voice` loaded;
- default agent model `openai/gpt-5.4` through the installed Codex runtime.

`talk.catalog` reports:

- realtime ready with active provider `openai`;
- `gpt-live-1-codex` and the model-specific Codex V3 voice list;
- Gateway relay plus agent consultation;
- PCM16 24 kHz and G.711 mu-law 8 kHz mono input/output;
- truthful barge-in support.

An authenticated `talk.session.create` returned:

```text
provider=openai
model=gpt-live-1-codex
voice=spruce
transport=gateway-relay
brain=agent-consult
input=pcm16/24000/mono
output=pcm16/24000/mono
```

The same bounded admission probe passed again after the 2026-08-31 switch to `openai:cosychiruka@gmail.com`. The OAuth expiry changed during the official browser callback, the persisted order was read back as Cosy first, Gateway health remained clean after restart, and no credential value was printed.

The CLI connection closed immediately after the bounded probe, so the Gateway released its connection-owned session. No audio frames were sent and no persistent provider session was left behind.

## Remaining packaged exercise

1. Connect the already launched Deskiii package to the saved local profile.
2. Start live voice from the headset control and grant microphone access.
3. Prove user and assistant transcript order plus audible output.
4. Speak over audible output and verify immediate local clear plus exact turn cancellation.
5. Verify playback mark timing, Stop, Gateway loss, recovery, and no replay.
6. Repeat microphone denial and surface-destruction cleanup.

Direct Hermes, Claude, and Codex adapters do not expose realtime audio. They can be used as the agent brain behind OpenClaw Talk without adding another Deskiii microphone implementation; OpenClaw remains the normalized speech/consultation boundary.
