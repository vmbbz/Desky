# F5d.3 voice playback hardening — 2026-09-01

## Outcome

The user-driven packaged GPT-Live exercises exposed real renderer playback/state defects. Deskiii could bounce between Speaking and Listening at individual realtime frame boundaries, could accept late output again after a clear, and could remain Speaking indefinitely if Web Audio did not deliver a source completion callback. A text-only terminal response could also remain Thinking. A later watchdog then misclassified OpenClaw's leading zero-amplitude transport frames as a silent assistant response and cancelled the still-valid session. The reference launcher also gave Electron the short-lived automation terminal's output pipe, producing an uncaught `EPIPE` after that pipe closed.

Those client defects are fixed and packaged. This record does **not** claim that audible GPT-Live output, interruption, or the complete F5d.3 matrix has passed; the rebuilt package requires the next user-driven microphone exercise.

## Captured failure evidence

- The supplied `glitch-voice-deskii.mp4` is 8.512 seconds at 770 x 800 and visually shows repeated Listening/Speaking state changes with the avatar changing conversational state.
- Its AAC track is effectively silent (approximately -91 dB mean and -90.3 dB peak), consistent with the report that no assistant speech was heard. A screen recorder's audio capture is not authoritative proof of provider output, so this is recorded as supporting evidence only.
- Sanitized Gateway logs show session creation and turn start, followed by final output text approximately 179 seconds later. The inspected interval contains no `output.audio.started` or `output.audio.done` record. OpenClaw deliberately suppresses noisy audio-delta logging, so the absence of deltas is not used as evidence.
- Renderer review found a 15 ms scheduling lead for 20 ms Gateway frames, immediate Listening on any momentarily empty source set, no terminal text-only settlement, no late-frame suppression after clear, and no completion watchdog.
- The later screenshot records the fail-visible silent-audio message and Electron's `EPIPE: broken pipe, write` stack. Gateway chronology shows the client-created session, a premature client cancellation, session closure, and then an append against the released relay identity. Source review found that the relay can publish decoded zero-amplitude comfort frames before genuine provider output; these frames are not proof of a silent response.

## Implemented contract

- Schedule realtime audio behind a 120 ms lead buffer while retaining the existing eight-second queue ceiling.
- Hold a single Speaking phase across sub-300 ms frame gaps; do not restart the avatar's speaking motion for every frame.
- Enter Speaking only for decoded output containing an audible sample rather than silent padding.
- Discard leading zero-amplitude transport/comfort frames for any duration. They cannot own Speaking, consume the eight-second queue, or cancel a live session. Once an audible response begins, silence inside that response retains its timing.
- Settle to Listening after `audio-done` or a final assistant transcript once scheduled playback drains.
- Settle an unexplained drained Speaking queue to Thinking instead of leaving a false Speaking claim.
- On Interrupt or provider `clear`, invalidate playback, clear sources/marks/gap/watchdog timers, and suppress late scoped and unscoped output until the next user-final turn.
- Attempt to resume a suspended Web Audio context when output arrives.
- Bound a missing `onended` callback by scheduled queue duration plus two seconds, clear the dead playback generation, leave Speaking, and surface an output-device diagnostic.
- Clear all output lifecycle state again on stop so restart cannot inherit a prior turn.
- Guard the GUI's optional stdout/stderr streams against `EPIPE` only; unrelated stream errors remain fatal. The packaged reference launcher also starts Deskiii with independent standard handles so its lifetime is not coupled to the automation shell.
- Capture a bounded, opt-in reference timeline of event types, roles, final flags, text lengths, audio byte counts, decoded peaks, and renderer phases. The exercise never writes transcript text, audio content, session ids, turn ids, tokens, or credentials.

## Red-to-green regressions

The new controller suite failed against the pre-fix implementation for all observed lifecycle defects, then passed after the production change:

1. two 20 ms PCM16 frames separated by a normal network gap remain one Speaking phase and settle only after terminal output;
2. a source that never ends exits Speaking through the watchdog and reports the output-device failure;
3. clear resets playback and rejects late scoped and unscoped frames from the cancelled generation;
4. a final assistant transcript with no playable audio returns Thinking to Listening;
5. ten seconds of leading transport silence creates no playback, error, or cancellation, and later audible output enters Speaking normally;
6. closed stdout/stderr pipes do not terminate the GUI, while unrelated stream errors remain visible;
7. 1,500 realtime audio packets aggregate into bounded metadata instead of flooding the evidence record, with no content or native identifiers retained.

## Verification

- Focused voice/pipe evidence suite: 3 files, 10 tests passed.
- Full suite: 100 files passed, 7 skipped; 542 tests passed, 12 skipped.
- TypeScript typecheck passed.
- ESLint passed.
- Production dependency audit: zero reported vulnerabilities.
- `windows-direct` package passed its release-profile and post-package ASAR verifier; four commerce signatures remained absent.
- Rebuilt package: `out/Deskiii-win32-x64/Desky.exe`.
- Post-fix `windows-voice-20260901-044105` completed its full 180-second capture lifecycle with `visualExerciseError=null`, no `EPIPE`, and zero provider or renderer voice activity. It proves the launcher/capture path only and is explicitly excluded from microphone or assistant-output evidence.
- The earlier foreground Gateway was tied to an automation process and disappeared during a later observation. The reference machine now uses OpenClaw's own per-user `OpenClaw Gateway` Scheduled Task, pinned by its generated launcher to supported Node 22.22.3. A clean packaged run after the unusually long 218.5-second plugin startup completed action discovery, Talk catalog discovery, session subscription and history loading. OpenClaw remains an external user-installed runtime and is not present in the Deskiii artifact.

Skipped tests are pre-existing environment, credential, or platform lanes and are not counted as live voice evidence.

## Remaining live gate

With the rebuilt package and authenticated loopback Gateway, prove in order:

1. audible assistant output without state/animation thrash;
2. return to Listening after normal completion;
3. Interrupt during audible playback, with no late audio or speaking state;
4. a second same-session turn after interrupt;
5. provider disconnect and reconnect;
6. input/output device selection and device-removal behavior;
7. only then, audio-driven expression/viseme timing.
