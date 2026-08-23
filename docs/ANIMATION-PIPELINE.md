# Animation conversion pipeline

## Purpose

Desky converts authoring-time Mixamo-style or explicitly reviewed universal-humanoid FBX animation into a small, deterministic, avatar-neutral JSON clip. Runtime code binds that canonical clip to the selected VRM's normalized humanoid. Source FBX files and prompt-generated conversions are never runtime or release inputs by accident.

The converter is an offline developer/release tool. It is not exposed to the sandboxed renderer and it does not execute agent-provided files.

## Contracts

The pipeline has four independent boundaries:

1. `mixamo-source.ts` parses FBX and extracts a known humanoid map, source rest rotations, track data, and source hips height.
2. `convert-mixamo.ts` resamples and retargets the source into the canonical coordinate system.
3. `canonical-animation.ts` validates and serializes the versioned runtime format.
4. `animation-manifest.ts` admits only provenance-bearing output with an explicit approved rights review.

The converter currently recognizes the original `mixamo` rig profile and the reviewed `quaternius-uam-v1` profile. A source profile selects only a bone-name map; both emit the same canonical VRM 1.0 normalized-humanoid contract. For Z-up sources, hips positions are rotated through their rest parent into Y-up before height normalization. The exact profile and animation name are recorded in every manifest.

The bundled command-line entry point is built from `src/tools/animation/cli.ts`. Generated tooling and output stay under ignored `out/` paths unless a separately reviewed asset is deliberately added later.

## Retargeting model

The Mixamo humanoid map follows the upstream `three-vrm` example. For each source quaternion key:

```text
canonicalRotation = parentRestWorldRotation
                  * sourceAnimationRotation
                  * inverse(boneRestWorldRotation)
```

This is the parent-rest-world formula used by the upstream [`loadMixamoAnimation.js`](https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm-core/examples/humanoidAnimation/loadMixamoAnimation.js). Desky makes the result avatar-neutral instead of converting directly for one target VRM.

Hips translation is stored in dimensionless source-height units:

```text
canonicalHipsPosition = sourceHipsPosition / sourceRestHipsHeight
```

At runtime, `create-vrm-animation-clip.ts` multiplies those values by the selected VRM's normalized rest hips height. It also applies the upstream X/Z sign conversion only for VRM 0.x. The canonical file therefore remains in VRM 1.0 normalized-humanoid coordinates and can be reused across compatible avatars.

## Determinism

Given identical input bytes and options, the converter emits identical canonical bytes:

- sample times come from integer sample indices and the declared rate;
- times are quantized to 0.00001 seconds and transform values to 0.0000001 units;
- quaternions are normalized and kept in one continuous hemisphere;
- tracks are sorted by canonical humanoid order, then property;
- the compact JSON property order is fixed and terminated by one newline; and
- timestamps and review metadata live in the manifest, not the canonical clip.

The manifest is also reproducible when the caller supplies the same explicit UTC timestamps and metadata.

## Root motion

Root-motion policy is explicit:

- Default conversion stores vertical hips motion and sets horizontal X/Z translation to zero. This is appropriate for an in-place desktop companion.
- `--include-root-motion` preserves dimensionless X/Z hips translation for deliberately spatial choreography.
- The flag is recorded in the manifest and cannot be changed at runtime without selecting different admitted output.

Vertical motion remains available in both modes so a jump, crouch, or body-weight change is not flattened.

## Input admission

The current FBX boundary requires:

- one animation named `mixamo.com`, or exactly one animation in the file;
- recognizable Mixamo humanoid names, including common namespace separators;
- a finite, non-zero source hips height;
- finite and ordered quaternion/position keys;
- a duration greater than zero and no more than 120 seconds; and
- no conflicting duplicate rig rest transforms.

Only humanoid quaternion tracks and hips position are retained. Unsupported tracks are counted and reported by inspect mode. A conversion with no supported tracks fails.

## Inspect without admitting an asset

Build and inspect a local FBX:

```powershell
npm run build:animation-converter
npm run animation:converter -- inspect -- --input C:\path\animation.fbx
```

Multi-clip sources are explicit rather than guessed:

```powershell
npm run animation:converter -- list -- --input C:\path\library.fbx
npm run animation:converter -- inspect -- --input C:\path\library.fbx `
  --source-profile quaternius-uam-v1 `
  --source-clip "Armature|Idle_Loop"
```

Inspect mode parses and converts entirely in memory. It prints source size/hash, duration, hips height, mapped bones, supported/ignored counts, canonical track count, and canonical SHA-256. It writes no clip or manifest and makes no licensing claim.

Optional inspection arguments:

```powershell
npm run animation:converter -- inspect -- --input C:\path\animation.fbx --sample-rate 60 --include-root-motion
```

## Convert an approved source

Conversion is intentionally verbose because release metadata must not be guessed:

