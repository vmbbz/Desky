# F5d.1 voice-input foundation — 2026-08-31

## Result

The provider-neutral streaming-dictation foundation is implemented for direct Deskii builds. OpenClaw is the first admitted provider. Voice input remains an explicit, user-initiated draft-authoring control: it does not run in the background and never sends a message automatically.

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
8. Electron admits microphone access only for the known Deskii main-frame renderer URL on the ambient or Control Center surface. Video, display capture, subframes, and foreign origins remain denied.
9. Gateway method discovery is provisional with respect to provider credentials. A missing/unconfigured provider on session creation downgrades the connection to `setup-required` and disables capture until reconnect.

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
| Full Vitest suite | 96 files passed, 7 skipped; 520 tests passed, 12 skipped |
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

## Reference-device live attempt

The packaged direct build was exercised against OpenClaw `2026.8.1` from the absolute `openclaw_browser_talk_fixed` checkout on the Windows reference device.

- Gateway health passed on `127.0.0.1:18789`; `talk-voice` and `openai` loaded without plugin errors.
- Deskii authenticated from saved access, negotiated the four Talk methods/events, and enabled its microphone control.
- The first capture exposed a packaged custom-origin normalization defect: Electron supplied `desky://app/` while the predicate admitted only `desky://app`. Windows global and non-packaged microphone policy were both `Allow`. The predicate now compares the parsed `desky:` scheme and exact `app` host while retaining its no-credentials, no-port, audio-only, main-frame and known-surface constraints.
- After that correction, microphone capture passed Electron/Windows admission and reached `talk.session.create`.
- Session creation then failed with `No realtime transcription provider registered`. The local OpenClaw account has an OAuth profile but no API-key profile. OpenClaw's current OpenAI transcription-only provider requires an OpenAI Platform API key; its conversational realtime OAuth path is a different mode and would not preserve Deskii's edit-before-Send guarantee.
- Deskii now treats this class of error as configuration evidence: it downgrades voice to `setup-required`, disables repeated capture, and instructs the user to configure the Gateway provider and reconnect. The UI no longer labels method discovery as provider-ready.
- The rebuilt Windows-direct package passed the ASAR profile verifier, reconnected to the absolute-checkout Gateway, reproduced the provider error, disabled the microphone control, and displayed the bounded setup guidance above.
- Restoring the intended runner-first `.openclaw-dev` state exposed a pre-existing OpenClaw v17 additive-schema drift. A native SQLite snapshot was integrity-checked before repair; the exact canonical `context_eligible` and `route_context_json` columns plus invalidation trigger were restored transactionally, after which official `openclaw doctor --repair --yes --non-interactive` completed the supported v17 -> v19 migration. Gateway health then passed with `runnercourage@gmail.com` first in the OpenAI profile order.
- The extended outage also exposed a Deskii invariant mismatch: background reconnect attempts could exceed Adapter Contract v1's maximum of 100, causing an explicit Connect to be rejected before socket creation. The host now saturates the normalized counter at 100, continues its bounded-delay recovery loop, and resets the counter before emitting a user-initiated `connecting` state. A 105-attempt regression proves both the saturation and successful explicit recovery.

Therefore the packaged permission-allow/provider-boundary path passes, but live partial/final transcript, explicit finish, cancellation, disconnect during capture, and edit-before-Send remain blocked on an admitted transcription credential. No message or agent turn was sent during this attempt.
