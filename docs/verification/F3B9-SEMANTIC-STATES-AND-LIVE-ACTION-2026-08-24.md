# F3b.9 semantic states and live agent action — 2026-08-24

## Scope

This round corrected the visible meaning of the motion system and proved the
normalized action lane against the real local Gateway.

## Implemented

- Idle/disconnected own the exact transformed 11.4-second Looking Around clip.
  Folded Arms is catalog-only, the rejected short head-shake is disabled, and
  no procedural full-body idle competes with the authored state.
- Thinking owns the rights-approved Quaternius Search/Interact clip.
- Speaking owns the rights-approved Quaternius talk loop and no longer queues a
  procedural full-body emphasis when the state begins.
- Idle, thinking, and speaking use `preserve-target` hips translation. Their
  retargeted clips cannot move the avatar vertically away from its fitted floor
  plane.
- The autonomous shuffled bag contains exactly Phone Check, Formal Walk, and
  rare Dance Break. It does not choose randomly from the 85-clip catalogue.
- `AgentAdapterCapabilities` is provider-neutral and executable. The OpenClaw
  plugin exposes `desky.actions.capabilities` at `operator.read` scope, and the
  control center reports whether typed Jump/Wave is ready.

The exact Looking Around source FBX remains an ignored build input and is not
redistributed as a standalone asset. Its transformed canonical output has exact
source/output provenance and a separate Adobe Mixamo licence reference. The
other ten gallery FBXs remain ignored research inputs and are not distributable
library members.

## Live evidence

- Platform: Windows x64
- Gateway: local loopback `ws://127.0.0.1:19001`
- OpenClaw: `2026.8.1`
- Model/provider: the Gateway's configured production model
- Authentication: token supplied from the local Gateway configuration through
  the process environment; no credential was written to the test or log
- Plugin source: `integrations/openclaw-desky-actions`

`npx vitest run tests/openclaw-live.test.ts` passed in 41.48 seconds. The single
live scenario proved:

1. wrong bootstrap credential rejection plus stale device-token recovery;
2. protocol-v4 capabilities;
3. approval deny, allow-once, expiry, contention, and terminal deduplication;
4. active-turn network loss, reconnect, cancellation, and recovery;
5. a successful assistant stream;
6. `desky.actions.capabilities` discovery; and
7. a real model call to `desky_avatar_action` with normalized action `jump`.

The action assertion observed `AgentActionCommand.payload === { action:
"jump" }`; it did not infer success from assistant prose.

## Automated and packaged evidence

- `npm test`: 136 passed, one live-environment suite skipped by default.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run package`: passed for Windows x64.
- Fresh packaged baseline and late-loop captures report
  `mixamo-look-around-mixamo-com-v1`, Full motion, no cue/program owner, no
  pending cue, and no clip error. The captures at 3.74 and 8.06 elapsed seconds
  show distinct authored body orientations while remaining grounded and inside
  the 423 by 583 ambient surface.
- The exact 11.4-second clip has identical first/last canonical endpoints on
  every track, avoiding a loop-boundary pose snap.
- Packaged thinking capture: `uam1-interact-v1`, no clip error, visually inside
  the surface.
- Packaged speaking capture: `uam1-idle-talking-loop-v1`, no clip error,
  grounded feet/hips, and a conversational hand pose rather than a vertical
  float.
- Packaged shuffled-bag observation: exactly
  `phone-check,formal-walk,dance-break` before reuse, with a separate reviewed
  frame for each program and no clip error.

The rebuilt 85-clip library SHA-256 is
`a029e2d20efaba6d6ed59be46f44e32b006b7333470221c1543cf104403388bf`.

All screenshots, diagnostic JSON, isolated application data, packaged output,
and research downloads remain ignored and uncommitted.

## Remaining gates

- Rerun the separate real model-issued Wave turn after provider capacity returns. The 2026-08-24 attempt reached OpenClaw 2026.8.1 and passed the pre-model live matrix, but the configured Codex provider rejected the final turn at its subscription usage limit; see `F3B10-EXECUTABLE-MOTION-CLOSURE-2026-08-24.md`.
- Repeat the packaged motion/state matrix on representative licensed binary VRM
  0.x and 1.0 avatars and on macOS.
- Obtain explicit rights before admitting any exact gallery animation binary.