```powershell
npm run animation:converter -- convert -- `
  --input C:\reviewed\wave.fbx `
  --output-dir C:\reviewed\desky-output `
  --clip-id wave-v1 `
  --clip-version 1 `
  --intent action `
  --layer action `
  --playback one-shot `
  --sample-rate 30 `
  --source-url https://authoritative.example/wave.fbx `
  --source-license CC0-1.0 `
  --source-creator "Example Animator" `
  --source-fetched-at 2026-08-22T12:00:00.000Z `
  --converted-at 2026-08-22T12:10:00.000Z `
  --rights-reviewer release-owner `
  --reviewed-at 2026-08-22T12:15:00.000Z
```

Use `--source-profile` and `--source-clip` for a reviewed multi-clip FBX. The exact name must exist; ambiguous multi-clip files still fail closed.

## Rebuild the built-in library

The committed plan is `assets/animation-library.plan.json`. It pins the authoritative pages, archive and FBX hashes, expected source clip counts, exclusions, source selections, semantic state bindings, autonomous cycles/quiet windows, weighted fallback policy, action programs, sequence steps, rights reviewer, and deterministic timestamps. Raw ZIP/FBX downloads remain ignored developer inputs.

After obtaining the exact reviewed Standard archives:

```powershell
npm run animation:converter -- build-library -- `
  --plan assets/animation-library.plan.json `
  --output src/assets/animations/quaternius-uam-standard-v1.library.json `
  --workspace-root .
