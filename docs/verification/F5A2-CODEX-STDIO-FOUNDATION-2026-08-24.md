# F5a.2 Codex stdio foundation verification — 2026-08-24

## Scope

This is a real transport foundation, not a selectable or simulated Codex adapter. It establishes the bounded supervised JSONL peer required before semantic runtime work.

## Implemented

- Direct-only Codex descriptor and truthful foundation capabilities; `production: false` and no registry admission.
- Fixed app-server invocation: `app-server --listen stdio://`, `shell: false`, hidden window.
- Absolute expected-filename executable guard; no renderer path surface.
- Required `initialize` / `initialized` handshake with Desky client identity.
- Correlated requests, notifications, and server-initiated request lanes.
- 1 MiB request/response line bound, 64 KiB stderr retention, 240-character redacted diagnostic preview, request timeouts, pending-request rejection, malformed JSON/envelope failure, unexpected-exit failure, and bounded teardown.

## Focused automated evidence

- initialize handshake and correlation;
- notification versus server-request separation;
- approval response framing;
- RPC error bounding and timeouts;
- stderr bounds and secret-pattern redaction;
- malformed/oversized stdout fail-closed behavior;
- unexpected process exit;
- relative/arbitrary executable rejection.

Final verification:

- `npm test`: 38 test files passed, 1 opt-in live file skipped; 177 tests passed, 1 skipped.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run package -- --arch=x64`: Windows x64 Electron Forge packaging passed after webpack compiled the main, preload, and renderer bundles.

## Non-claims

This round does not claim account authentication, schema admission, sessions, turns, streaming, approvals, cancellation, reconnect, typed actions, UI selection, Store compatibility, or live model success. Those remain explicit gates in the protocol decision document.
