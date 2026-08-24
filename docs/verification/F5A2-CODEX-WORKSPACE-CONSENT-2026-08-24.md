# F5a.2 Codex workspace consent — 2026-08-24

> Status update: the form was subsequently exposed only in direct packages and passed packaged authenticated admission; see `F5A2-CODEX-DIRECT-ADMISSION-2026-08-24.md`. The claim boundary below records this earlier isolated gate.

## Claim boundary

This gate implements the workspace and sandbox consent contract behind the unregistered Codex adapter. The form is compiled for future direct-profile provider selection but is unreachable because main still registers only OpenClaw. This round does not claim reconnect, process-tree termination, typed Desky actions, packaged model turns, Store compatibility, or Codex production admission.

## Authority model

- Renderer adapter configuration contains only an opaque `workspaceGrantId` and `read-only` or `workspace-write`.
- Only a direct-profile Control Center webContents may invoke the native directory picker; Store builds and ambient surfaces fail closed.
- Main canonicalizes and validates the selected real directory. IPC returns only its basename label, grant id, expiry, and maximum approved sandbox—not the canonical path.
- Grants are memory-only, capped at eight, valid for fifteen minutes, and revalidated before runtime use.
- Filesystem roots are rejected.
- A read-only grant cannot be upgraded to workspace-write. Changing upward clears the UI grant and requires another folder selection.
- Workspace-write issuance requires a native main-process warning confirmation.
- The user's home directory, or an ancestor containing it, cannot become a workspace-write root. A narrower project folder remains eligible.
- Revocation, expiry, bounded eviction, missing directories, retargeted canonical paths, and invalid ids fail closed.

## Permission disclosure

`read-only` is the recommended default. It permits inspection; edits, command execution, and network access require approval. `workspace-write` allows reads, edits and commands inside the selected workspace; outside-workspace and network access still require approval. The app-server thread policy remains `on-request`. `danger-full-access` does not exist in Desky's shared configuration, UI, or runtime validator.

These choices follow the official Codex app-server `cwd`, `approvalPolicy`, and `sandbox` fields. They do not weaken Electron's own renderer sandbox.

## Runtime integration

`CodexRuntime` now requires an injected main-owned grant resolver before executable discovery. It rejects raw workspace paths, revalidates the returned absolute directory, uses that directory only for `thread/start.cwd`, and redacts it from connection failures. This dependency makes accidental registry admission without a workspace authority fail immediately.

## Verification

- `npm run codex:schema:verify`: passed against all 273 pinned generated schemas.
- `DESKY_CODEX_LIVE=1 npm run test:codex:live`: passed using a real broker-issued read-only grant; initialized the installed admitted CLI, read account state, listed sessions, and started no model turn.
- `npm test`: 43 test files passed, 2 skipped; 199 tests passed, 2 skipped.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run package -- --arch=x64`: passed; generated Windows output remains ignored and uncommitted.

## Next gate

Completed in `F5A2-CODEX-LIFECYCLE-2026-08-24.md`: bounded automatic restart/reconnect and real Windows process-tree termination evidence. The provider remains unregistered and `production: false`.