```

The command parses each source FBX once, verifies its SHA-256 and clip count, excludes authoring T-poses, converts every other source clip, emits per-clip provenance, and writes one atomic runtime catalogue. Repeating the build from the pinned sources must reproduce the exact output hash.

The command writes `<clip-id>.json` and `<clip-id>.manifest.json` through same-directory temporary files. Existing output is refused unless the caller explicitly passes `--force`. The output manifest includes both source and canonical SHA-256 values, converter version, retargeting contract, root-motion policy, and review identity.

The example values are syntax illustrations, not an approved Desky asset. A URL, marketplace download, Mixamo account, or repository location is not itself redistribution permission.

## Runtime binding

Runtime binding validates the canonical payload again before creating Three.js tracks:

- each canonical bone resolves to the target VRM's normalized node name;
- missing optional bones are skipped;
- hips translation scales to the target normalized rest height;
- VRM 0.x receives the required X/Z coordinate conversion; and
- a target with no supported tracks fails visibly.

The motion arbiter owns mixer selection, full-body state priority, fades, cancellation, and lifecycle. This converter does not choose animations from model text or agent output.

## Runtime arbitration

The first F3b runtime is split into two renderer modules:

- `motion-arbiter.ts` admits rights-reviewed clips and is the pure semantic boundary. It receives one or more normalized companion states plus admitted clip registrations and returns exactly one full-body plan.
- `avatar-motion-controller.ts` binds that plan to the loaded VRM, owns its `AnimationMixer`, applies loop/one-shot policy, performs clip-to-clip fades, and disposes mixer state with the avatar.

The priority order is intentional: cancellation, approval, and disconnection outrank error, success, active work, conversational states, and idle. A cancellation never starts another clip: it stops the current action immediately, restores controlled transforms, and enters a stable cancelled pose. The adapter host independently rejects late nonterminal events after the terminal event, so stale tool output cannot restart motion.

Admission is fail-closed. `admitMotionClip` parses the canonical clip and approved animation manifest again, requires matching clip ID, state intent, `state` layer, sample rate, and playback contract, then hashes the canonical serialized bytes and compares them with output provenance. Cancellation does not accept a full-body clip. Callers cannot construct the branded runtime registration directly.

Selection after admission is exact and deterministic. Registrations match a normalized state, lower explicit `order` wins, and equal order is resolved by canonical `clipId`. Raw assistant text, tool arguments, and model-selected labels are not animation selectors. Invalid target bindings fail to the state’s procedural pose without blocking the agent turn.

When no reviewed clip is registered, every state has a small procedural treatment derived from the avatar’s post-load baseline. Those movements are deterministic trigonometric offsets, not unbounded random behavior. The controller captures the relaxed avatar pose after model fitting, reapplies offsets without cumulative drift, and restores that baseline during cancellation and disposal.

The first expressive extension remains inside this ownership boundary. A bounded queue accepts only code-defined cues, selects higher priority then FIFO, and never runs two body motions together. Conversational `emphasis`/`nod`, explicit user or agent `wave`/`jump`, and low-priority autonomous `look-around`/`weight-shift`/`stretch`/`ambient-wave` all enter this same queue. A file-authored cue crossfades from the lower-priority state, plays every step for its complete canonical duration plus any declared hold, crossfades adjacent steps over 220 ms, and then crossfades back to the current state or settles to the procedural baseline over 320 ms. Hard approval, cancellation, disconnection, error, or a higher-priority state still interrupts immediately. Speaking entry schedules exactly one emphasis; a focused Wave control and deliberate character double-click request actions. Prompt text, assistant output, and tool arguments are not selectors. These procedural motions contain no third-party animation asset.

The autonomous scheduler is deliberately bounded rather than an endless action loop. State clips remain continuous where their file contract says `loop`; one reviewed program is then selected after its file-defined quiet interval. A validated cadence can assign exact cycle slots, while uncadenced libraries retain weighted, cooldown-aware selection with immediate-repeat exclusion. A companion mode cannot silently mix the policies or declare incomplete/competing cycles. The current desktop baseline is the authored `Idle_FoldArms_Loop`, including while disconnected, so connectivity can never expose the imported arms-out pose. Weighted ambient programs select Search/Interact most often, an in-place Formal Walk less often, and a rare Dance Break. The weighted pool behaves as a shuffled bag until every admitted program has appeared once, so a favourite cannot hide the rest of the repertoire. `Idle_No_Loop` and `Yes` remain catalog-only because packaged review showed that their former two-look/one-celebration cadence appeared as repetitive head motion and thumbs-up. Crouch/Search is also catalog-only after Milk-specific visual review exposed unacceptable limb stretching. Entering a meaningful state, local preview, reduced motion, or an explicit action resets the quiet interval. Code contains timing, priority, validation, interruption, transition, and accessibility policy—not animation filenames.

The first catalogue is generated from the free Standard editions of Quaternius Universal Animation Library 1 and 2. Their two FBX files expose 43 animations each; both authoring T-poses are excluded, leaving 84 exact canonical clips. Three visually admitted programs are ambient-eligible in `idle` and `disconnected`; every other program remains catalog-only until its target-proportion review passes. Rich sit/chat, magic, phone, crouch, search, combat, weapon, injury, death, swimming, driving, farming, climbing, carrying, and incomplete sleep-transition clips therefore cannot fire randomly merely because they exist in the catalogue. Jump resolves to a reviewed two-clip program. Wave retains its deterministic procedural fallback because the acquired Standard inventories contain no Wave clip.

The live Open Source Avatars gallery's eleven FBX previews are not Desky defaults. Desky reuses the audited runtime-retargeting technique, but the deployed FBX files have no per-file provenance or redistribution record in the public repository. Once a clip passes the release gate below, it can replace a procedural semantic slot without changing scheduling or priority. Until then, hotlinking or silently caching the gallery's files would weaken offline reliability, storefront review, and the asset contract.

`avatar-expression-controller.ts` separately applies only capabilities reported by the admitted VRM. It uses a deterministic blink interval sequence, small mode-aware gaze, and restrained available-preset expressions. It restores previous expression/look-at values on disposal and is a no-op when the manager or preset is absent. This additive layer does not own humanoid body tracks, and it does not synthesize visemes without a truthful speech-timing source.

The renderer subscribes to `prefers-reduced-motion`. In reduced-motion mode it suppresses registered full-body clips, removes time-varying travel and bounce (including Jump translation), neutralizes gaze, and retains only a small static semantic/action acknowledgement plus the readable state label. The control center defaults to System and exposes explicit Full and Reduced session overrides; app restart returns to the system preference. A durable account-level preference and independent pause control remain F3d work.

## Session-only local VRMA preview

The control center has a separate user-triggered preview lane for a local `.vrma`. This is not production asset admission and does not bypass the canonical FBX pipeline:

- only the control-center surface can open the native file chooser or request replay/clear;
- main validates the `.vrma` extension, 32 MiB cap, binary glTF 2.0 header and exact length, bounded JSON chunk, `VRMC_vrm_animation` declaration, usable hips/humanoid channel map, animation/node/accessor counts, and absence of external buffer/image URIs;
- the raw filesystem path never crosses IPC; the renderer receives basename, size, SHA-256, and exact bytes only;
- bytes and metadata remain in main-process memory for the current app session and are cleared explicitly or on exit;
- the ambient renderer parses with the exact-version-pinned `@pixiv/three-vrm-animation` loader and bounds the resulting clip to 120 seconds and 256 tracks; and
- playback uses `AvatarMotionController`'s existing mixer as a one-shot action owner. It suspends Desky's additive expression controller during the preview and restores the avatar baseline afterward. A newly entered approval, cancellation, disconnection, or error state interrupts it; pending approval and effective reduced motion block a new preview. A deliberate user preview may otherwise start from a stable offline/error/terminal screen, so animation testing does not require a provider connection.

Replay state is reported back to the control center with a monotonic request identity, so late parse/playback reports cannot overwrite a newer selection. No assistant text or agent command can invoke this local-file lane.

The live Open Source Avatars gallery currently uses runtime-retargeted FBX rather than VRMA. See `docs/research/OSA-ANIMATION-AUDIT-2026-08-23.md` for the implementation and rights audit.

## Admission and Store release gates

Rights/hash admission into development and beta builds requires:

1. The owner or qualified reviewer confirms commercial/store redistribution and modification rights.
2. Source and output hashes match the manifest.
3. Conversion is repeated and produces identical canonical bytes.
4. Attribution and third-party notices are present where required.

Store release additionally requires:

1. Every enabled state/action/ambient program passes foot-contact, hips-scale, coordinate, interruption, and reduced-motion checks.
2. Representative rights-cleared VRM 0.x and 1.0 binary fixtures pass playback across materially different proportions.
3. Context-sensitive catalog entries remain unreachable until their product trigger and recovery sequence are reviewed.

Synthetic tests and uncommitted smoke files prove engineering behavior only. They never satisfy the rights gate.
