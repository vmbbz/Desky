# F3b.6 smooth animation handoff and framing verification — 2026-08-23

## Outcome

File-authored actions no longer cut through the bind/idle pose at step or program boundaries. Every canonical step retains its complete declared duration and repetitions. Adjacent program steps crossfade over 220 ms; after the final step, a registered state clip crossfades in or the last pose fades to the procedural baseline over 320 ms. Authoritative interruption remains immediate.

The ambient avatar is now scaled against the actual perspective-camera frustum instead of fixed world-space dimensions. After packaged review found the first 78%/68% safety fit too small, the balanced target was set to 98% of visible height and 90% of visible width in the relaxed pose—the midpoint presentation between the original oversized render and the conservative fit.

## Regression evidence

- A one-second admitted action remains the active cue through its authored duration.
- Its final pose remains visibly displaced during the 320 ms settle rather than snapping to baseline.
- A two-step admitted program retains the first final pose while the next step gains weight, proving the handoff does not pass through the bind pose.
- Framing tests prove both vertical and horizontal frustum limits and safe fallback for malformed geometry/camera data.
- The packaged Windows Full-motion capture reports Milk ready, `activeProgram: jump`, `activeCue: user-jump-1`, `motionReduced: false`, and no clip/preference error. The captured broad Jump pose remains fully inside the 423 × 583 ambient surface.

Generated screenshots, diagnostic JSON, package output, and avatar binaries remain ignored and are not committed.

## Remaining manual gates

- Observe several autonomous single- and multi-step programs at normal frame rate on Milk and tune only file metadata when a specific clip has unsuitable foot contact or prop assumptions.
- Repeat framing and transition review on materially different licensed VRM 0.x and 1.0 proportions.
- Complete macOS, mixed-DPI multi-monitor, sleep/wake, occlusion, WebGL-loss, CPU, and memory evidence.
