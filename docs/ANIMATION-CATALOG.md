# Animation catalog

This is the human-readable inventory for Desky's generated animation library. The generated asset remains the runtime source of truth.

## Runtime policy

- **Idle/disconnected:** `Looking Around` (11.4 seconds, loop, sole full-body owner).
- **Thinking:** `Interact` (Search/Interact loop).
- **Speaking:** `Idle Talking Loop`.
- **Working:** `Fixing Kneeling`.
- **Autonomous variety:** only `Idle TalkingPhone Loop` (Phone Check), `Walk Formal Loop`, and rare `Dance Loop` are eligible. Selection does not range across the full catalog.
- **Typed action:** Jump is the `Jump Start` -> `Jump Land` sequence. Wave remains procedural until an admitted authored Wave clip exists.
- `Idle FoldArms Loop`, `Idle No Loop`, combat, prop, injury, death, locomotion, sitting, sleep, and magic clips are catalog-only unless a later typed context and visual review admits them.

Every full-body state, program, preview, or action goes through the same mixer/body-owner arbitration. Additive blink, gaze, expression, and future visemes are separate capabilities; no second full-body idle may be layered over the active idle.

## Admitted built-in clips

The current total is **85**: 84 CC0 Quaternius clips plus the transformed Mixamo `Looking Around` clip. Source FBXs are build inputs and are not committed or exposed as downloadable assets.

### Looking Around

- Looking Around — 11.40 s — idle state — Adobe Mixamo licence reference

### Quaternius Universal Animation Library Standard v3

- Crouch Fwd Loop — 2.00 s
- Crouch Idle Loop — 2.93 s
- Dance Loop — 1.00 s
- Death01 — 2.40 s
- Driving Loop — 1.67 s
- Fixing Kneeling — 5.20 s
- Hit Chest — 0.33 s
- Hit Head — 0.43 s
- Idle Loop — 2.50 s
- Idle Talking Loop — 2.93 s
- Idle Torch Loop — 1.27 s
- Interact — 2.00 s
- Jog Fwd Loop — 0.93 s
- Jump Land — 1.27 s
- Jump Loop — 2.50 s
- Jump Start — 1.33 s
- PickUp Table — 0.83 s
- Pistol Aim Down — 0.17 s
- Pistol Aim Neutral — 0.17 s
- Pistol Aim Up — 0.17 s
- Pistol Idle Loop — 1.67 s
- Pistol Reload — 1.67 s
- Pistol Shoot — 0.63 s
- Punch Cross — 1.00 s
- Punch Jab — 0.87 s
- Push Loop — 2.67 s
- Roll — 1.47 s
- Sitting Enter — 1.30 s
- Sitting Exit — 1.03 s
- Sitting Idle Loop — 1.67 s
- Sitting Talking Loop — 2.93 s
- Spell Simple Enter — 0.53 s
- Spell Simple Exit — 0.43 s
- Spell Simple Idle Loop — 2.10 s
- Spell Simple Shoot — 0.50 s
- Sprint Loop — 0.67 s
- Swim Fwd Loop — 1.33 s
- Swim Idle Loop — 3.33 s
- Sword Attack — 1.53 s
- Sword Idle — 1.67 s
- Walk Formal Loop — 1.33 s
- Walk Loop — 1.33 s

### Quaternius Universal Animation Library 2 Standard v2.1

- Chest Open — 1.37 s
- ClimbUp 1m — 0.67 s
- Consume — 1.33 s
- Farm Harvest — 2.50 s
- Farm PlantSeed — 2.77 s
- Farm Watering — 3.80 s
- Hit Knockback — 0.83 s
- Idle FoldArms Loop — 2.50 s
- Idle Lantern Loop — 2.50 s
- Idle No Loop — 2.50 s
- Idle Rail Call — 2.50 s
- Idle Rail Loop — 2.50 s
- Idle Shield Break — 1.07 s
- Idle Shield Loop — 2.50 s
- Idle TalkingPhone Loop — 2.93 s
- LayToIdle — 1.53 s
- Melee Hook Rec — 0.60 s
- Melee Hook — 0.47 s
- NinjaJump Idle Loop — 2.00 s
- NinjaJump Land — 1.27 s
- NinjaJump Start — 0.97 s
- OverhandThrow — 1.33 s
- Shield Dash — 1.10 s
- Shield OneShot — 0.83 s
- Slide Exit — 0.50 s
- Slide Loop — 2.00 s
- Slide Start — 0.83 s
- Sword Block — 1.23 s
- Sword Dash — 1.57 s
- Sword Heavy Combo — 4.33 s
- Sword Regular A Rec — 0.97 s
- Sword Regular A — 0.43 s
- Sword Regular B Rec — 1.03 s
- Sword Regular B — 0.53 s
- Sword Regular C — 2.00 s
- Sword Regular Combo — 3.00 s
- TreeChopping Loop — 0.97 s
- Walk Carry Loop — 2.00 s
- Yes — 2.50 s
- Zombie Idle Loop — 1.33 s
- Zombie Scratch — 1.80 s
- Zombie Walk Fwd Loop — 1.33 s

Both Quaternius authoring T-poses are intentionally excluded.

## Gallery reference clips

The gallery exposed eleven separate FBXs during the 2026-08-23 audit. `LookingAround.fbx` is now the admitted idle source; the remaining ten stay ignored research inputs and do not ship:

- Bored — 9.833 s
- Cross Jumps — 2.033 s
- Fight Idle — 1.333 s
- Jumping Rope — 2.367 s
- Looking — 8.733 s
- Magic Spell Casting — 4.267 s
- Offensive Idle — 13.533 s
- Searching Files High — 9.733 s
- Standing Magic Attack — 4.300 s
- Texting While Standing — 11.800 s

See `docs/research/OSA-ANIMATION-AUDIT-2026-08-23.md` for hashes, technical inspection, and rights boundaries.
