# Desktop companion experience

## Purpose

This document is the product and engineering contract for Desky's desktop presence. It translates the supplied private reference video and the useful part of the Microsoft Clippy lineage into an original, trustworthy interaction model for Windows and macOS.

The target is not a chat window decorated with a character. The character inhabits the desktop: it remains present above ordinary work, communicates agent state through restrained motion, and reveals text and controls only when they are useful.

This specification spans F3's expressive runtime and the companion-facing portion of F4. It does not claim that every behavior below is implemented today.

## Reference boundary

The supplied 29.8-second reference video demonstrates these interaction principles:

- A character and its speech bubble remain above another application after that application opens.
- The default presentation has no large permanent application card around the character.
- Short conversational responses use small, distinct body gestures.
- Thinking is communicated by a bounded ellipsis state and a changed pose.
- A longer requested action, such as a virtual jump, uses deliberate full-body choreography while the response remains readable.
- A compact prompt surface appears near the character and remains visually secondary.

These are observations, not assets or a design to copy. The private video and analysis frames are excluded from the repository. Desky must not copy another product's character, branded graphics, exact layout, animation files, or trade dress. Every shipped model and animation remains subject to `docs/ASSETS.md`.

## Experience principles

1. **Live on the desktop.** The companion should feel spatially present beside the user's work, not trapped inside a conventional app frame.
2. **Motion carries meaning.** A pose or action acknowledges a real normalized state; it is not constant decorative activity.
3. **Reveal controls in context.** Dialogue, input, Stop, and approvals appear beside the character when needed and recede afterward.
4. **Never steal the desk.** Ambient behavior does not take keyboard focus, cover the active task unnecessarily, or repeatedly demand attention.
5. **Keep control literal.** Status, tools, permissions, errors, and cancellation always have readable controls. Animation never acts as the only explanation.
6. **Be welcome to dismiss.** Always-on-top, motion, sound, click targets, startup behavior, and the companion itself are independently controllable.

## Surface model

Desky has three coordinated presentation levels backed by the same session and companion state.

### 1. Ambient companion

This is the default daily surface:

- A transparent, frameless window containing the character and only transient nearby UI.
- Optionally always on top, with the preference clearly exposed and disabled by default if platform review or accessibility requirements demand it.
- No taskbar or Dock presence for the ambient surface when the control center already supplies the application entry point.
- Transparent pixels do not consume desktop clicks. Deliberate character, bubble, and composer hit regions remain interactive.
- The character can be repositioned without making ordinary clicks feel like accidental drags.
- Position is saved per display arrangement and clamped into the current work area after monitor, scale, or resolution changes.
- It avoids the Windows taskbar, macOS menu bar and Dock, notches, and reserved screen edges.

### 2. Focused companion

A click or keyboard shortcut temporarily expands the local interaction:

```text
       ┌───────────────────────────┐
       │ short streamed response   │
       └────────────┬──────────────┘
                 character
       ┌───────────────────────────┐
       │ compact composer    Send  │
       └───────────────────────────┘
```

- The bubble and composer flip or shift when the companion is close to a work-area edge.
- The composer receives focus only after an explicit user action.
- A draft survives dismissal, reconnect, and an accidental focus change.
- `Enter` sends, `Shift+Enter` inserts a line break where multiline input is enabled, and `Escape` collapses the focused surface without discarding the draft.
- While a turn is active, an unmistakable Stop action is available without opening the control center.
- Session and connection selectors do not occupy the permanent ambient layout. They belong in a contextual menu or the control center.

### 3. Control center

This is a standard resizable and fully accessible application window for:

- onboarding and runtime authentication;
- sessions and full conversation history;
- approval details and previous decisions;
- avatar selection, licensing, and attribution;
- companion, accessibility, privacy, notification, and performance preferences;
- diagnostics, cache management, updates, and account removal.

Security-sensitive detail is never compressed into a playful bubble. An approval may be announced beside the character, but scope, risk, and decision controls must also be available in the control center.

## Spatial behavior

The renderer measures the character's visible bounds rather than treating the full transparent canvas as occupied space. Bubble and composer placement follows this order:

1. Prefer above the character and horizontally centered.
2. Flip below when there is not enough safe area above.
3. Shift inward when close to a left or right edge.
4. Constrain width before moving the character.
5. If the content exceeds the companion limit, show a concise preview and an **Open conversation** action.

