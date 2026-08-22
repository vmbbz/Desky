# F3b.2 expressive-motion verification — 2026-08-22

## Scope

This record covers the first asset-free expressive motion slice: deterministic conversational and explicit-user cues, full-body ownership/interruption, reduced-motion action behavior, and capability-aware blink/look-at/state expressions. It does not claim an approved external animation clip, natural-language motion selection, speech-synchronized visemes, real binary VRM compatibility coverage, or the final Windows/macOS performance matrix.

## Implemented boundary

- `MotionCueQueue` accepts only the code-defined `emphasis`, `nod`, `wave`, and `jump` vocabulary. It deduplicates IDs, bounds pending work to eight, prefers higher priority, preserves FIFO ties, and will replace a queued gesture—but never a queued action—to admit a new explicit action at capacity.
- `AvatarMotionController` remains the only humanoid body owner. Starting an eligible cue stops the lower-priority state clip, applies one procedural action from captured baselines, and resumes the current normalized plan on completion.
- State priority stays authoritative. Working does not preempt a short explicit action by design; success and the higher error/disconnected/approval/cancelled boundaries interrupt or reject it. The four hard safety/recovery boundaries clear both active and pending cues.
- Entering `speaking` creates one conversational emphasis. The focused ambient controls expose an explicit Wave; double-clicking the measured character target requests Jump. Model output, prompt text, and tool arguments are never inspected for motion selection.
- Reduced motion suppresses external clips and removes queued Jump translation while retaining a small static acknowledgement.
- `AvatarExpressionController` consumes the validated capability inventory. It drives deterministic single/bilateral blink, restrained mode-aware look-at, and small supported preset expressions, then restores authored values and look-at ownership on disposal.
- Optional managers, presets, and look-at degrade to no-ops. Visemes remain unused because Desky does not yet have a truthful speech-timing source.

## Automated verification

| Gate | Result |
| --- | --- |
| Vitest | 21 files passed, 1 opt-in live file skipped; 93 tests passed, 1 live test skipped |
| TypeScript | `tsc --noEmit` passed |
| ESLint | passed |
| Production dependency audit | zero reported vulnerabilities with development dependencies omitted |
| Electron Forge package | fresh Windows x64 package completed |

The cue suite covers deterministic priority/FIFO selection, deduplication, bounded capacity, action preservation, state reconciliation, and hard clearing. Motion-controller tests cover speaking enqueue, explicit Jump ownership, working continuity, approval interruption, reduced-motion no-travel, and authoritative-state rejection. Expression tests cover bilateral blink timing, success expression/restoration, look-at/reduced-motion/disposal, and missing-capability no-op behavior.

## Packaged Windows evidence

The fresh package ran through the production `desky://` renderer in two isolated simulation profiles. Both loaded the licensed remote default as `Milk · VRM 0.x · CC0 · 100Avatars R1`, retained the minimal collapsed ambient surface, reported the expected recovery route, and kept `document.hasFocus() === false`.

The baseline capture showed the neutral idle pose. The action capture dispatched a deliberate double-click on the measured avatar target, waited 500 ms, and visibly captured the procedural Jump in flight with translated body and raised-arm choreography. The controller fixtures independently prove completion returns to the accepted state baseline and that reduced motion removes the translation. Captures, package output, remote model bytes, profiles, and diagnostic JSON are ignored and not committed.

## Remaining evidence and gates

- Add a normalized adapter-side semantic action command before an agent can request Wave/Jump; do not parse natural-language output.
- Obtain explicit owner/reviewer approval for the first commercially/store-redistributable external clip and pass it through the existing source/output provenance manifest.
- Repeat cue, face, gaze, spring-bone, coordinate, foot-contact, and cleanup behavior across legally redistributable binary VRM 0.x/1.0 fixtures.
- Add truthful audio/phoneme timing before enabling visemes, plus the user pause-motion override and F3d lifecycle/performance evidence.
