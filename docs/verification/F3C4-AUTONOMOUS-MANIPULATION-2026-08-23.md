# F3c.4 autonomous companion and direct manipulation verification

Date: 2026-08-23  
Platform: Windows 11, packaged x64 Electron application  
Scope: autonomous idle life, direct companion dragging, persisted view rotation, and a live OpenClaw turn

## Contract under test

- Neutral breathing remains continuous while one low-priority gesture is selected after a bounded 4.5-to-10-second quiet interval.
- Autonomous gestures never immediately repeat and cannot outrank listening, thinking, work, speech, success, error, cancellation, approval, explicit user/agent actions, local preview, or reduced motion.
- A normal character click remains composer focus and a double-click remains Jump; movement begins only after five pixels.
- Direct movement crosses a typed, validated IPC boundary. Main owns starting bounds, active-display work-area clamping, and persisted placement.
- View yaw is a separate outer-avatar transform. It is normalized, persisted in main-owned desktop state, and restored across procedural/action baseline resets.
- Gallery FBX files are not runtime inputs until each exact file has an approved redistribution/provenance record.

## Automated gates

```text
npm run lint       PASS
npm run typecheck  PASS
npm test           PASS: 111 passed, 1 skipped
npm audit --omit=dev
                   PASS: 0 vulnerabilities
npm run package    PASS: win32 x64
git diff --check   PASS
```

The added unit coverage proves bounded scheduler timing, immediate-repeat exclusion, quiet-interval reset, high-priority state interruption, persisted-yaw normalization, and view rotation surviving both procedural and action baseline restoration.

## Packaged manipulation harness

The packaged `desky://` surface ran with isolated application data. Its harness found the measured avatar button and dispatched pointer down/move/up through the actual React handlers for both a normal drag and a Shift-drag rotation:

```json
{
  "documentFocused": false,
  "avatarState": "ready",
  "avatarTextureCount": "1",
  "avatarYawDegrees": "72.8",
  "initialWindowBounds": { "x": 12, "y": 12, "width": 420, "height": 580 },
  "nativeWindowBounds": { "x": 60, "y": 44, "width": 420, "height": 580 }
}
```

The top-left fixture left enough work-area clearance for the complete requested delta: native bounds changed from `(12, 12)` to `(60, 44)`, exactly 48 by 32 logical pixels. The isolated main-owned state recorded the final position and 72.8-degree yaw. The captured image showed Milk rendered from an oblique 3D angle with the transparent ambient composition intact. This exercises the five-pixel UI threshold, manipulation refs, typed preload channel, IPC validation, native bounds update, renderer view transform, and main-owned persistence in one packaged path.

## Live OpenClaw proof

The stale gateway used the isolated `--dev` profile, whose primary model remained `openai/gpt-5.4`. The completed OAuth flow had correctly updated the normal profile to `openai/gpt-5.6-sol`. The gateway was therefore restarted without `--dev`, using its previously verified Node 22.22.3 runtime. An accidental Node 22.15.0 resolution was rejected by OpenClaw before database access because its embedded SQLite version is WAL-unsafe; no state migration or database write was forced through that guard.

Desky loaded the normal profile's distinct gateway credential into the existing OS-encrypted vault through the control-center connection flow. The UI reported `OPENCLAW · CONNECTED`, selected the existing `Desky` session, cleared the submitted prompt, entered `Done`, and displayed the exact assistant response:

```text
DESKY_RUNNER_LIVE_OK
```

This proves provider execution and assistant streaming through the packaged adapter, not merely a WebSocket handshake.

## Remaining exits

- Manually verify direct pointer drag and modified drag at every required Windows display scale and across monitor boundaries.
- Verify equivalent move/rotation/focus behavior on macOS.
- Admit the first exact external animation only after source identity, commercial/store modification and redistribution rights, hashes, conversion, attribution, and representative VRM playback are approved.
- Add real redistributable VRM 0.x and 1.0 binary fixtures and test admitted clips across different proportions.
- Complete occlusion/sleep suspension, WebGL recovery, and the performance matrix.
