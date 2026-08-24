# F3b.10 executable motion closure — 2026-08-24

## Decision

This round closes the remaining locally executable active-preview interruption
gate without reimplementing already-complete motion-envelope work.

The audit confirmed that `AvatarMotionController` already made approval,
cancellation, disconnection, error, and reduced motion authoritative over a
session-only preview. The missing evidence was narrower:

- no focused test started authored preview motion before entering each of the
  four authoritative companion states; and
- no packaged harness drove a real `.vrma` from the Control Center through
  active playback into an interruption report.

F4.6 already package-proves generic skinned-motion framing for Milk and
Astronaut. That work was not repeated or changed.

## Added evidence

`tests/avatar-motion-controller.test.ts` now starts a ten-second authored head
track, verifies that it changes the avatar, and enters each authoritative mode:

- `approval`;
- `cancelled`;
- `disconnected`; and
- `error`.

Every row verifies the exact `started -> interrupted` lifecycle, activation of
the requested authoritative plan, restored bone baseline, and grounded avatar
root.

The packaged-only `vrma-interruption` exercise uses the real Control Center and
ambient renderer boundary:

1. choose Full motion;
2. select a real VRM Animation through the normal typed IPC path;
3. wait until the ambient renderer reports `playing`;
4. select Reduced motion; and
5. require the Control Center to report that the active animation was
   interrupted.

The native file-picker bypass is fail-closed and test-only. It activates only
for the exact exercise and accepts the capture, isolated user-data profile, and
`.vrma` fixture only when all resolve inside the same uniquely named
`desky-vrma-ui-*` OS-temporary subtree. Normal launches retain explicit native
file selection.

## Packaged Windows result

- Package: `out/Desky-win32-x64/Desky.exe`
- Fixture: local rights-review input copied to OS temporary storage; it was not
  bundled, cached, or staged.
- Fixture file name: `gesture_greeting.vrma`
- Bytes: `854284`
- SHA-256: `6322BBE2DF7716529DD53E2A61816E67B946416D3761C672B8D50EE2829825BB`
- Result: `vrmaInterruption=passed`
- Renderer/UI report: `gesture_greeting.vrma was interrupted by a
  higher-priority companion state.`
- Harness error: none

The ignored diagnostic capture and JSON remain under the uniquely named OS
temporary test directory. They are verification evidence, not product assets.

## Live typed Wave attempt

The OpenClaw 2026.8.1 live matrix was rerun with
`DESKY_OPENCLAW_LIVE_ACTION=wave` and the already-authorized local gateway
credential held only in the test process. Authentication recovery, capability
discovery, approval deny/allow/expiry/contention, active-turn reconnect,
cancellation, and terminal deduplication all passed before the model request.

The final model-issued Wave turn did not run because the configured Codex
provider returned its subscription usage limit, with a reset time of
2026-08-31 04:25 GMT+2. Wave therefore remains **not live-proven**. The finite
Wave/Jump harness is ready; rerunning it before provider capacity returns would
be redundant.

## Remaining gates

- Rerun the separate live Wave turn after provider capacity is available.
- Representative real VRM 1.0 state/action/cache/recovery evidence now passes with external Seed-san; the every-enabled-clip matrix and macOS remain open.
- Complete the broader reference-device, sleep/wake, accessibility, and Store
  release matrices tracked in `docs/DELIVERY.md`.
