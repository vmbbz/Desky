# F3a animation-converter verification — 2026-08-22

## Scope

This record covers the deterministic offline converter, canonical clip parser/serializer, runtime VRM binding, CLI build, and a transient real-FBX inspection. It does not approve or admit a production animation asset.

## Automated evidence

New tests cover:

- canonical schema, normalized quaternion, duplicate-track, ordering, and byte-stability checks;
- deterministic sampling and source-key interpolation;
- the parent-rest-world rotation formula;
- source-hips-height translation normalization;
- default horizontal root-motion removal and explicit preservation;
- common Mixamo namespace normalization and humanoid mapping;
- FBX-extracted rest transforms, source hips validation, and clip selection;
- runtime target-hips scaling and VRM 0.x X/Z coordinate conversion; and
- rejection of source keys outside the declared clip duration.

After integration, the repository result was 13 test files passed, 1 opt-in live file skipped, 47 tests passed, and 1 live test skipped. ESLint, TypeScript, and the standalone Webpack converter build passed.

## Transient FBX smoke

The Three.js example `Samba Dancing.fbx` was downloaded into ignored `out/` space solely to exercise the real FBX parser and converter. Its redistribution rights were not reviewed, so the tool ran only in non-writing inspect mode. The file, canonical bytes, and any manifest are not committed or admitted as Desky assets.

| Observation | Value |
| --- | --- |
| Source bytes | 3,681,360 |
| Source SHA-256 | `b9003ee562c87bf03051c3a502411b0808d3513f1d74a2011f7530d9f067069f` |
| Parsed duration | 18.200000762939453 seconds |
| Source rest hips height | 99.6720680581386 source units |
| Supported/ignored tracks | 53 / 0 |
| Canonical tracks | 53 |
| Inspection sample rate | 30 Hz |
| Canonical SHA-256 | `f1c55026c1e27454279f18646fce9b85ed9a5e7af0961aefe7cd26d3420d447f` |
| Repeat conversion | same canonical SHA-256 |

This proves the parser and deterministic output boundary against one real Mixamo-style FBX. It is not licensing evidence, a golden release fixture, foot-contact validation, or cross-avatar playback evidence.

## Remaining gates

- Owner/reviewer approval of a commercially redistributable and modifiable source animation.
- Committed provenance for the reviewed source and canonical output without relying on mutable URLs.
- Repeated conversion and checksum verification of that approved fixture.
- Visual playback on representative VRM 0.x/1.0 avatars, including proportions, hips scale, axes, foot contact, and missing optional bones.
- Reduced-motion alternative, performance, packaged Windows state matrix, and macOS evidence.
