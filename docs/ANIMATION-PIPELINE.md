# Animation conversion pipeline

## Purpose

Desky converts authoring-time Mixamo-style FBX animation into a small, deterministic, avatar-neutral JSON clip. Runtime code binds that canonical clip to the selected VRM's normalized humanoid. Source FBX files and prompt-generated conversions are never runtime or release inputs by accident.

The converter is an offline developer/release tool. It is not exposed to the sandboxed renderer and it does not execute agent-provided files.

## Contracts

The pipeline has four independent boundaries:

1. `mixamo-source.ts` parses FBX and extracts a known humanoid map, source rest rotations, track data, and source hips height.
2. `convert-mixamo.ts` resamples and retargets the source into the canonical coordinate system.
3. `canonical-animation.ts` validates and serializes the versioned runtime format.
4. `animation-manifest.ts` admits only provenance-bearing output with an explicit approved rights review.

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

The command writes `<clip-id>.json` and `<clip-id>.manifest.json` through same-directory temporary files. Existing output is refused unless the caller explicitly passes `--force`. The output manifest includes both source and canonical SHA-256 values, converter version, retargeting contract, root-motion policy, and review identity.

The example values are syntax illustrations, not an approved Desky asset. A URL, marketplace download, Mixamo account, or repository location is not itself redistribution permission.

## Runtime binding

Runtime binding validates the canonical payload again before creating Three.js tracks:

- each canonical bone resolves to the target VRM's normalized node name;
- missing optional bones are skipped;
- hips translation scales to the target normalized rest height;
- VRM 0.x receives the required X/Z coordinate conversion; and
- a target with no supported tracks fails visibly.

The motion arbiter will own mixers, layer priority, fades, cancellation, and lifecycle. This converter does not choose animations from model text or agent output.

## Release gate

No production animation is admitted until all of these are true:

1. The owner or qualified reviewer confirms commercial/store redistribution and modification rights.
2. Source and output hashes match the manifest.
3. Conversion is repeated and produces identical canonical bytes.
4. The clip passes foot-contact, hips-scale, coordinate, reduced-motion, and representative VRM 0.x/1.0 playback checks.
5. Attribution and third-party notices are present where required.

Synthetic tests and uncommitted smoke files prove engineering behavior only. They never satisfy the rights gate.
