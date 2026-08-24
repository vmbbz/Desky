# Open Source Avatars animation audit — 2026-08-23

## Decision update — 2026-08-24

The project owner approved the exact `LookingAround.fbx` as Desky's integrated idle after the file identified its source clip as `mixamo.com`, its Mixamo humanoid structure was verified, and Adobe's official FAQ was checked for commercial-project use. Desky converts it to the canonical VRM-neutral runtime format, records its exact source/output identity under `LicenseRef-Adobe-Mixamo`, and does not commit or expose the source FBX. `LookingAround.fbx` is the only gallery file admitted by this update; the other ten remain research-only.

Reference: [Adobe Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html).

## Original audit decision — 2026-08-23

Desky will not bundle the animation files currently served by the Open Source Avatars gallery. Their runtime behavior is technically understood and compatible with Desky's existing retargeting design, but the public repositories do not establish modification and commercial/store redistribution rights for those specific binaries.

The safe implementation split is:

1. keep Desky's deterministic FBX-to-canonical converter for animation sources that pass the provenance and rights-review gate;
2. support session-only preview of a user's own local `.vrma` without redistributing or caching it; and
3. admit gallery clips only if an authoritative source later supplies an explicit licence and provenance for each file.

## Sources inspected

- Live gallery: <https://www.opensourceavatars.com/en/gallery?avatar=toothpaste>
- Gallery source: <https://github.com/ToxSam/os3a-gallery>, commit `085cf849bd66694c038a46aadf78a5aef37c5373`
- Avatar registry: <https://github.com/ToxSam/open-source-avatars>, commit `0f9a1b2fd99894736563d55b2c9dc9125700d081`
- Toothpaste VRM fetched from the registry-backed live gallery and inspected as binary glTF.

Downloaded research files and repository clones stay under ignored `out/upstream/`. The Looking Around FBX is now a reviewed local build input, but no raw FBX is committed or shipped.

## What the gallery actually does

Toothpaste's `.vrm` contains zero embedded glTF animation clips. A VRM does not inherently require a VRMA: animation is a separate input and may be supplied through VRMA, retargeted FBX, or another reviewed runtime format.

The live deployment bundle exposes eleven same-origin Mixamo-style FBX files. It loads them with Three.js `FBXLoader`, locates the Mixamo clip, maps Mixamo bones to VRM normalized humanoid bones, applies parent-rest-world rotation retargeting and hips-height scaling, and applies VRM 0.x coordinate sign conversion. That is materially the same retargeting model as Desky's offline converter.

The current public `os3a-gallery` checkout does not contain this eleven-file menu or those FBX binaries. Its `public/animations/README.md` only instructs a developer to place Mixamo files there. The `open-source-avatars` repository explicitly describes itself as registry metadata and URLs with no animation data; its reference Mixamo loader is limited to VRM 0.x.

The gallery repository's MIT licence covers the website. Its README separately says 3D assets have their own licences. No per-file licence, author, source URL, or redistribution grant was present in the deployed FBX responses or the public repository, so technical availability is not treated as asset admission.

## Technical inspection matrix

All files below returned HTTP 200 from the live deployment on 2026-08-23. Desky's non-writing converter inspection parsed each file with 53 supported tracks, zero ignored tracks, 52 normalized bones, and an approximately 104.275-unit source hips height. Canonical hashes prove deterministic conversion output only; they do not prove rights.

| Live file | Bytes | Duration (s) | Source SHA-256 | Canonical SHA-256 |
|---|---:|---:|---|---|
| `Bored.fbx` | 2,563,088 | 9.833 | `fc367bb1fe2e0b697555cd5076a952987b6776669771d9ddf14d125afd4f78e0` | `4a709daff0f1a12c8ab7d1705921adce4b1707eabca577148f6fc9b8a392877a` |
| `CrossJumps.fbx` | 1,961,968 | 2.033 | `0c9a6379bb2a25b92bb14632ddc4f2d9004dd49c646997d653a9af70bef72dea` | `89efd3c6af3a56e6eddb28d71b03765f89b1cdd58563f3df934424f95b5844b6` |
| `FightIdle.fbx` | 413,616 | 1.333 | `1da67958e46f1e323a457cc165a02853dbc156e0d22a954237ec41ccf10b8a03` | `3aed9a5ad7b53f74a9417982751baacb5b73d17bed9094ed5cf91bb07bc1bdd2` |
| `JumpingRope.fbx` | 1,933,376 | 2.367 | `07192d0abc34c055fce55a347d5e73b54cb3f2610034a20673e21a546781e1e7` | `1dbe14218544154e421acfc4d091e19d81ebdabc39cac35a4993facb0a4ec465` |
| `Looking.fbx` | 2,401,872 | 8.733 | `c19a8322235b6618405cd516f9899414af9810b17f9d1345daef1cc12915e438` | `075c543964daf4f153f06d84de33bedbbb61347254480c5077cef2cfae7ffda0` |
| `LookingAround.fbx` | 1,229,504 | 11.400 | `fa3822ddd0f3eb9510d3079d5cc2c21e95481e44fc7c026c5586215211fb258e` | `3105f46dae1fd258a53430c8d52badd39b7be8b4d6fb3ee4191d2e3ce803e528` |
| `MagicSpellCasting.fbx` | 2,071,024 | 4.267 | `e3f0f6e184b5106084424b971c693091a0c4b4cb74de798dd345399a8f2271e6` | `db57bf52f0cb530352196a1a2c8fb2e2d3db12bd9130124c0506130c6d3e32d4` |
| `OffensiveIdle.fbx` | 2,840,528 | 13.533 | `84a6b858929d591d3b1704df487dd896f9f78f23d3357ebae59139f145d90a8b` | `b0695a3793dfb0af5c4b1e90be9ab44e9ccf0e1b5b7861a25df211c3e291f328` |
| `SearchingFilesHigh.fbx` | 1,098,496 | 9.733 | `171d938a623c9d393d7c2e450663ff279474d174895a6b29d88a6f201ee34171` | `206533f3beb41c2b92e23df062d8bb1726ead4eeec1abc07bb132e6a72ac486f` |
| `StandingMagicAttack.fbx` | 2,125,744 | 4.300 | `7313bae71677163c9c7179ba069f516e77faa254b111fdcb874b5839301bbdfe` | `5a6aca552b97fc6c89fdb33c2b5e74129225a7972cc93b14fdf111a673b59f4d` |
| `TextingWhileStanding.fbx` | 1,255,520 | 11.800 | `1ef2dd4d7d4d65917e76811cbaa779cbbf52c42760c708ead07f4f251ff39ff9` | `810622b0b29bf70bb090159a3adf2bd13cac93c6760fb7fe08f1f3943db4ed4b` |

`T-Pose (Default)` in the gallery is the avatar rest pose, not a twelfth animation file.

## Follow-up required for redistribution

For any external clip proposed as a built-in asset, obtain the original source identity, creator, licence text or contract, modification rights, commercial/store redistribution rights, source URL, and review identity. Then run Desky's converter and exact manifest admission. A screenshot, public URL, accessible response, Mixamo account, or open-source website licence is insufficient by itself.
