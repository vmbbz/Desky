# F3d.1 Windows visibility and performance — 2026-08-26

## Outcome

The packaged Windows companion now distinguishes user intent from transient native window state. An ambient surface that should be visible is recovered after unexpected hide or minimize without taking focus. Explicit **Hide companion** and power suspend remain authoritative and are never reversed by the watchdog.

The render loop no longer polls every display refresh merely to enforce a lower target. It schedules one animation frame near the next target interval. Calm state loops use 20 FPS; autonomous gesture programs, explicit cues, previews, thinking, working, approval and speaking remain 60 FPS.

## Packaged visibility evidence

The fresh Windows x64 package recorded:

- `unexpectedHideRecovered: true` after the native surface was hidden without changing desired state;
- `deliberateHidePreserved: true` after the product Hide action;
- `ambientRecoveredFromMinimize: true`;
- focus preserved after inactive show, minimize recovery and work-area clamping;
- ambient document unfocused while the Control Center remained focused;
- tray and global-shortcut recovery available;
- full click-through enabled and recovered;
- off-screen bounds clamped to `{ x: 12, y: 12, width: 420, height: 580 }`.

Display topology events are debounced for 250 ms before arrangement restoration, clamping and persistence. On macOS, the ambient window opts into all Spaces while remaining below full-screen Spaces; Linux uses the supported all-workspaces call. [Electron documents](https://www.electronjs.org/docs/latest/api/browser-window#winsetvisibleonallworkspacesvisible-options-macos-linux) that this API does nothing on Windows, so this record does not falsely claim Windows virtual-desktop coverage.

## Packaged performance evidence

Reference device: the existing HP Spectre Windows 11 machine documented in `F4-WINDOWS-REFERENCE-LIFECYCLE-2026-08-24.md`.

Final 30/15/10-second idle lifecycle:

| Phase | Whole-app average CPU | Peak CPU | Peak summed working set |
| --- | ---: | ---: | ---: |
| Visible calm idle | 3.103% | 6.589% | 587,556 KiB |
| Native hidden | 0.081% | 0.261% | 450,588 KiB |
| Recovered idle | 3.851% | 6.138% | 445,620 KiB |

Frame 978 stayed exact for the entire hidden plateau and advanced to 1288 after recovery. Renderer working set peaked at 262,012 KiB. The visible result improves the prior 4.107% plateau by about 24.4%, but the `<3%` budget still fails by 0.103 percentage points and remains open.

An intermediate 24 FPS run measured 3.196%; a 1.25 pixel-density experiment measured 3.638% and was discarded because it did not help and reduced visual fidelity. The final implementation retains the 1.5 pixel-density cap.

## Accessibility and policy

- The ambient root and manipulation target have explicit accessible names.
- The Control Center reports visible, recovering or deliberately hidden state.
- Increased-contrast and Windows forced-colors CSS removes decorative shadows and preserves focus/control boundaries.
- Reduced-motion and Paused behavior remain independent from visibility and frame policy.
- No production dependency was added for foreground/full-screen observation.

Manual Windows Narrator/UI Automation, text-scaling, forced-colors screenshots, physical display reconnect, virtual desktops, multi-monitor scaling and external full-screen application behavior remain hardware/operator evidence. The previously rejected dependency-heavy foreground-window package remains absent; an audited native boundary is still required before automatic external full-screen suppression can be claimed.

## Verification

- TypeScript: passed;
- ESLint: passed;
- focused visibility/render/placement/window tests: passed;
- Electron Forge Windows x64 packaging: passed;
- packaged visibility/focus behavior harness: passed;
- packaged idle/hidden/recovered lifecycle: passed functionally, `<3%` visible CPU narrowly open.
