# F5a.2 Codex authenticated matrix — 2026-08-24

## Claim boundary

This gate proves authenticated behavior through the production `CodexRuntime`, admitted `codex-cli 0.146.0-alpha.3`, supervised stdio client, real model and real built-in tools. It uses one isolated temporary read-only workspace and an explicitly named conformance thread. It does not yet claim that Codex is registered or reachable through the packaged provider picker; that is the next direct-profile admission gate.

The opt-in command is `npm run test:codex:matrix:live`. Ordinary `npm test` skips it and cannot consume credits. A parent runner owns the temporary workspace and removes it only after Vitest and all supervised descendants exit.

## Passed live cases

- Assistant streaming: the real model streamed `DESKY_CODEX_STREAM_OK` and completed normally.
- Approval deny: Codex requested permission for a real write; Desky returned deny, emitted normalized requested/resolved events, and the deny marker did not exist.
- Approval allow once: Desky allowed one requested write and verified the exact `DESKY_ALLOW_OK` bytes.
- Cancellation during tool execution: an approved command was scheduled to create `DESKY_CANCEL_BAD` after ten seconds. Desky stopped it after `tool.started`; twelve seconds later the marker remained absent.
- Same-session recovery: a fresh response completed after cancellation and thread restoration.
- Unexpected app-server crash: the harness killed the supervised root process, observed `reconnecting`, completed fresh admission, resumed the selected thread, created a replacement process, and streamed `DESKY_CODEX_CRASH_RECOVERY_OK`.

No prompt, assistant transcript, command output, raw path, account detail or generated marker is committed. The harness archives its exact `Desky conformance …` thread after the run and removes earlier matching test threads before starting, without touching ordinary user sessions.

## Defect discovered and repaired

The first terminal-only cancellation check passed, but Windows cleanup remained locked until the nominal command duration ended. A stronger delayed-write probe proved the approved command continued after app-server emitted an interrupted terminal event. Therefore `turn/interrupt` alone did not satisfy Desky's Stop contract.

`CodexRuntime.cancel()` now:

1. sends the stable `turn/interrupt` request;
2. resolves any outstanding approval state as cancelled;
3. emits no more than one cancelled terminal event;
4. enters a visible reconnecting state;
5. terminates the full app-server process tree while its root identity is live;
6. repeats workspace, executable/schema, initialization, account and thread admission;
7. resumes the selected thread without replaying the cancelled turn.

The strengthened delayed-write case passes with this implementation.

## Deterministic companion evidence

- CLI mismatch is rejected by exact-version admission fixtures.
- Semantic schema mismatch is rejected by the canonical baseline verifier.
- Crash/reconnect, lost-turn non-replay, stale-client isolation, approval expiry, malformed consumed protocol and process-tree termination remain covered by fixtures and the real Windows containment test.
- Full repository suite: 45 files passed and 4 opt-in files skipped; 209 tests passed and 4 skipped.
- TypeScript typecheck, ESLint, the 273-file Codex schema baseline and production dependency audit passed; production dependencies report zero vulnerabilities.
- Electron Forge Windows x64 packaging passed. A fresh isolated packaged control-center lifecycle exited with code 0, produced its renderer diagnostic and capture, reported a live renderer process and no exercise error; its temporary profile and capture were removed.

## Next gate

Register Codex only for the direct distribution profile, add an explicit provider picker without weakening OpenClaw or Store reachability, and repeat authentication, session creation, streaming, approval and Stop behavior through the packaged UI. Codex remains `production: false` and unreachable until that round passes.
