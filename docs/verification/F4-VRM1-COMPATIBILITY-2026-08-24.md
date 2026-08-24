# F4.8 real VRM 1.0 compatibility — 2026-08-24

## Outcome

Windows now has a real, provenance-reviewed VRM 1.0 compatibility fixture that
passes Desky's production binary envelope, content-addressed cache, Three.js /
`@pixiv/three-vrm` loader, embedded-usage review, canonical animation binding,
live framing, reduced-motion, WebGL recovery, and normalized state lifecycle.

This closes the **engineering compatibility fixture** gate. It does not add a
fourth free companion, change the three-CC0 marketplace promise, or claim that
every one of the 85 admitted motion clips has completed visual review on VRM
1.0. The binary remains external, temporary, and uncommitted.

## Exact source and rights review

- Model: Seed-san
- Creator: VirtualCast, Inc.
- Authority: VRM Consortium specification samples
- Repository commit: `821c11b250d8c70d5804ee13431e42bee56ea9c0`
- File-last-change commit: `837f156dbce43ad69183ce1bdab549961ae1c1ee`
- Model source: `https://raw.githubusercontent.com/vrm-c/vrm-specification/821c11b250d8c70d5804ee13431e42bee56ea9c0/samples/Seed-san/vrm/Seed-san.vrm`
- Source record: `https://github.com/vrm-c/vrm-specification/tree/821c11b250d8c70d5804ee13431e42bee56ea9c0/samples/Seed-san`
- Licence: VRM Public License 1.0
- Licence URL: `https://vrm.dev/licenses/1.0/`
- Model bytes: `10917800`
- Model SHA-256: `624d0d554bc205bbdc33e22a68a2c3c20edebb3e573011ead8878a65e5329b23`
- Source-record SHA-256: `f0fdc21cf26437d9becd90a64d350bc0307fcfa172e1caea5aa39c52a5b3b9b6`
- Screenshot bytes: `51693`
- Screenshot SHA-256: `c516bc73cb5bd158c2258cbb772f877d56badf343ee89bd7c452c3520f1dab37`

The same model hash was independently observed at the older pinned commit
`c24d76d99a18738dd2c266be1c83f089064a7b5e` and the audited current repository
commit above.

The embedded `VRMC_vrm` metadata reports:

- `specVersion: 1.0`;
- author `VirtualCast, Inc.`;
- `avatarPermission: everyone`;
- `commercialUsage: corporation`;
- `allowRedistribution: true`;
- `modification: allowModificationRedistribution`;
- `creditNotation: required`; and
- the canonical VRM Public License 1.0 URL.

The binary contains 51 humanoid bone declarations and exercises PBR/MToon,
spring bones, node constraints, look-at, and 18 preset expressions. Attribution
is therefore mandatory if Desky ever redistributes or publicly offers this
model. This engineering run does neither.

## Fail-closed harness boundary

`vrm1-compatibility-fixture.ts` records the exact model, source record,
thumbnail, licence, creator, commit, byte lengths, and hashes. It is not part of
`marketplace-catalog.ts`.

The packaged override activates only for the finite `vrm1-compatibility`,
`vrm1-jump`, or `vrm1-state-cycle` exercises. Capture, isolated user-data, and
model paths must resolve beneath one uniquely named `desky-vrm1-ui-*` OS-temp
root, the model must end in `.vrm`, and its bytes must match the pinned length
and SHA-256 before reaching the renderer. Ordinary launches continue through
the selected admitted marketplace revision.

## Production cache evidence

The opt-in real-file test passed:

- exact fixture identity admission;
- VRM 1.0 binary-envelope validation;
- atomic object and provenance-sidecar storage;
- verified offline restart without calling the fetcher;
- corrupt-sidecar detection; and
- reacquisition from the exact pinned model URL.

The first version of the test attempted a deep equality assertion over two
10.9 MB typed arrays and exhausted the Vitest worker heap. It was corrected to
the stronger production identity check: exact byte length plus SHA-256 on every
read. The rerun passed in under one second.

## Packaged Windows evidence

Package: `out/Desky-win32-x64/Desky.exe`. Avatar network access was disabled;
the package received only the hash-pinned temporary fixture.

### Compatibility lifecycle

- Avatar: `ready`
- Status: `Seed-san · 85 admitted motions · VRM 1.0 · VRM-Public-License-1.0`
- Mapped textures: `29`
- Jump framing: passed
- WebGL state after forced loss/restoration: `recovered`
- WebGL recovery: passed
- Reduced motion observed: passed
- Full-motion idle restored afterward: passed
- Restored state clip: `mixamo-look-around-mixamo-com-v1`
- Motion clip error: none
- Final projected bounds: X `0.8402`, Y `0.9719`

### Explicit Jump capture

- Program: `jump`
- Cue: `user-jump-1`
- Framing: passed
- Projected bounds: X `0.9221`, Y `0.3553`
- Motion clip error: none

Visual inspection confirmed that the extended mechanical arm assembly is part
of Seed-san's official reference silhouette, not a detached retargeting error.
The authored body and rig remain coherent during Jump.

### Normalized state cycle

The packaged simulation exercised the production companion reducer and motion
runtime through:

| Mode | Observed full-body owner |
| --- | --- |
| idle | `mixamo-look-around-mixamo-com-v1` |
| listening | stable procedural owner |
| thinking | `uam1-interact-v1` |
| working | `uam1-fixing-kneeling-v1` |
| speaking | `uam1-idle-talking-loop-v1` |
| success | stable procedural owner |

All six modes were observed, the response bubble completed normally, the final
projected bounds were X `0.7886` and Y `0.9627`, and no motion clip error was
reported.

## Remaining gates

- Select a product-suitable CC0 VRM 1.0 companion before changing the three-free
  marketplace portfolio; Seed-san is intentionally only a compatibility fixture.
- Run visual admission for every enabled state/action/autonomous program on the
  final VRM 1.0 product candidate.
- Run longer VRM 1.0 CPU/GPU plateaus and real Windows sleep/wake.
- macOS remains explicitly deferred with Claude and x402.
