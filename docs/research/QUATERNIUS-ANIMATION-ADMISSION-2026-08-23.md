# Quaternius animation admission audit — 2026-08-23

## Decision

Use the free Standard editions of Quaternius Universal Animation Library 1 and 2 as Desky's first built-in candidate animation source. Both included `License.txt` files declare CC0 1.0, the author pages explicitly allow personal, educational, and commercial use, and the project owner approved admission on 2026-08-23.

The free downloads do **not** contain the advertised full Pro inventories. Each Standard FBX contains 43 named clips. Desky excludes `Armature|A_TPose` from each source and generates 84 canonical clips. It does not claim to bundle 120+, 130+, Pro, or Source-tier files.

## Exact source evidence

| Source | Archive SHA-256 | Non-root-motion FBX SHA-256 | FBX clips |
| --- | --- | --- | ---: |
| [Universal Animation Library Standard](https://quaternius.itch.io/universal-animation-library) | `cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724` | `21b32d912da3cb93426d974fb945e86f5b2e86970acd2ce89905e0fbf9f1dcc2` | 43 |
| [Universal Animation Library 2 Standard](https://quaternius.itch.io/universal-animation-library-2) | `4008ea208a604773a2b2177d965f0f5d3195498b5bf838c3f5785d68e95f2a68` | `d26d0e9f4a202d473194c056045143095a605a53ba1d823ef24055be4b86851d` | 43 |

Both FBXs use the Quaternius universal humanoid rig and a Z-up authoring coordinate system. Converter profile `quaternius-uam-v1` maps 52 normalized humanoid rotation bones plus hips position, rotates position through the rest parent into Y-up, and records the exact source clip name. `Idle_Loop` produces 53 canonical tracks at 30 Hz and a source rest hips height of `0.916700005531311`.

The deterministic generated catalogue initially hashes to `d882d5cd3525a1f2ad2c4bd4c9756db4b81768bcd7afce15ccd2d7014b9db1a5` and contains 84 clips, three state bindings, and fifteen programs. Rebuild verification must reproduce that hash unless the reviewed plan or converter changes deliberately.

## Coverage of the eleven OSA gallery previews

These are semantic comparisons, not claims that the animation is identical.

| OSA preview | Standard-library coverage | Decision |
| --- | --- | --- |
| Bored | `Idle_FoldArms_Loop` | Strong near-match; ambient program `bored-fold-arms` |
| Cross Jumps | `Jump_Start` + `Jump_Land`, `NinjaJump_*` | Partial; explicit Jump program, not labelled Cross Jumps |
| Fight Idle | `Sword_Idle`, `Pistol_Idle_Loop`, `Idle_Shield_Loop` | Strong category match; catalog-only because combat must not fire randomly |
| Jumping Rope | none | Gap; do not substitute Dance or Jump deceptively |
| Looking | no specifically named looking clip | Gap; procedural gaze remains truthful fallback |
| Looking Around | no specifically named looking-around clip | Gap; procedural look-around remains truthful fallback |
| Magic Spell Casting | `Spell_Simple_Enter/Idle_Loop/Shoot/Exit` | Strong sequence match; rare ambient `magic-trick` |
| Offensive Idle | `Sword_Idle`, `Spell_Simple_Idle_Loop` | Category match; combat candidate stays catalog-only |
| Searching Files High | `Interact`, `PickUp_Table` | Partial; ambient `search-high` is labelled as a near-match |
| Standing Magic Attack | `Spell_Simple_Shoot` | Strong category match inside `magic-trick` |
| Texting While Standing | `Idle_TalkingPhone_Loop` | Adjacent phone behavior, explicitly labelled `texting-adjacent` rather than exact |

If ToxSam later supplies clear redistribution terms for the exact OSA clips, they can enter as another reviewed library without changing scheduler or gateway contracts.

## Rich catalogue policy

The complete generated clip catalogue includes idle, talking, walking, formal walking, jogging, sprinting, crouching, sitting transitions/loops, swimming, jumping, rolling, pushing, driving, carrying, climbing, sliding, dancing, phone use, interaction, repair, farming, magic, melee, sword, shield, pistol, injury, zombie, consume, death, and other edge-case motions.

Only twelve programs are ambient-eligible, all only in normalized `idle`, and each has file-defined weights, quiet windows, and cooldowns. State, approval, cancellation, user/agent action, preview, and reduced-motion ownership remain higher priority. Combat, weapons, injury, death, props, swimming, driving, farming, and incomplete transition programs cannot be selected autonomously.

`LayToIdle` is retained as `sleep-transition-candidate`, catalog-only. Its name does not prove a complete sleep loop or reversible recovery, so Desky will not advertise or autonomously trigger sleeping until packaged visual review identifies a safe enter/hold/exit sequence.

## Remaining release evidence

- Visually review every enabled program on Milk and representative rights-cleared VRM 0.x/1.0 binary fixtures.
- Confirm feet, hips height, coordinate direction, hands/fingers, loop seams, sequence transitions, avatar proportions, and interruption recovery.
- Disable or tune individual programs in the file plan when a motion assumes a missing prop or unsuitable human proportions.
- Capture packaged Windows and macOS CPU, memory, reduced-motion, hide/occlusion, sleep/wake, and WebGL recovery evidence.
