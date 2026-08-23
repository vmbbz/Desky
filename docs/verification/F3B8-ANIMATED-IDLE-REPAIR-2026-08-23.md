# F3b.8 animated idle repair verification — 2026-08-23

## Failure reproduced

The previous plan made `Idle_Loop` the connected idle state and gave the autonomous scheduler only `Idle_No_Loop` and `Yes`. In the visible product this read as an arms-sideways rest punctuated by repeated head motion and thumbs-up. A separate arbitration gap made the result worse before a gateway session was selected: `disconnected` had no registered state clip, so the controller restored the imported avatar pose between programs.

## Corrective contract

- `Idle_FoldArms_Loop` is the admitted looping idle state.
- `disconnected` inherits the admitted idle clip when it has no purpose-authored state clip, without losing disconnected priority or status semantics.
- `Idle_No_Loop` and `Yes` are catalog-only and cannot fire autonomously.
- Search/Interact, Formal Walk, and rare Dance Break are the only autonomous programs admitted for Milk.
- The weighted pool is a shuffled bag until every admitted program has appeared once. Weighting and cooldowns apply without allowing a favourite to hide the remaining repertoire.
- Crouch/Search was returned to catalog-only after its packaged Milk capture showed unacceptable limb stretching.

## Automated evidence

- Motion-arbiter coverage proves the disconnected plan retains disconnected priority while selecting the admitted animated idle loop.
- Scheduler coverage proves immediate-repeat exclusion and proves every ambient program is selected once before weighted reuse.
- Built-in library coverage proves the folded-arm idle registration, exactly three autonomous programs, and catalog-only status for head-motion, thumbs-up, and crouch candidates.
- The final complete suite passed 133 tests with one explicitly skipped live-environment test; typecheck, lint, and Windows packaging also passed.

## Packaged Windows evidence

The ignored packaged baseline diagnostic reported:

- `avatarState: ready`;
- `avatarTextureCount: 1`;
- `motionMode: disconnected`;
- `motionStateClip: uam2-idle-fold-arms-loop-v1`;
- `motionReduced: false`; and
- no motion clip or preference error.

The baseline capture visibly showed Milk's arms folded across the body instead of the imported arms-sideways posture. The final autonomous harness then recorded `search-high,formal-walk,dance-break` before any reuse and wrote a separate ignored frame for each program. All three admitted frames stayed inside the 423 by 583 ambient surface with sane Milk proportions. The rejected crouch frame and all other screenshots, diagnostic JSON, application data, generated package output, source FBX files, and downloaded avatar files remain ignored and uncommitted.

## Remaining gate

This admission is specific to Milk. Every materially different avatar silhouette still needs the same per-program visual matrix before sharing this autonomous set. The user-facing animation-intensity preference must operate on admitted program categories and reduced-motion policy; it must not re-enable catalog-only clips globally.
