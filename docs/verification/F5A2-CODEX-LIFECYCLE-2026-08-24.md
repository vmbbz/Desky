# F5a.2 Codex lifecycle supervision — 2026-08-24

> Status update: the later direct-profile admission and packaged authenticated matrix passed; see `F5A2-CODEX-DIRECT-ADMISSION-2026-08-24.md`. The boundary below records what this earlier gate alone established.

## Claim boundary

This gate implements bounded local app-server replacement, safe thread recovery, OS process-tree teardown and awaited normal application shutdown behind the unregistered Codex adapter. The follow-on typed-action disposition confirmed that client-local tools are experimental and retained truthful unsupported capability; it does not register Codex, claim typed Desky actions, claim a packaged authenticated model/tool/approval matrix, or make the experimental upstream app-server surface production-stable.

## Recovery contract

- Only a typed recoverable process exit may restart. Malformed JSON/framing, malformed consumed protocol, tree-termination failure, explicit disconnect and application shutdown do not.
- Retry delays are fixed and bounded at 500 ms, 1.5 seconds and 4 seconds. Configuration cannot supply more than three attempts or any delay above 30 seconds.
- Every attempt repeats main-owned workspace-grant resolution, executable/version/schema discovery, initialization, account admission and authoritative thread listing.
- A formerly selected thread is resumed only if it still appears in the new thread list.
- An active turn lost with the process emits one terminal failure and is never sent again. Pending approvals emit `expired` and are never auto-accepted or replayed.
- Each replacement gets a new connection identity. Client identity and a lifecycle generation prevent stale callbacks or delayed retries from reclaiming state after disconnect.

## Process containment

- Windows invokes the fixed absolute system `taskkill.exe` with `/T /F`, `shell: false`, hidden stdio and a five-second helper timeout.
- Unix starts app-server as its own detached process group, sends group `SIGTERM`, waits 500 ms, then conditionally escalates to group `SIGKILL`.
- Protocol failure and explicit disconnect use the same tree terminator. Unexpected-root-exit cleanup is attempted before reconnect.
- Electron's initial `before-quit` is prevented while the adapter registry disposes once; a ten-second outer bound then permits final quit.

Windows cannot guarantee descendant discovery after a root process has already vanished and its process-tree identity has been discarded. That cleanup path is therefore best-effort and never authorizes turn replay. Explicit disconnect/application teardown calls the OS tree primitive while the root identity is live.

## Verification

- Focused client/runtime/process/shutdown suite: 20 tests passed.
- Opt-in real Windows containment test: a shell-free Node parent created a long-running descendant; the production terminator removed both and the test observed both PIDs exit.
- Full repository suite: 45 files passed and 3 opt-in files skipped; 207 tests passed and 3 skipped.
- Installed Codex live smoke: exact admitted CLI initialized, account state and thread list were read, then the production Windows tree terminator closed it successfully without a model turn.
- Codex schema verification: 273 schemas matched bundle digest `bc8adec76ef96c5000c2cd7de1359387880312e5c31d4fe874b155674ded11e2`.
- TypeScript typecheck: passed.
- ESLint: passed.
- Electron Forge Windows x64 packaging: passed; generated output remains ignored and uncommitted.

During live verification, closing stdin before Windows tree termination exposed a root-PID race. The final implementation invokes the OS tree primitive while the root identity is still live; both the installed-Codex smoke and real descendant test pass with that ordering.

## Next gate

Run the packaged authenticated model stream, tool approval allow/deny, cancellation-during-tool, reconnect/crash and CLI-mismatch matrix before any registry admission. The typed-action discovery question is closed in `F5A2-CODEX-ACTION-DISPOSITION-2026-08-24.md`.
