# F4.6 live motion-envelope framing — 2026-08-24

Platform: Windows 11, packaged x64 Electron application

F4.5 proved that Milk and Astronaut accepted the Full-motion Jump program but correctly left visual admission open: Milk's long arms crossed the horizontal capture edge, while Astronaut's widest pose and antenna reached the frame boundary. F4.6 closes that representative VRM 0.x visual failure without hardcoding an avatar or animation.

## Architecture

The relaxed-pose fit remains the preferred idle presentation. During playback, the renderer measures the selected avatar's current projected geometry and derives the zoom-one envelope mathematically from the current perspective-camera zoom. It then chooses only the contraction needed to fit within bounded horizontal and vertical safe regions.

The first packaged attempt deliberately failed visual review even though ordinary `Box3.setFromObject()` diagnostics said the pose was safe. Three.js object bounds do not automatically follow deformed skinned vertices. The admitted implementation therefore calls `SkinnedMesh.computeBoundingBox()` before sampling, making the envelope reflect the current CPU-skinned pose rather than the bind/rest mesh. Samples run every second frame during an action/program and every eighth frame otherwise, limiting steady-idle traversal cost.

Camera contraction uses a 35 ms response to catch fast limb extension. Release uses 450 ms so the companion eases back to its preferred presentation without snapping or pumping. The target has a 0.42 floor for pathological poses. The logic consumes only projected bounds and time; it contains no avatar IDs, animation filenames, provider states, or marketplace policy.

Projected character bounds are republished as zoom changes, keeping the direct-manipulation hit region aligned with the visible companion.

## Automated and build verification

```text
npm test                 PASS: 163 passed, 1 skipped
npm run typecheck        PASS
npm run lint             PASS
npm run package          PASS: win32 x64
```

Five focused framing tests prove relaxed-pose fit, malformed-input fallback, zoom-invariant envelope resolution, preferred-size preservation for safe poses, and asymmetric smooth contraction/release.

All screenshots, diagnostics, downloaded avatars, application-data profiles, and package output remain ignored and uncommitted.

## Packaged visual matrix

| Avatar/state | Zoom | Projected max X/Y | Result |
| --- | ---: | ---: | --- |
| Milk, autonomous Phone Check over Looking Around | `1.0000` | `0.7116 / 0.9464` | Existing preferred size preserved; complete body visible |
| Milk, Full Jump | `0.6340` | `0.9316 / 0.4734` | Both extended hands and legs inside the transparent surface |
| Astronaut, Looking Around | approximately `0.84` | height governed by antenna | Complete antenna, boots, and hands visible |
| Astronaut, Full Jump | `0.8429` | `0.6563 / 0.9709` | Complete textured model inside the surface |

Both Jump captures reported `motionFramingVerified: true`, `motionActiveProgram: jump`, `motionActiveCue: user-jump-1`, Full motion, one mapped texture, and no clip, motion-preference, or exercise error. Native images were inspected in addition to trusting DOM diagnostics.

## Remaining compatibility gates

- Admit a real rights-reviewed VRM 1.0 binary and run this same idle/action envelope matrix across materially different proportions.
- Run timed idle/action CPU and GPU measurements on reference hardware; adaptive skinned-bound sampling is intentionally measurable rather than assumed free.
- Repeat visual, lifecycle, and performance evidence in the packaged macOS build.
