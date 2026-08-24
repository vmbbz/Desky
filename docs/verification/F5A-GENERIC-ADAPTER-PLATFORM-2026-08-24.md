# F5a generic adapter platform verification — 2026-08-24

## Scope

This round extracts the application-level adapter boundary without rewriting the proven OpenClaw Gateway transport. It covers shared contracts, main-process registration/routing, provider-specific validation and normalization, generic IPC/preload, renderer consumption, and regression coverage.

## Implemented boundary

- `src/shared/agent-adapter.ts`: versioned safe descriptors, connection/session state, lifecycle commands, approval commands, and renderer bridge.
- `src/main/adapters/runtime.ts`: internal runtime port including normalized events and ephemeral typed actions.
- `src/main/adapters/registry.ts`: release-profile-filtered descriptor enumeration, one active runtime, disconnect-before-switch, command routing, inactive-runtime isolation, and disposal.
- `src/main/adapters/openclaw-runtime.ts`: exact OpenClaw configuration validation, native-to-generic state mapping, host delegation, and provider redaction.
- `src/main/ipc.ts` and `src/preload/index.ts`: `desky:adapter:*` / `window.desky.adapters`; all `desky:openclaw:*` renderer channels removed.
- `src/renderer/App.tsx`: generic endpoint/authentication/session/turn fields and generic lifecycle commands. OpenClaw wording and its token/password form remain contextual provider presentation, not the transport contract.

## Security assertions

- Provider configuration stays opaque to the generic contract and is validated only by the selected runtime in main.
- Descriptors contain presentation metadata only and are defensively cloned.
- The registry filters and refuses adapters not admitted to the current direct/Store release profile.
- Provider-native frames, saved credentials, native connection state, and `ipcRenderer` do not cross preload.
- Submitted credentials and prompt text remain part of provider-aware renderer error redaction.
- Only the active runtime can emit state, normalized events, or agent-action commands to product surfaces.
- Renderer-local Simulation is still clearly labeled and is not registered as a production runtime.

## Automated evidence

Executed from the repository root after the complete migration:

- `npm test`: 37 test files passed, 1 opt-in live file skipped; 172 tests passed, 1 skipped.
- `npm run typecheck`: passed with no TypeScript errors.
- `npm run lint`: passed with no ESLint errors.
- `npm run package -- --arch=x64`: Electron Forge produced the Windows x64 package successfully, including webpack bundle generation and finalization.

Focused coverage includes:

- every registry lifecycle command;
- safe descriptor enumeration;
- disconnect-before-switch behavior;
- inactive runtime event/action suppression;
- unknown runtime rejection and submitted-text redaction;
- OpenClaw configuration rejection;
- complete native-to-generic state mapping and defensive copying;
- unchanged OpenClaw host delegation and credential redaction.

## Remaining F5a work

F5a.2 adds Codex app-server as the second substantially different production runtime. Only after OpenClaw and Codex pass one contract suite will Desky stabilize a public adapter SDK and final multi-provider connection UI. Claude and Hermes remain later gates subject to supported structured transports and release-profile policy.
