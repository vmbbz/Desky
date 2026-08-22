# Avatar and asset policy

## Registry integration

Desky uses the public [ToxSam/open-source-avatars](https://github.com/ToxSam/open-source-avatars) registry as its first discovery source.

The registry is metadata and URLs, not a bundled runtime or animation library. Integration follows its multi-file schema:

1. Fetch `data/projects.json`.
2. Filter public collections and supported licences.
3. Fetch the selected project's `avatar_data_file`.
4. Join `avatar.project_id` to its project before exposing the avatar.
5. Use `model_file_url` and `thumbnail_url` exactly as published.

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

## VRM compatibility

- Detect VRM 0.x versus VRM 1.0 from parsed metadata.
- Do not use the registry's VRM 0.x Mixamo reference loader for VRM 1.0.
- Maintain a compatibility suite covering representative skeleton proportions, spring bones, expressions, materials, and coordinate systems.
- Preserve avatar-authored usage metadata where present and reject models whose terms cannot be satisfied.

## Animation sourcing

Animations are separate copyrighted assets. Each source must allow redistribution in the intended commercial/store context. Source files, conversion parameters, converter version, output checksum, and attribution remain linked.

Mixamo is a possible authoring input, not an automatic permission to redistribute raw or converted clips. The release manifest must contain only assets whose redistribution rights have been reviewed.

## Store content rules

- The catalog is an indexed set of data assets, not downloadable executable code.
- Store screenshots and review notes identify remote content behavior.
- NFT collections may be browsed only under the applicable store rules; Desky will not link to external purchase flows in restricted storefront builds.
- Reporting and removal mechanisms are required before community-submitted catalogs are enabled.
