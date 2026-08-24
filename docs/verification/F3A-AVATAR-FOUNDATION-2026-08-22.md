# F3a avatar-foundation verification — 2026-08-22

## Scope

This record covers the first F3a implementation slice: VRM version/capability admission, embedded usage review, exact-byte asset provenance, and the animation conversion manifest contract. It does not claim completion of the offline converter or the binary avatar compatibility suite.

## Automated coverage

The focused suite covers:

- representative structural VRM 0.x and VRM 1.0 capability fixtures;
- legacy-rotation selection by parsed VRM metadata version;
- normalized core-humanoid acceptance and exact missing-bone rejection;
- expression, five-viseme, bilateral-blink, look-at, and spring-bone inventory;
- compatible embedded creator/credit metadata and contradictory/non-commercial usage rejection;
- known-answer SHA-256 generation over exact bytes;
- HTTPS/generated-asset provenance validation; and
- animation manifest admission, mandatory rights approval, and pinned retarget-profile rejection.

Focused result at implementation time: 3 test files, 11 tests passed.

The full repository result after integration was 9 test files passed, 1 opt-in live file skipped, 34 tests passed, and 1 live test skipped. ESLint, TypeScript, and Electron Forge packaging also passed.

## Current default asset observation

The live registry was read without storing or committing the remote model:

| Field | Observed value |
| --- | --- |
| Registry project | `100avatars-r1` / `100Avatars R1` |
| Registry licence | `CC0` |
| Avatar | `15dce553-3d3c-4288-8c03-c69c65167447` / `Milk` |
| Model format metadata | VRM `0.0` |
| Embedded author | `Polygonal Mind` |
| Embedded user permission | `Everyone` |
| Embedded commercial permission | `Allow` |
| Embedded licence | `CC0` |
| Humanoid entries | 52 |
| Missing Desky core retarget bones | none |
| Downloaded size | 1,338,344 bytes |
| SHA-256 | `99e32f15d529eb47b3892aa44d5f053c07dabf55a0851aca7e7ab74f5f17e107` |

The hash identifies the observed remote bytes; it is not a promise that a mutable remote source will retain that digest. Runtime provenance records the bytes actually loaded.

## Packaged Windows smoke

A fresh `win32-x64` package loaded through the production `desky://` renderer scheme. After the visual harness's eight-second load interval, the DOM diagnostic reported:

```text
Milk · VRM 0.x · CC0 · 100Avatars R1
```

The ignored PNG capture also showed the Milk model rendered behind the open connection sheet. The saved OpenClaw relay URL was disconnected during this smoke; avatar loading and the renderer remained operational. No screenshot, downloaded model, credential, or generated package is committed.

## Remaining evidence

- Real VRM 0.x production assets and the external, provenance-pinned Seed-san VRM 1.0 fixture now pass the production Three.js loader; see `F4-VRM1-COMPATIBILITY-2026-08-24.md`.
- Exercise material, expression, spring-bone, coordinate, and cleanup behavior.
- Convert a rights-approved animation twice and prove identical output bytes and manifest.
- Validate foot contact, hips-height scaling, root-motion policy, and cross-avatar playback.
- Complete the packaged Windows state/performance matrix and capture equivalent macOS results and performance budgets.