Target values are design tokens, not scattered component constants:

| Token | Initial target |
| --- | --- |
| Bubble readable width | 240–360 CSS px |
| Bubble preview | 2–4 lines before expansion |
| Character safe inset | at least 12 CSS px from the usable work area |
| Composer reveal | 120–180 ms when full motion is enabled |
| State acknowledgement | visible within 150 ms of a normalized event |
| Full-body cross-fade | normally 120–250 ms |

The implementation may tune the ranges after device testing, but a change must preserve readability, responsiveness, and reduced-motion behavior.

## State and motion language

The normalized state remains the source of truth. Each state needs a readable label and an optional visual treatment:

| State | Required visible behavior | Motion intent |
| --- | --- | --- |
| `disconnected` | Stable offline status and reconnect route | Settle into a quiet offline pose; do not pulse indefinitely |
| `idle` | Ready indication on demand | Low-amplitude breathing, blinking, and infrequent gaze changes |
| `listening` | Explicit microphone/input indicator | Orient toward the user; never imply microphone capture unless it is active |
| `thinking` | Bounded progress cue | Anticipatory weight shift or focused pose with accessible text/ellipsis |
| `working` | Active tool name or safe activity label plus Stop | Purposeful loop or task gesture tied to real tool activity |
| `approval` | Prominent readable request and decision route | Interrupt lower-priority motion and hold an attentive pose |
| `speaking` | Stable streamed bubble text | Subtle conversational gestures, expression, and optional visemes |
| `success` | Concise completion status | One 0.8–1.5 second acknowledgement, then return to idle |
| `error` | Plain-language problem and recovery action | One brief concern reaction, then a stable recoverable pose |
| `cancelled` | Immediate cancelled status and ready state | Stop the active action and settle; late tool events must not restart it |

### Motion layers

Animation is composed from explicit layers:

1. **Baseline:** breathing, blink, eye direction, and minimal balance.
2. **State loop:** a bounded thinking or working motion.
3. **Conversational gesture:** a short wave, emphasis, acknowledgement, or reaction selected from safe tagged alternatives.
4. **Action choreography:** an intentional full-body one-shot requested by the user, such as a jump, stretch, or celebration.
5. **Face and speech:** expression weights, look-at, and optional visemes layered where the avatar supports them.

### Arbitration rules

- Cancellation, approval, and disconnection outrank all decorative or conversational motion.
- Only one full-body state/action clip owns a humanoid bone at a time; additive face, blink, and look-at layers may coexist.
- A user-requested action is never interrupted by a random idle gesture.
- A new tool event can replace a thinking loop only after the state reducer accepts it for the active turn.
- Terminal and cancelled turns ignore late nonterminal events, matching the adapter lifecycle contract.
- Missing clips fall back to a neutral pose and readable status; they never block the turn.
- Cross-fades use animation metadata and do not assume all avatars share the same proportions or rest pose.

### Motion restraint

- Idle variety is randomized within bounded, testable intervals; there is no constant waving or bouncing.
- Conversational gestures normally last 0.6–2 seconds.
- Success and error reactions are one-shots, not loops.
- No rapid flashes, forced camera movement, or high-frequency full-screen motion are permitted.
- Reduced-motion mode removes travel, bounce, and full-body loops. It retains a static pose change, text, and a short opacity transition where allowed.
- Pause animation freezes on a neutral readable pose and suspends the render loop where possible.

## Dialogue and input

### Speech bubble

- The first readable delta appears as soon as the adapter delivers it; the bubble does not wait for the entire response.
- Streaming text grows without moving already rendered lines unnecessarily.
- Markdown is reduced to safe companion formatting. Code, tables, long lists, and approval detail open in the control center.
- The bubble may remain during a user-requested action so meaning is not lost while the body moves.
- Text can be selected when the companion is focused.
- Screen readers receive throttled, coherent live-region updates rather than one announcement per token.
- Completed text times out only according to an explicit user preference. Important errors and approvals do not auto-dismiss.

### Composer

- Clicking the character, choosing **Ask Desky**, or invoking a configurable shortcut reveals the composer.
- The control indicates whether input will go to the selected session before sending.
- Sending immediately acknowledges the submitted text and enters the normalized active state.
- During a turn, Send does not compete visually with Stop.
- Voice input, if added, has a separate truthful microphone state and permission path. It is not implied by the `listening` animation alone.

