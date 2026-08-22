# ADR 0001: Electron desktop shell

- Status: accepted
- Date: 2026-08-22

## Context

Desky requires a transparent, frameless, animated companion on Windows and macOS, a conventional accessible control window, WebGL VRM rendering, secure privileged operations, and distribution through both major desktop stores.

## Decision

Use Electron with a sandboxed renderer, a narrow preload bridge, TypeScript, React, Three.js, and `@pixiv/three-vrm`.

## Rationale

- One VRM/rendering implementation across target platforms.
- Electron documents transparent windows and a Mac App Store build.
- Mature Chromium WebGL behavior and debugging.
- Strong process isolation when Node integration is disabled and renderer sandboxing remains enabled.
- Straightforward structured subprocess supervision for direct-build adapters.

## Alternatives considered

### Tauri

Smaller packages and a Rust core are attractive. Rejected for this phase because transparent webviews on macOS require Tauri's private API setting, which prevents Mac App Store acceptance. Maintaining a separate opaque Store UI would compromise the product's primary experience.

### Separate AppKit and WinUI applications

Best native integration and smallest platform compromise. Rejected for the initial product because it doubles UI, rendering, accessibility, and adapter-host implementation before product-market validation.

### Unity or Godot

Strong 3D tooling. Rejected because Desky is primarily a secure desktop client and approval surface, not a game; desktop integration, package weight, control-window accessibility, and agent process hosting are more central than editor-driven scene authoring.

## Consequences

- Package and memory budgets require active enforcement.
- Transparent window limitations require a fixed companion viewport plus a separate resizable control window.
- Electron upgrades are security work and must remain frequent.
- MAS and direct Electron runtimes need separate packaging validation.
