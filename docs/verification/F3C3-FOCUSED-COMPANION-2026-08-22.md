# F3c.3 focused-companion verification — 2026-08-22

## Scope

This record covers the avatar-first ambient hierarchy, contextual composer reveal/collapse, session-only cross-window draft reconciliation, concise response overflow, the control-center route, and shared approval/current-response state. It does not claim a full transcript, approval history, assistive-technology certification, the manual display-scale pointer matrix, macOS equivalence, or F3d lifecycle/performance completion.

## Implemented boundary

- `CompanionStateHost` applies normalized adapter events to one revisioned shared snapshot in Electron main. Ambient and control-center renderers subscribe to that snapshot and fetch the latest revision when they mount.
- The pure reducer retains a bounded 100,000-character live response and derives a 220-character ambient preview. Overflow receives **Open conversation**; the control center renders the bounded response and explicitly discloses truncation.
- Pending approval is part of the authoritative snapshot. Ambient offers concise immediate choices and a details route; a control center opened afterward obtains the same request rather than waiting for a new provider event.
- The unsent draft is a separate revisioned main-process value. It synchronizes existing and late-opening windows but is never written to `desktop-state.json`, the encrypted credential vault, or a transcript store.
- The resting ambient surface contains the avatar and a small **Ask Desky** or connection launcher. The bubble exists only for meaningful activity. Drag, status, settings, click-through, and hide controls appear after explicit composer expansion.
- Clicking the measured character hit target or launcher reveals and focuses the composer only when a usable session exists. `Escape` collapses without clearing; an accepted send clears and collapses. Stop remains a standalone ambient control while a real OpenClaw run is active.
- All setup, credential, and session controls remain in the standard control center.

## Automated verification

| Gate | Result |
| --- | --- |
| Vitest | 19 files passed, 1 opt-in live file skipped; 80 tests passed, 1 live test skipped |
| TypeScript | `tsc --noEmit` passed |
| ESLint | passed |
| Electron Forge package | fresh Windows x64 package completed |

Reducer tests cover full-response retention, concise overflow, new-turn reset, approval identity, cancellation, and terminal state. Main-state-host tests prove that a late reader obtains the current revisioned approval and that draft revisions survive window lifetime within the application process.

## Packaged Windows evidence

Three ignored captures ran from the fresh package through the secure `desky://` renderer with separate isolated application-data profiles:

| Fixture | Observed result |
| --- | --- |
| Idle/disconnected | No bubble or management chrome; Milk and **Connect an agent** were the only visible product controls; document focus remained false |
| Focused draft | The simulation composer expanded only through an explicit launcher click; an exact draft was entered, collapsed with `Escape`, reopened, and recovered unchanged; document focus was false at capture time |
| Completed response | A compact light **Done** bubble appeared above Milk with the simulated response, the composer was collapsed, **Ask Desky** remained available, and document focus remained false |

The captured diagnostics also reported one React root, the expected surface identity and edge placement, recovery availability, and only the currently visible interactive regions. The screenshots, diagnostic JSON, isolated profiles, package, and downloaded Milk binary remain ignored and are not committed.

## Remaining evidence and next work

- Exercise long-response **Open conversation** and late-opening approval reconciliation against a live packaged OpenClaw turn; the pure and host contract paths are covered now.
- Complete Windows manual pointer/focus checks at 100%, 125%, 150%, and 200% scale and repeat the surface matrix on macOS with keyboard and screen-reader coverage.
- Add F3d full-screen policy, pause/reduced-motion preference, occlusion suspension, WebGL recovery, and measured performance budgets.
- Proceed next with deterministic requested-action and conversational-gesture queues plus capability-aware procedural blink, look-at, and speaking layers. No external animation enters production until its rights and conversion provenance pass the existing admission gate.