## Pointer, focus, and window behavior

- Ambient windows never activate merely because the runtime state changed.
- Opening a bubble does not move focus away from the user's current application.
- Clicking the composer explicitly activates text input. Dismissing it returns naturally to the previous application where the platform permits.
- The draggable region is deliberate and visually or behaviorally discoverable; interactive controls are marked non-draggable.
- Click-through can be toggled from a global shortcut, tray/menu item, and control center so a misplaced companion cannot trap itself.
- Context menus expose hide, pause motion, click-through, always-on-top, open control center, and quit.
- Full-screen applications and presentations follow a user preference: hide by default, remain visible, or appear only for approvals.
- The companion does not reposition itself simply to attract attention.

## Platform requirements

### Windows

- Validate transparent-window hit testing at 100%, 125%, 150%, and 200% scale.
- Respect the active monitor work area and taskbar edge.
- Test virtual desktops, full-screen apps, sleep/wake, display reconnect, and Explorer restart.
- The Store package must behave truthfully within its declared capabilities and must not depend on direct-build-only process access.

### macOS

- Validate non-activating ambient behavior, Spaces, full-screen apps, Stage Manager, multiple displays, menu bar/Dock placement, and screen scale changes.
- Always-on-top/window level must remain user-controlled and acceptable under Mac App Store review constraints.
- Text input, approval, and VoiceOver paths use ordinary focusable controls even if the ambient panel is non-activating.

Platform-specific window mechanics may differ, but state meaning, control availability, and visual hierarchy must remain equivalent.

## Accessibility and trust requirements

- Every agent state, tool activity, approval, and error has a text equivalent.
- The complete critical path works with keyboard navigation and a screen reader in the control center.
- Reduced motion, pause animation, disable always-on-top, hide on full-screen, and disable sound are independent preferences.
- Bubble text follows system text scaling and contrast requirements; it is not baked into the 3D scene.
- Focus indicators are visible against transparent and desktop backgrounds.
- Microphone capture, network disconnection, and approval waiting states use distinct non-color indicators.
- No animation, sound, or notification falsely suggests that an action completed.
- Tool and approval labels are derived from redacted normalized data, never raw untrusted markup.

## Performance and lifecycle

The budgets in `docs/ARCHITECTURE.md` apply to the composed companion, not just the bare model.

- The transparent canvas is tightly bounded around current visible content where platform behavior permits.
- Hidden, occluded, paused, or full-screen-suppressed companions suspend rendering.
- Bubble text and ordinary controls remain usable if WebGL fails.
- Avatar replacement disposes all previous GPU resources and animation state.
- Reconnect does not replay completed gestures or stale speech.
- Sleep/wake and display changes restore a clamped position and a state reconciled with the adapter host.

## F3/F4 implementation slices

### F3a — compatibility and provenance

- Load representative VRM 0.x and 1.0 avatars through one capability model.
- Establish the versioned, reproducible retargeting pipeline and provenance sidecars.
- Define clip metadata for body ownership, loop/one-shot behavior, fades, intensity, and reduced-motion alternatives.

### F3b — motion runtime

- Implement the animation layer arbiter independently of any one avatar.
- Map fixture and live adapter events to deterministic motion intents.
- Add baseline, state, conversational, action, face, and speech layers with safe fallbacks.

The implemented F3b foundation covers the first two bullets, the full-body state portion of the third, and the first procedural expressive layers. `motion-arbiter.ts` resolves concurrent semantic state requests by fixed priority and admits only clips registered for the exact normalized state. `avatar-motion-controller.ts` owns the mixer, clip lifecycle, cross-fades, cancellation stop, reduced-motion behavior, deterministic state fallbacks, and a bounded priority/FIFO queue for emphasis, nod, wave, and jump. A queued cue temporarily becomes the one procedural body owner and then resumes the accepted state plan; approval, cancellation, disconnection, error, and higher state priorities can reject or interrupt it. Speaking schedules one safe emphasis, while explicit ambient actions request Wave or Jump without parsing model text.

