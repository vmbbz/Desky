# F4 storage and WebGL recovery verification — 2026-08-24

## Scope

This round implements the user-facing cache-management boundary, closes the three-avatar corrupt-sidecar restart matrix, and proves that the ambient renderer resumes after an actual WebGL context loss/restoration event. Payments, entitlements, selection, and gateway adapters are unchanged.

## Storage contract

- `marketplace.getCacheInventory()` and `marketplace.removeDownload(avatarId)` are control-center-only typed IPC commands. The renderer receives no paths or filesystem primitive.
- Inventory inspects only immutable admitted-catalog paths and reports model/thumbnail status as verified, missing, or corrupt; physical bytes count content-addressed files once.
- Main derives active, rollback, acquisition, and pending protection. A protected model is not removable even if a stale renderer tries the command directly.
- Removal deletes only the exact revision model record and its content object when no other admitted revision record references that hash. Catalog thumbnail, product metadata, source, licence, entitlement, and selection history remain.
- A removed model is reacquired and fully verified before preview or activation. The UI calls this `Remove model`, not uninstall, revoke, burn, or delete purchase.

## Renderer recovery contract

- `webglcontextlost` prevents default disposal, pauses rendering, and exposes a visible recovering state plus diagnostic counters.
- `webglcontextrestored` resets Three.js state, resizes the renderer, restores the last admitted ready projection, and resumes the existing scene and render loop.
- This handles a restorable context. A context that the platform never restores still requires an explicit fallback/reload route in the later lifecycle gate.

## Automated verification

- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npm test`: 34 files passed, 1 skipped; 160 tests passed, 1 skipped.
- New tests cover verified/corrupt/missing inventory without a download, protected removal rejection, exact model removal, shared content-object retention, and acquisition-time protection.
- `npm run package`: pass for Windows x64.

## Packaged Windows evidence

All generated packages, profiles, downloads, screenshots, and diagnostics are ignored and uncommitted.

### Safe model removal

On a fresh isolated profile, the harness opened the real Astronaut 3D preview so its admitted model was verified and cached, closed the preview, and invoked the visible `Remove model` control. Diagnostics recorded:

- `visualExerciseError: null`;
- Astronaut changed from verified to missing/online-only;
- physical cache bytes changed from `5,729,984` to `4,049,963`;
- Milk remained verified and protected as both active and rollback;
- all three hash-pinned thumbnails remained visible.

### WebGL restoration

The packaged ambient canvas used the browser's `WEBGL_lose_context` extension to issue a real loss, waited until Desky observed it, restored the same context, and verified that the render frame advanced afterward. Diagnostics recorded:

- `webglState: recovered`;
- `webglLossCount: 1`;
- `webglRestoreCount: 1`;
- `webglRecoveryVerified: true`;
- `avatarState: ready` and `avatarTextureCount: 1`;
- no visual exercise or motion clip error.

The final image visibly contains Milk's face, label, blue bands, limbs, and transparent ambient composition after restoration.

### Remaining corrupt-cache restarts

Milk and Astronaut were each active in isolated packaged profiles. For each, the validated model sidecar was deliberately changed from schema version 1 to 99 before restart. Network remained available. Main rejected the record and reacquired only its exact admitted URL.

| Avatar | Restored sidecar | Restored model SHA-256 | Runtime |
| --- | --- | --- | --- |
| Milk | schema 1 | `99e32f15d529eb47b3892aa44d5f053c07dabf55a0851aca7e7ab74f5f17e107` | ready, 1 texture, no clip error |
| Astronaut | schema 1 | `1cb8218610deafc0fd4608507fc52cf3303de84b0f641b9a452efb5e8a0e6f23` | ready, 1 texture, no clip error |

Together with F4.3 CoolBanana evidence, all three admitted free avatars now pass the corrupt-sidecar packaged restart case.

## Remaining gates

- Real external Seed-san VRM 1.0 cache/offline repair and WebGL recovery now pass; a product-suitable CC0 VRM 1.0 marketplace revision remains open.
- representative full-motion Milk and Astronaut captures;
- longer Windows GPU plateau and sleep/wake lifecycle;
- hidden/occluded render suspension and unrecoverable-context fallback;
- packaged macOS equivalence and accessibility matrix.
