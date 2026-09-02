# F5d.3 voice playback hardening — 2026-09-01

## Outcome

The user-driven packaged GPT-Live exercises exposed real renderer playback/state defects. Deskii could bounce between Speaking and Listening at individual realtime frame boundaries, could accept late output again after a clear, and could remain Speaking indefinitely if Web Audio did not deliver a source completion callback. A text-only terminal response could also remain Thinking. A later watchdog then misclassified OpenClaw's leading zero-amplitude transport frames as a silent assistant response and cancelled the still-valid session. The reference launcher also gave Electron the short-lived automation terminal's output pipe, producing an uncaught `EPIPE` after that pipe closed.

Those client defects are fixed and packaged. A later user-driven exercise now proves normal audible GPT-Live input/output and completion. This record does **not** claim that live interruption/recovery or the complete F5d.3 matrix has passed.

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
- Preserve up to 500 ms of consecutive zero-amplitude audio inside an audible response, then discard any longer continuous comfort tail. The continuous WebRTC media clock therefore cannot leave playback queued or the avatar stuck Speaking after the provider's final transcript.
- Settle to Listening after `audio-done` or a final assistant transcript once scheduled playback drains.
- Settle an unexplained drained Speaking queue to Thinking instead of leaving a false Speaking claim.
- On Interrupt or provider `clear`, invalidate playback, clear sources/marks/gap/watchdog timers, and suppress late scoped and unscoped output until the next user-final turn.
- Attempt to resume a suspended Web Audio context when output arrives.
- Bound a missing `onended` callback by scheduled queue duration plus two seconds, clear the dead playback generation, leave Speaking, and surface an output-device diagnostic.
- Clear all output lifecycle state again on stop so restart cannot inherit a prior turn.
- Guard the GUI's optional stdout/stderr streams against `EPIPE` only; unrelated stream errors remain fatal. The packaged reference launcher also starts Deskii with independent standard handles so its lifetime is not coupled to the automation shell.
- Capture a bounded, opt-in reference timeline of event types, roles, final flags, text lengths, audio byte counts, decoded peaks, and renderer phases. The exercise never writes transcript text, audio content, session ids, turn ids, tokens, or credentials.

## Red-to-green regressions

The new controller suite failed against the pre-fix implementation for all observed lifecycle defects, then passed after the production change:

1. two 20 ms PCM16 frames separated by a normal network gap remain one Speaking phase and settle only after terminal output;
2. a source that never ends exits Speaking through the watchdog and reports the output-device failure;
3. clear resets playback and rejects late scoped and unscoped frames from the cancelled generation;
4. a final assistant transcript with no playable audio returns Thinking to Listening;
5. ten seconds of leading transport silence creates no playback, error, or cancellation, and later audible output enters Speaking normally;
6. closed stdout/stderr pipes do not terminate the GUI, while unrelated stream errors remain visible;
7. 1,500 realtime audio packets aggregate into bounded metadata instead of flooding the evidence record, with no content or native identifiers retained;
8. a two-second continuous comfort tail schedules less than 500 ms after real audio and settles to Listening after the final transcript;
9. Interrupt clears audible output, rejects late packets from that turn, and admits a completed second turn in the same session.

## Verification

