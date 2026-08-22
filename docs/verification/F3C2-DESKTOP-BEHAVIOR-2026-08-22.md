# F3c.2 desktop-behavior verification — 2026-08-22

## Scope

This record covers placement persistence and clamping, edge-aware ambient layout, measured character hit bounds, selective and full click-through policy, native recovery controls, always-on-top preference ownership, and focus-safe ambient updates. It does not claim completion of the manual display-scale pointer matrix, macOS behavior, full-screen policy, sleep/wake, contextual composer collapse, or packaged performance budgets.

## Implemented boundary

- Main owns display topology, placement restoration, work-area selection, native bounds, always-on-top, click-through state, tray/menu/global shortcut, and persistence.
- The geometry-only placement module selects the display with greatest intersection or nearest center, clamps every edge to the active work area with a 12-pixel inset, and derives bubble placement from edge clearance.
- Display arrangements are keyed by sorted bounds and scale factors rather than unstable display enumeration or IDs.
- `desktop-state.json` accepts only version 1, finite bounded coordinates, a boolean always-on-top preference, and the sixteen most recent placements. Writes use a same-directory temporary file and atomic rename.
- The renderer sends only validated `interactive` or `transparent` pointer intent. It cannot call Electron APIs directly.
- Visible DOM controls declare their hit regions. `AvatarStage` projects the loaded VRM scene bounds into CSS pixels and supplies a deliberate character target instead of claiming the full transparent WebGL canvas.
- Selective pass-through uses forwarded pointer movement so visible regions can become interactive again. Full click-through is session-only, never restored at startup, and refuses to enable without tray or registered-shortcut recovery.
- The tray and native companion context menu expose show, control center, full click-through, always-on-top, reset position, hide, and quit. `Ctrl/Cmd+Shift+D` toggles full click-through globally.
- Runtime state publication does not show or focus the ambient surface. Initial and recovery shows use `showInactive`; the composer is focused only after an explicit character or input click.

## Automated verification

The focused suite covers:

- arrangement-key stability across display enumeration and ID changes;
- multi-display selection, off-screen recovery, every-edge clamping, and default placement;
- above/below and left/center/right edge layout;
- strict desktop-state parsing, bounded history, and atomic round-trip persistence;
- restored bounds and hardened focus-on-navigation window options;
- typed click-through and position-recovery commands.

| Gate | Result |
| --- | --- |
| Vitest | 18 files passed, 1 opt-in live file skipped; 75 tests passed, 1 live test skipped |
| TypeScript | `tsc --noEmit` passed |
| ESLint | passed |
| Production dependency audit | zero reported vulnerabilities with development dependencies omitted |
| Electron Forge package | fresh Windows x64 package completed |

## Packaged Windows evidence

The final Windows x64 package produced ignored ambient captures at the primary work area's top-left and bottom-right:

| Position | Bubble | Horizontal shift | Document focus | Interactive regions | Recovery |
| --- | --- | --- | --- | ---: | --- |
| top-left | below | right | false | 6 | available |
| bottom-right | above | left | false | 6 | available |

Both captures loaded the production `desky://` renderer, one React root, and the licensed Milk VRM. The character, bubble tail, setup route, compact controls, and transparent background remained within the fixed ambient surface.

A separate packaged native behavior harness produced:

- control center focused before the exercise;
- focus preserved after hiding and showing the ambient window with `showInactive`;
- focus preserved after moving the companion off-screen and clamping it to `{ x: 12, y: 12 }` inside the detected `{ x: 0, y: 0, width: 1707, height: 912 }` work area;
- ambient `document.hasFocus() === false` while control-center `document.hasFocus() === true`;
- full click-through enabled and then recovered in the same process;
- tray available, recovery shortcut registered, and aggregate recovery available.

No capture, package, isolated user-data directory, generated avatar, token, or diagnostic JSON is committed.

## Remaining device evidence

- Manually prove that underlying applications receive clicks through transparent regions at Windows 100%, 125%, 150%, and 200% scaling while every measured visible region remains interactive.
- Repeat placement, focus, tray/menu, shortcut, always-on-top, Spaces, menu bar/Dock, and click-through behavior on macOS.
- Exercise display disconnect/reconnect, taskbar/Dock relocation, resolution/scale changes, virtual desktops, full-screen applications, sleep/wake, and Explorer restart.
- Add the user-controlled full-screen policy and pause-motion menu item during F3d.
- Complete F3c.3 contextual composer and cross-window approval reconciliation.