`avatar-expression-controller.ts` is the separate capability-aware additive layer. It drives a deterministic bounded blink schedule, restrained look-at, and small available-preset expressions, restores authored values on disposal, neutralizes gaze for reduced motion, and becomes a no-op when an avatar lacks the relevant feature. The implemented ephemeral agent-action lane admits typed Wave/Jump requests into the same body queue without replaying them or parsing text. Richer gesture selection, speech visemes, licensed external clips, and binary VRM compatibility evidence remain open and must preserve the same ownership boundary.

### F3c — desktop-presence composition

- Replace the development card as the default companion presentation with the ambient transparent composition.
- Anchor the speech bubble and compact composer to measured character bounds.
- Add safe-area flipping, deliberate drag, click-through hit testing, focus rules, and position persistence.
- Keep connection and developer diagnostics available in the control center/fallback surface during migration.

F3c.1 established separate ambient and control-center windows and removed the permanent card from the default companion. The standard resizable control center owns connection and session management; the ambient surface is limited to the avatar and contextual dialogue/control routes.

F3c.2 implements geometry-keyed position persistence, 12-pixel work-area clamping after user moves and display changes, above/below and horizontal bubble adjustment, a projected VRM-bounds character hit target, selective transparent-region pass-through, a session-only full click-through mode, saved always-on-top control, and tray/context-menu/global-shortcut/control-center recovery routes. Packaged Windows diagnostics prove that an active control center retains focus while the ambient window is shown inactive, repositioned, and updated.

The Windows ambient surface is also non-minimizable, non-maximizable, and non-fullscreenable. If the shell nevertheless delivers a minimize transition, Desky restores it with `showInactive()` while preserving the foreground application's focus. Intentional **Hide companion** remains available through the control center and native menus.

F3c.3 makes the resting ambient surface avatar-first. Status, drag, settings, click-through, and hide chrome appear only during explicit focused interaction; otherwise a small launcher is the only permanent control. Meaningful states reveal a compact light speech bubble, long text gains **Open conversation**, and Stop remains visible even while the composer is collapsed. The main process owns one revisioned companion snapshot and session-only draft for all windows. This lets a late-opening control center recover the current streamed response or approval and lets `Escape` collapse/re-open preserve a draft without storing conversation text on disk. The packaged Windows fixture confirms the idle, focused-draft, and completed-response compositions without stealing document focus.

Manual pointer pass-through at every required display scale, equivalent macOS behavior, full-screen policy, assistive-technology validation, and sleep/wake/display-reconnect evidence remain F3/F3d gates.

### F3d — resilience and evidence

- Add reduced-motion, paused, WebGL-loss, missing-clip, and avatar-load fallbacks.
- Capture a packaged visual/state matrix on reference Windows and macOS devices.
- Enforce idle/active/hidden performance budgets and verify GPU cleanup.

F4 completes the standard control center, full transcript, settings, approval history, avatar browser, and daily management workflows.

## Acceptance matrix

F3's desktop-companion experience is not complete until all of these are evidenced:

| Area | Acceptance evidence |
| --- | --- |
| Desktop presence | Packaged companion remains above an ordinary app without taking focus |
| Hit testing | Transparent regions pass clicks; character and visible controls receive them |
| Placement | Bubble/composer stay in the usable area at every screen edge and tested scale |
| State fidelity | Fixture sequence produces the documented readable state and motion intent |
| Live fidelity | Thinking, streaming, tool work, approval, cancellation, success, and error follow real adapter events |
| Cancellation | Active motion stops promptly and late tool events cannot reactivate it |
| Control | Stop, hide, pause, click-through escape, and open-control-center routes are always reachable |
| Accessibility | Keyboard, screen-reader status, contrast, text scaling, and reduced motion pass the critical path |
| Compatibility | Representative VRM 0.x/1.0 suite uses safe fallbacks for unsupported capabilities |
| Provenance | Every shipped model and clip has reviewed source, licence, checksum, and transformation metadata |
| Performance | Visible idle, active, hidden, memory, and cleanup budgets pass on reference machines |
| Lifecycle | Multi-monitor, scale change, full-screen, sleep/wake, reconnect, and WebGL recovery pass |

## Explicit non-goals for this experience

- Unsolicited tutorials, jokes, or repeated attention-seeking animation.
- A character that obscures the user's document to force engagement.
- Security decisions represented only as character dialogue.
- Animation selected from the raw wording of untrusted model output.
- A permanent dense status card around the avatar.
- Pixel-for-pixel reproduction of Clippy or the supplied reference application.
