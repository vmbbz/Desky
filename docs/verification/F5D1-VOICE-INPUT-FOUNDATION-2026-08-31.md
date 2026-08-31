# F5d.1 voice-input foundation — 2026-08-31

## Result

The provider-neutral streaming-dictation foundation is implemented for direct Deskiii builds. OpenClaw is the first admitted provider. Voice input remains an explicit, user-initiated draft-authoring control: it does not run in the background and never sends a message automatically.

This record proves the contract, permission boundary, failure handling, tests, and packaged Windows-direct artifact. It does **not** claim that a human microphone/provider matrix has passed.

## Source basis

The implementation was checked against the current local OpenClaw client source and current public protocol documentation:

- `ui/src/pages/chat/composer-dictation.ts` in the local official OpenClaw checkout for transcription-session identity, 8 kHz G.711 mu-law capture, serialized append calls, and teardown behavior;
- `ui/src/pages/chat/realtime-talk-gateway-relay.ts` and `realtime-talk-input.ts` for the separate future full-duplex relay boundary;
- [OpenClaw Talk mode](https://docs.openclaw.ai/nodes/talk) and [Gateway protocol](https://docs.openclaw.ai/gateway/protocol) for the admitted Talk/Gateway surface;
- [Electron session permissions](https://www.electronjs.org/docs/latest/api/session) and [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security) for main-owned permission checks;
- [Microsoft capability declarations](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/app-capability-declarations) for the Store manifest boundary.

## Admitted architecture

1. `AgentAdapterCapabilities.voiceInput` is the only renderer authority. Available means exact streaming transcription, `g711_ulaw`, and 8000 Hz.
2. OpenClaw becomes available only when the negotiated Gateway surface includes `talk.session.create`, `talk.session.appendAudio`, `talk.session.close`, and `talk.event`.
3. One explicit microphone click opens one stream. Capture requests echo cancellation, noise suppression, and automatic gain control.
4. Audio is converted to bounded G.711 mu-law chunks and serialized. At most 20 4096-sample appends may wait; overload cancels instead of growing memory without limit.
5. Main owns the provider session and renderer owner. The registry pins the session to the runtime that created it, including cleanup during an adapter switch. Separate remote session and transcription identities are preserved and foreign events are ignored.
6. Partial and final text update the shared in-memory draft. The user can edit it and must press Send normally.
7. Stop, Escape, permission failure, provider error, backlog, disconnect, surface destruction, or component teardown stops local tracks and closes or discards the remote session.
8. Electron admits microphone access only for the known Deskiii main-frame renderer URL on the ambient or Control Center surface. Video, display capture, subframes, and foreign origins remain denied.

## Release-profile policy

- `windows-direct`: capability may become available after provider negotiation.
- `windows-store-free`: capability is projected unsupported. The current generated MSIX does not declare microphone access, so its UI must not promise it.
- direct macOS: the package contains an `NSMicrophoneUsageDescription`; hardware permission evidence remains open.
- Mac App Store: audio-input entitlement, review copy, and hardware evidence remain open.
- Codex, Hermes, and Claude: voice remains unsupported until each has an admitted native streaming-transcription contract or an independently reviewed local transcription runtime.

## Verification

Executed in `C:\dev-shared\desky` on 2026-08-31:

| Check | Result |
| --- | --- |
| TypeScript | passed, `tsc --noEmit` |
| ESLint | passed |
| Full Vitest suite | 96 files passed, 7 skipped; 518 tests passed, 12 skipped |
| Production dependency audit | zero reported vulnerabilities with `npm audit --omit=dev` |
| Windows direct package | passed |
| ASAR release-profile verifier | `windows-direct`, verified; four commerce signatures absent |

The test set covers G.711 reference encoding, transcript composition, bounded payload admission, microphone-origin/media/frame rejection, capability-contract rejection, direct/Store routing, OpenClaw negotiation, create/append/close, distinct transcription identity, foreign-event rejection, normalized partial/final events, and remote closure.

## Required live evidence

Before F5d.1 can be called operationally complete, run the freshly packaged direct build with a Gateway that advertises the admitted transcription methods and record:

- first-run microphone allow and deny;
- partial and final transcript behavior;
- editing before Send and proof that no automatic Send occurs;
- explicit finish and Escape cancellation;
- disconnect, provider error, backlog, and surface-destruction cleanup;
- a second/fresh Windows account or clean-device permission lifecycle.

F5d.2 is separate: provider audio output, bounded playback, assistant-turn correlation, barge-in, device selection, truthful speaking/viseme state, and privacy controls. Wake words and background listening are not admitted.
