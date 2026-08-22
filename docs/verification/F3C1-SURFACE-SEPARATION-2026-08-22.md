# F3c.1 surface-separation verification — 2026-08-22

## Scope

This record covers the first desktop-presence implementation slice: typed surface identity, separate ambient and control-center windows, semantic cross-surface routes, character-first ambient composition, and migration of connection/session setup out of the default companion. It does not claim completion of position persistence, work-area clamping, dynamic bubble placement, transparent hit testing, tray escape, focus evidence, or contextual composer collapse.

## Implemented boundary

- `DeskyWindowManager` owns the two privileged Electron window roles. Renderer code does not create windows or receive raw Electron objects.
- `RuntimeInfo.surface` identifies `ambient` or `control-center` from main-process window ownership.
- The ambient window is fixed-size, transparent, frameless, taskbar-free, and currently always-on-top pending the user preference. It opens without activating itself after readiness.
- The control center is standard, framed, resizable, non-transparent, and not always-on-top.
- Both windows keep context isolation, renderer sandboxing, Node integration disabled, web security enabled, denied permission requests, denied popup creation, and blocked renderer navigation.
- Semantic actions open the control center or restore the companion. Existing close/minimize actions remain scoped to the sending window.
- The ambient renderer contains the avatar, concise state bubble, status, approval actions, compact prompt/Stop, and a connection/session route. It contains no connection credential fields or session selector.
- The control center contains runtime setup, session selection, prompt, approval, status, and diagnostics without instantiating a second VRM renderer.
- Normalized approval resolution text now says `The runtime` rather than embedding the OpenClaw provider name.

## Automated verification

| Gate | Result |
| --- | --- |
| Vitest | 16 files passed, 1 opt-in live file skipped; 65 tests passed, 1 live test skipped |
| TypeScript | `tsc --noEmit` passed |
| ESLint | passed |
| Production dependency audit | zero reported vulnerabilities with development dependencies omitted |
| Electron Forge package | fresh Windows x64 package completed |

The new surface contract tests prove that the ambient and control-center profiles retain their intended geometry, visibility behavior, taskbar/transparency/resizing differences, and hardened web preferences. Existing reducer coverage now asserts provider-neutral approval output.

## Packaged visual evidence

Two ignored captures were produced from the final package through the production `desky://` scheme:

### Ambient

- URL: `desky://app/main_window/index.html?surface=ambient`
- DOM surface identity: `ambient`
- The capture shows a transparent background, small drag handle, connection status, control-center and close controls, anchored short bubble, fully rendered Milk avatar, licence/source label, and **Connect an agent** route.
- No permanent application-card background, credential form, or session selector is present.

### Control center

- URL: `desky://app/main_window/index.html?surface=control-center`
- DOM surface identity: `control-center`
- The capture shows the standard resizable management layout, **Show companion** route, runtime status, response area, prompt, and complete OpenClaw connection form.
- It does not create a second avatar canvas.

Both diagnostics reported a complete document and one populated React root. Milk again loaded as `Milk · VRM 0.x · CC0 · 100Avatars R1` on the ambient surface. No capture, package, downloaded avatar, token, or generated output is committed.

## Review findings addressed

The first ambient capture included a compositor-sensitive decorative glow that became visually dominant when inspected against a black transparency background. That decoration was removed before the final package so the character remains neutral over arbitrary desktop content.

## Remaining F3c gates

- Persist and restore companion position per display arrangement.
- Clamp against taskbar, Dock, menu bar, notches, and active work areas.
- Measure avatar/bubble/composer bounds and flip or shift at screen edges.
- Implement transparent-region click-through plus tray/menu and keyboard escape routes.
- Prove that state updates and bubble appearance do not steal focus.
- Collapse the composer contextually while preserving drafts.
- Reconcile pending approval state when a control center opens after the request began.
- Validate equivalent behavior on macOS, multiple monitors, scale changes, full-screen applications, and sleep/wake.

The dependency order and parallel adapter/asset/release lanes are maintained in `docs/EXECUTION-PLAN.md`.