- Focused voice/pipe evidence suite: 3 files, 12 tests passed.
- Full suite: 100 files passed, 7 skipped; 544 tests passed, 12 skipped.
- TypeScript typecheck passed.
- ESLint passed.
- Production dependency audit: zero reported vulnerabilities.
- `windows-direct` package passed its release-profile and post-package ASAR verifier; four commerce signatures remained absent.
- Rebuilt package: `out/Deskii-win32-x64/Desky.exe`.
- Post-fix `windows-voice-20260901-044105` completed its full 180-second capture lifecycle with `visualExerciseError=null`, no `EPIPE`, and zero provider or renderer voice activity. It proves the launcher/capture path only and is explicitly excluded from microphone or assistant-output evidence.
- The earlier foreground Gateway was tied to an automation process and disappeared during a later observation. The reference machine now uses OpenClaw's own per-user `OpenClaw Gateway` Scheduled Task, pinned by its generated launcher to supported Node 22.22.3. A clean packaged run after the unusually long 218.5-second plugin startup completed action discovery, Talk catalog discovery, session subscription and history loading. OpenClaw remains an external user-installed runtime and is not present in the Deskii artifact.
- `windows-voice-20260901-113320` proved the actual microphone boundary was non-silent (`inputPeakPcm16=24385`) and the provider returned non-silent output (`outputPeakPcm16=16728`) with final user and assistant transcripts. It also exposed the continuous post-response comfort tail: the renderer still reported Speaking near capture end.
- After bounding that tail, `windows-voice-20260901-113934` proved two real assistant responses in one session, non-silent microphone input (`inputPeakPcm16=32097`), non-silent provider output (`outputPeakPcm16=15871`), final user/assistant transcripts, `Speaking -> Thinking -> Listening`, and bubble dismissal. The final visible capture is Listening with no visual-exercise error. This closes normal audible-output and normal-completion recovery on the packaged Windows-direct/OpenClaw OAuth path.
- `windows-voice-20260901-182305` then proved another non-silent 180-second session (`inputPeakPcm16=32766`, `outputPeakPcm16=12396`). The greeting finalized normally. The second, 22-character user request also finalized, but GPT-Live returned only a 29-character acknowledgement; sanitized Gateway events contained no native delegation and no agent run. This is not a Deskii microphone or playback failure. The evidence capture itself ended at 182,205 ms and exposed a recorder validation bug because the renderer bound stopped exactly at 180,000 ms. The recorder now permits only 10 seconds of bounded finalization overhead while retaining the 180-second requested observation ceiling; 190,001 ms is rejected by regression.
- The adjacent current OpenClaw source runtime now has native-first delegation recovery at commit `21a29a5f0`: a missing native event starts the same Gateway-owned bounded consult after 250 ms, native events during the grace win, pre-final/native event ordering does not duplicate, late native events are ignored after fallback delivery, and teardown cancels pending work. The OpenClaw owner/lifecycle suite passes 54 tests with one Bun-only skip; changed-file Oxlint and the OpenAI extension TypeScript project pass. A broad upstream extension helper remains blocked outside this patch by TS7056 in `packages/gateway-protocol/src/schema/protocol-schemas.ts`.
- The selected OpenClaw OAuth profile was reauthenticated on 2026-09-01 and the corrected source Gateway reached `started`/ready with the OpenAI, Talk, and Desky-actions plugins loaded. Packaged capture `windows-voice-20260901-200830` authenticated, discovered Talk, created a realtime session, and delivered 7,720,960 microphone bytes, but no user transcript finalized and all returned PCM was silent. It is therefore an explicit inconclusive observation, not a fallback or barge-in pass. A subsequent capture never entered voice mode and is excluded.
- Later interactive logs identified two concrete faults. Ordinary speech barge-in called `talk.session.cancelOutput`; OpenClaw recorded `turn.cancelled` and deliberately closed the relay session after its cancellation drain, so Deskii correctly returned to text mode. Deskii now clears only local playback and continues streaming the interrupting frame, allowing GPT-Live/Frameless Bidi to interrupt from incoming audio without closing the microphone session. Separately, a late native delegation aborted an already-running fallback skills consult with `GPT-Live delegation superseded`, followed by cleanup reporting `agent harness host capability is no longer active`. OpenClaw commit `0988619cc` now preserves the in-flight fallback and ignores that late native duplicate. Both focused regressions pass; fresh live proof remains required.

Skipped tests are pre-existing environment, credential, or platform lanes and are not counted as live voice evidence.

## Remaining live gate

With normal audible output and completion proved, the newly selected OpenClaw account reauthenticated, and the patched source Gateway restarted, continue in order:

1. a real three-skills result rather than an acknowledgement-only turn;
2. natural speech barge-in during audible playback, with no late audio or speaking state;
3. a second same-session turn after barge-in;
4. provider disconnect and reconnect;
5. input/output device selection and device-removal behavior;
6. only then, audio-driven expression/viseme timing.
