# Avatar and asset policy

## Registry integration

Desky uses the public [ToxSam/open-source-avatars](https://github.com/ToxSam/open-source-avatars) registry as its first discovery source.

The registry is metadata and URLs, not a bundled runtime or animation library. Integration follows its multi-file schema:

1. Fetch `data/projects.json`.
2. Filter public collections and supported licences.
3. Fetch the selected project's `avatar_data_file`.
4. Join `avatar.project_id` to its project before exposing the avatar.
5. Use `model_file_url` and `thumbnail_url` exactly as published.

Catalog and model network access is owned by `src/main/avatar-asset-broker.ts`, not the sandboxed WebGL renderer. The broker permits only HTTPS model URLs on the reviewed registry host set, rejects credentials and non-default ports, caps catalog/model bytes, and applies a bounded timeout. Typed IPC returns the joined catalog record and exact model bytes; it does not expose a general URL-fetch command.

The project licence applies to its avatars. The registry's CC0 licence applies only to registry metadata, documentation, and reference integration code.

## Initial licence policy

- Built-in/default recommendations: CC0 only until attribution UI is complete.
- CC-BY catalog entries: visible only after attribution storage and display ship.
- Unknown, custom, non-commercial, or conflicting terms: rejected by default.
- NFT origin is descriptive provenance, not a licence.
- A user may import a local VRM only after acknowledging that they hold necessary rights.

This is a conservative product policy, not legal advice. Release counsel or a qualified reviewer should approve final commercial asset policy.

## Asset manifest

Every cached or distributed asset receives a sidecar record:

```ts
interface AssetProvenance {
  schemaVersion: 1;
  assetId: string;
  kind: "avatar" | "animation" | "thumbnail" | "audio";
  sourceUrl: string;
  sourceProject?: string;
  creator?: string;
  licenseId: string;
  attribution?: string;
  sha256: string;
  fetchedAt: string;
  sourceUpdatedAt?: string;
}
```

The downloader validates HTTPS, size, media signature, checksum after download, and cache path containment. Model URLs are never executed as code.

The schema and strict runtime parser live in `src/shared/asset-provenance.ts`. The initial F3a loader computes SHA-256 from the exact brokered avatar bytes and attaches the validated record to the loaded scene for diagnostics. Disk caching is not implemented yet; when it is, the same parsed record must be written atomically beside the cached bytes and revalidated before reuse.

## VRM compatibility

- Detect VRM 0.x versus VRM 1.0 from parsed metadata; apply legacy rotation only to VRM 0.x.
- Inventory normalized humanoid bones, preset expressions, speech visemes, blink, look-at, and spring-bone joints before the animation runtime uses them.
- Require the hips/spine/head, bilateral arm/hand, and bilateral leg/foot bones used by the core retargeting profile. Report the exact missing names rather than failing later in animation playback.
- Compare reviewed catalog licensing with explicit embedded VRM permissions. Author-only, separately-licensed-person-only, non-commercial, redistribution-prohibited, and contradictory CC0 metadata fail closed.
- Do not use the registry's VRM 0.x Mixamo reference loader for VRM 1.0.
- Maintain a compatibility suite covering representative skeleton proportions, spring bones, expressions, materials, and coordinate systems.
- Preserve avatar-authored usage metadata where present and reject models whose terms cannot be satisfied.

`src/renderer/avatar/vrm-capabilities.ts` implements the version/capability and embedded-usage review boundary. The runtime now consumes the advertised blink, look-at, and preset-expression subset through a separate additive controller and no-ops when a feature is absent. Speech visemes remain disabled until a truthful timing source is implemented. The current tests use representative structural fixtures for both versions; real redistributable binary fixtures are still required before the F3 compatibility exit gate can pass.

## Animation sourcing

Animations are separate copyrighted assets. Each source must allow redistribution in the intended commercial/store context. Source files, conversion parameters, converter version, output checksum, and attribution remain linked.

Mixamo is a possible authoring input, not an automatic permission to redistribute raw or converted clips. The release manifest must contain only assets whose redistribution rights have been reviewed.

`src/shared/animation-manifest.ts` pins the first accepted conversion profile:

- normalized Mixamo-to-VRM humanoid target;
- parent-rest-world rotation space;
- hips-height-ratio translation scale;
- explicit sampling and root-motion policy;
- source and output SHA-256 provenance; and
- an approved rights review with reviewer and timestamp.

The offline converter and canonical runtime format are implemented in `src/tools/animation/` and `src/shared/canonical-animation.ts`. It parses Mixamo FBX through Three.js, applies the upstream parent-rest-world quaternion formula, normalizes hips translation by source rest height, deterministically resamples/quantizes/sorts tracks, and binds the canonical result to each target VRM at runtime. See `docs/ANIMATION-PIPELINE.md`.

The converter is not a licence oracle. It will not emit an admitted manifest without explicit review metadata, and no reviewed production clip is committed yet. The first legally redistributable source/output fixture remains an owner/reviewer gate.

Runtime admission enforces the same boundary. `admitMotionClip` accepts only a parsed approved manifest whose clip identity, semantic state, layer, sample rate, and exact canonical output checksum match the clip bytes. The controller never treats the open-source status of an avatar as evidence that a separate animation may be redistributed.

The Open Source Avatars registry contains no animation registry. Its reference Mixamo loader is VRM 0.x-only, while the current live gallery separately serves eleven Mixamo-style FBX previews that are not present in the public gallery repository with per-file licence/provenance records. Desky has technically inspected those files but does not ship them. The evidence and hashes are recorded in `docs/research/OSA-ANIMATION-AUDIT-2026-08-23.md`.

A user-selected local `.vrma` follows a separate session-preview policy. It is validated as a self-contained bounded VRM Animation, kept only in memory, never placed in the cache or release manifest, and shown in the UI as session-only. This permits testing files for which the user holds rights without representing them as Desky-owned or redistributable. Built-in admission still requires the full source/output provenance and rights-review manifest.

## Store content rules

- The catalog is an indexed set of data assets, not downloadable executable code.
- Store screenshots and review notes identify remote content behavior.
- NFT collections may be browsed only under the applicable store rules; Desky will not link to external purchase flows in restricted storefront builds.
- Reporting and removal mechanisms are required before community-submitted catalogs are enabled.
