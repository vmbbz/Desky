# F5d.3 voice playback hardening — 2026-09-01

## Outcome

The first user-driven packaged GPT-Live exercise exposed a real renderer playback/state defect. Deskiii could bounce between Speaking and Listening at individual realtime frame boundaries, could accept late output again after a clear, and could remain Speaking indefinitely if Web Audio did not deliver a source completion callback. A text-only terminal response could also remain Thinking.

Those client defects are fixed and packaged. This record does **not** claim that audible GPT-Live output, interruption, or the complete F5d.3 matrix has passed; the rebuilt package requires the next user-driven microphone exercise.

## Captured failure evidence

- The supplied `glitch-voice-deskii.mp4` is 8.512 seconds at 770 x 800 and visually shows repeated Listening/Speaking state changes with the avatar changing conversational state.
- Its AAC track is effectively silent (approximately -91 dB mean and -90.3 dB peak), consistent with the report that no assistant speech was heard. A screen recorder's audio capture is not authoritative proof of provider output, so this is recorded as supporting evidence only.
- Sanitized Gateway logs show session creation and turn start, followed by final output text approximately 179 seconds later. The inspected interval contains no `output.audio.started` or `output.audio.done` record. OpenClaw deliberately suppresses noisy audio-delta logging, so the absence of deltas is not used as evidence.
- Renderer review found a 15 ms scheduling lead for 20 ms Gateway frames, immediate Listening on any momentarily empty source set, no terminal text-only settlement, no late-frame suppression after clear, and no completion watchdog.

## Implemented contract

- Schedule realtime audio behind a 120 ms lead buffer while retaining the existing eight-second queue ceiling.
- Hold a single Speaking phase across sub-300 ms frame gaps; do not restart the avatar's speaking motion for every frame.
- Enter Speaking only for decoded output containing an audible sample rather than silent padding.
- Settle to Listening after `audio-done` or a final assistant transcript once scheduled playback drains.
- Settle an unexplained drained Speaking queue to Thinking instead of leaving a false Speaking claim.
- On Interrupt or provider `clear`, invalidate playback, clear sources/marks/gap/watchdog timers, and suppress late scoped and unscoped output until the next user-final turn.
- Attempt to resume a suspended Web Audio context when output arrives.
- Bound a missing `onended` callback by scheduled queue duration plus two seconds, clear the dead playback generation, leave Speaking, and surface an output-device diagnostic.
- Clear all output lifecycle state again on stop so restart cannot inherit a prior turn.

## Red-to-green regressions

The new controller suite failed against the pre-fix implementation for all observed lifecycle defects, then passed after the production change:

1. two 20 ms PCM16 frames separated by a normal network gap remain one Speaking phase and settle only after terminal output;
2. a source that never ends exits Speaking through the watchdog and reports the output-device failure;
3. clear resets playback and rejects late scoped and unscoped frames from the cancelled generation;
4. a final assistant transcript with no playable audio returns Thinking to Listening.

## Verification

- Focused controller/codec suite: 2 files, 10 tests passed.
- Full suite: 97 files passed, 7 skipped; 532 tests passed, 12 skipped.
- TypeScript typecheck passed.
- ESLint passed.
- Production dependency audit: zero reported vulnerabilities.
- `windows-direct` package passed its release-profile and post-package ASAR verifier; four commerce signatures remained absent.
- Rebuilt package: `out/Deskiii-win32-x64/Desky.exe`.

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
