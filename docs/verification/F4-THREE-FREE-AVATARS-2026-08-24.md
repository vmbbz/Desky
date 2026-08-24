# F4 three-free avatar admission and activation — 2026-08-24

## Outcome

Desky now exposes three genuine free companions: Milk, CoolBanana, and Astronaut. These are immutable admitted revisions rather than live registry search results. Commerce remains disabled.

The selection balances immediate character affinity and runtime coverage:

- **Milk** remains the iconic, lightweight default and known-good rollback.
- **CoolBanana** is a recognizable upstream flagship with a narrow, unusual silhouette that exercises framing and retargeting.
- **Astronaut** provides a compact human-shaped body with a helmet/suit silhouette, broadening motion, crop, and hit-test evidence.

All three currently resolve to VRM 0.x. The external Seed-san fixture now proves real VRM 1.0 engineering compatibility, but Desky does not claim the free-product VRM 1.0 portfolio gate is complete; a product-suitable CC0 VRM 1.0 marketplace revision remains required.

## Pinned upstream evidence

Registry: `https://github.com/ToxSam/open-source-avatars`

Pinned commit: `0f9a1b2fd99894736563d55b2c9dc9125700d081`

Canonical record hashing recursively sorts JSON object keys, preserves array order, serializes without whitespace, and hashes UTF-8 bytes with SHA-256.

| Avatar | Registry ID | Canonical record SHA-256 | Model bytes | Model SHA-256 | Thumbnail bytes | Thumbnail SHA-256 |
| --- | --- | --- | ---: | --- | ---: | --- |
| Milk | `15dce553-3d3c-4288-8c03-c69c65167447` | `880ed0f4523d0c1e9809f85e2f7583e4b111ff7a5e5b68df509e6e086502a5fa` | 1,338,344 | `99e32f15d529eb47b3892aa44d5f053c07dabf55a0851aca7e7ab74f5f17e107` | 788,547 | `bdaf847bc6feebfe2e5efde3b1329cccb9c30bcb109e93e0d134865fcb8eecf5` |
| CoolBanana | `c47d2c68-80ae-4131-802a-b1bf12f30398` | `1c6afcabff8e16b2c66f639b780449d72907ca7113d718d2649be39a67120842` | 1,491,040 | `4d316549404d52bb0f4f60ae91a6c7bd234e001987840df04e1e73379941aa4c` | 963,931 | `d8353a7ced01b0974cd0567935a34b922d29899fa1a41be4d8dcd45ffff461d1` |
| Astronaut | `e69fd8b9-d6ae-44ca-84e0-be4bb075d426` | `733a0a5b4f0bb2451eb3cf3bca27ade503a70a287c7a39a71f3680c89c775ca6` | 1,679,188 | `1cb8218610deafc0fd4608507fc52cf3303de84b0f641b9a452efb5e8a0e6f23` | 955,819 | `e12cc43b73ab8c3c977ba47509928f4f8a7c89393aaba7c5bcbd29f116e2c6f6` |

Binary GLB inspection found for each revision:

- glTF 2.0 with legacy `VRM` metadata;
- embedded author `Polygonal Mind`;
- `allowedUserName: Everyone`;
- `commercialUssageName: Allow`;
- embedded `licenseName: CC0`;
- all fifteen Desky core retargeting bones present;
- 50–52 declared humanoid bones; and
- one mesh, material, texture, and image.

The project record is `100Avatars R1`, declared CC0 by the registry. Release counsel review remains a store-release gate; this engineering admission is not legal advice.

## Runtime and cache contract

Main owns all network and disk mutation:

1. resolve an exact admitted avatar ID;
2. fetch only its pinned HTTPS URL through the existing host/time/size policy;
3. verify exact byte length and SHA-256;
4. verify GLB 2.0 and expected VRM envelope, or PNG signature for artwork;
5. atomically install the content-addressed object and provenance sidecar;
6. reparse and revalidate both on every cache read; and
7. expose bounded bytes through typed IPC.

Activation does not immediately overwrite the saved choice. Main stages a pending revision; the ambient renderer loads Three.js/three-vrm, validates the core humanoid and embedded permissions, counts mapped textures, initializes framing/expressions/motion, and reports the exact revision ready or error. Only ready commits active plus previous fallback. Error clears pending and returns to the prior companion.

No downloaded `.vrm`, thumbnail, package, screenshot, profile, or cache object is committed.

## Verification

Automated checks after the core implementation:

```text
npm run typecheck
npm run lint
npm test
npm run package
```

The final complete run passed 34 test files and 154 tests with one file/test skipped. New coverage includes download-once/offline cache reuse, corrupt-object repair, checksum rejection, thumbnail admission/cache, uncommitted pending selection, committed ready selection, runtime-error rollback, and unknown-ID rejection.

Packaged Windows evidence using isolated profiles:

- CoolBanana transitioned from download to pending runtime admission to committed `ready`.
- Astronaut transitioned to committed `ready`.
- The Marketplace reported three real cards, payment rails off, and the exact selected avatar ID.
- Astronaut ambient reported `avatarState: ready`, `avatarTextureCount: 1`, `VRM 0.x`, `CC0-1.0`, and no motion clip error.
- A final packaged CoolBanana restart with `DESKY_VISUAL_TEST_DISABLE_NETWORK=1` restored the committed content-addressed object, reported `avatarState: ready`, one mapped texture, full motion, the admitted Looking Around idle, and no clip error.
- The same network-denied profile restored all three hash-pinned Marketplace thumbnails and the active CoolBanana selection from cache.

Full-motion Milk/Astronaut captures, corrupt-cache package recovery, macOS, and twenty-switch evidence are recorded as remaining gates until run.
