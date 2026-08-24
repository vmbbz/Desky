# F4 preview and cache durability verification — 2026-08-24

## Scope

This round closes the first F4.3 durability slice without enabling payments or admitting an unverified avatar. It covers isolated Marketplace preview, bounded protected cache eviction, active-cache repair, repeated transactional replacement, and renderer teardown.

## Contracts implemented

- `marketplace.getPreview(avatarId)` is a narrow control-center-only IPC request. Main resolves only a free admitted catalog ID and returns the exact verified bytes plus bounded runtime descriptor.
- Preview uses a dedicated Three.js/three-vrm scene. It repeats humanoid and embedded-usage admission, handles VRM 0.x rotation, applies a relaxed display pose, supports pointer rotation, and deep-disposes its model and WebGL context. It never publishes or persists selection state and does not run agent/state animations.
- The cache ceiling is 256 MiB. Record modification times are advisory least-recently-used access signals. Pruning enumerates only paths derived from the immutable admitted catalog, counts shared content-addressed objects once, removes exact paths, and protects active, fallback, and pending revision IDs.
- Ambient avatar replacement deep-disposes the previous VRM scene, including textures, and clears Three.js render lists before disposing its renderer.

## Automated verification

- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npm test`: 34 files passed, 1 skipped; 157 tests passed, 1 skipped.
- New tests prove that preview returns verified bytes without a selection write/event, the protection set contains active/fallback/pending revisions, and pruning evicts an unprotected revision while retaining the protected object.
- `npm run package`: pass for Windows x64.

## Packaged Windows evidence

All captures used the packaged production `desky://` renderer and an ignored isolated application-data profile.

### Isolated 3D preview

CoolBanana reached `marketplacePreviewState: ready` while Marketplace selection remained `ready` and the active revision was unchanged. The visible dialog showed the real mapped model, creator, CC0 licence, VRM generation, performance class, source route, explicit activation route, and drag-to-rotate instruction. No thumbnail was represented as a 3D preview.

### Corrupt-cache recovery

The active CoolBanana model first matched admitted SHA-256 `4d316549404d52bb0f4f60ae91a6c7bd234e001987840df04e1e73379941aa4c`. Its model provenance sidecar was deliberately changed from schema version 1 to an invalid version 99. On packaged restart with network available:

- main rejected the sidecar and reacquired only the exact admitted URL;
- the sidecar returned to schema version 1;
- the restored model still matched the admitted SHA-256;
- ambient reported `avatarState: ready`, `avatarTextureCount: 1`, and no clip error.

### Switch and disposal soak

The packaged harness selected a different admitted avatar, waited for `ready` commit, and repeated without overlapping activations. Both the required 20-switch run and a stronger 40-switch run completed with no harness error, crash, stale pending state, or loss of the active/fallback transaction.

Electron working-set values are KiB and are snapshots, not heap attribution. On separate fresh runs after deep scene disposal:

| Run | Ambient-like tab before | Ambient-like tab after | Delta | GPU before | GPU after |
| --- | ---: | ---: | ---: | ---: | ---: |
| 20 switches | 140,760 | 407,344 | 266,584 | 115,512 | 215,716 |
| 40 switches | 143,540 | 416,184 | 272,644 | 114,308 | 268,020 |

The ambient delta increased about 6 MiB between the 20- and 40-switch runs rather than doubling, consistent with a large renderer warm-up/allocator plateau. GPU retention increased further, so this evidence closes functional replacement and catches obvious linear CPU-side leakage but does not waive the longer reference-device GPU plateau, sleep/wake, or macOS gate.

Generated captures, profiles, downloaded avatar bytes, and packages remain ignored and uncommitted.

## VRM 1.0 admission audit

The pinned Open Source Avatars registry does not declare model VRM generation in its records, and its reference Mixamo loader explicitly states that it is VRM 0.x-only. Desky therefore does not infer VRM 1.0 from collection age or rename a 0.x binary. A real 1.0 candidate must contain `extensions.VRMC_vrm` with `specVersion` 1.0 and must separately pass embedded commercial-use and redistribution review. No qualifying registry candidate was admitted in this round.

## Remaining gates

- real redistributable VRM 1.0 binary with permissive embedded metadata;
- corrupt/restart evidence for Milk and Astronaut;
- user-facing cache inventory and safe remove controls;
- longer Windows GPU plateau plus sleep/wake and WebGL-loss recovery;
- equivalent packaged macOS evidence;
- representative full-motion captures on Milk and Astronaut.
