# F3b.7 reference idle cadence and mesh-drag verification — 2026-08-23

## Reference evidence

The supplied `milky.mp4` is a 29.8-second H.264 capture at 742 × 720 and approximately 57.55 frames per second. Half-second and quarter-second contact sheets were generated outside the repository for review and remain uncommitted.

The reference establishes three useful behaviors:

- the relaxed looking/scanning treatment occupies several seconds rather than reading as a short twitch;
- the raised-arm greeting/affirmation treatment is a distinct occasional one-shot; and
- ordinary horizontal pointer movement over the rendered character rotates the model directly.

The exact original Mixamo asset name cannot be proven from the pixels or the public gallery repository, so Desky does not claim it. The nearest already-admitted CC0 semantic match in Desky is Quaternius `Armature|Yes`; the product label is **Celebration fist pump**. The long relaxed slot uses `Armature|Idle_No_Loop` for three complete repetitions, or 7.5 seconds.

The current [OSA gallery viewer source](https://github.com/ToxSam/os3a-gallery/blob/main/src/components/VRMViewer/VRMViewer.jsx) confirms the manipulation mechanism: pointer-down is raycast against the avatar scene, a mesh hit disables orbit controls, and horizontal pointer delta rotates the avatar around Y. Desky adopts the mesh-hit decision but keeps renderer/model rotation and main-process native-window movement as separate capabilities.

## Implemented contract

- `assets/animation-library.plan.json` defines one three-slot `primary-idle` cycle.
- Slots 0 and 1 select `long-look-around`; slot 2 selects `celebration-fist-pump`.
- Cycle membership, length, and slot ownership are parsed and validated. A mode cannot mix exact-cycle and weighted selection, contain competing cycles, or leave a slot unowned.
- Interruptions reset the quiet timer but do not skip the pending cycle position.
- Rich sit/chat, magic, dance, phone, locomotion, crouch, and search programs remain admitted catalog entries but cannot fire randomly.
- The avatar stage exposes a synchronous Three.js mesh raycast to the surface interaction controller.
- Direct mesh drag rotates with no modifier. A miss inside the measured hit bounds moves the native window. Shift/Alt still forces rotation, the focused grip always moves, wheel/arrow keys rotate, and Home resets yaw.
- The five-pixel threshold and post-manipulation click suppression continue to protect click-to-compose and double-click Jump.

## Automated evidence

- Scheduler regression proves the exact `look`, `look`, `celebrate` order.
- Library regression proves two ambient programs, the three-slot ownership map, three complete look repetitions, and catalog-only rich edge cases.
- Parser validation rejects incomplete, mixed, inconsistent, or competing cadence definitions.
- Manipulation regression proves mesh-hit rotation, transparent-space movement, and modifier rotation fallback.
- The packaged manipulation harness exercises transparent-space native movement and unmodified mesh rotation through the real ambient pointer handlers. The packaged idle-cycle harness observes program entry/exit until the exact three-slot sequence completes.
- Packaged Windows diagnostics recorded `long-look-around,long-look-around,celebration-fist-pump`, an active third-slot cue, Full motion, and no clip/preference error. A separate 9.24-second capture recorded the first 7.5-second look program active; a one-second-in celebration capture showed the raised hand/fist pose rather than only the program boundary.
- Packaged manipulation diagnostics recorded both a native-window bounds delta and 72.8 degrees of persisted yaw from the unmodified direct-mesh drag.
- Rebuilt plan SHA-256: `b6001495d44e666264d6552c69d6306d0623836a7933606025a56a45421becaa`; generated 84-clip library SHA-256: `f568b11f6c002f81c7cf789d0f7ed3f4b9783eecb4566c82e2a0c9b89a149088`.

## Remaining manual gates

- Watch at least two complete three-slot cycles on Milk at normal frame rate and tune only plan metadata if the quiet intervals or selected CC0 motions do not match the reference feel.
- Repeat raycast manipulation on materially different licensed VRM 0.x and 1.0 silhouettes, including thin limbs, skirts, props, and extreme proportions.
- Complete mixed-DPI, multi-monitor, macOS, touch/pen, screen-reader, and reduced-motion evidence.
