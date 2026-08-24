# F5a.2 Codex typed-action disposition — 2026-08-24

## Decision

Codex typed Desky actions remain `unsupported`. The admitted app-server protocol has no stable client-local registration/discovery surface. Its documented `thread/start.dynamicTools` registration and `item/tool/call` callback require the experimental API.

Stable MCP discovery and invocation are real but materially different: Codex connects to an independently configured MCP server. Desky would need to ship or coordinate a separately trusted helper, not register an in-process callback. That topology is deferred until it has explicit signing, process, authentication, configuration, upgrade, removal and release-profile contracts.

## Evidence

- Official app-server documentation marks dynamic tool calls experimental and requires `initialize.params.capabilities.experimentalApi`.
- Installed admitted CLI: `codex-cli 0.146.0-alpha.3`.
- Fresh non-experimental schema bundle: 273 files; `v2/ThreadStartParams.json` has no top-level `dynamicTools` property.
- Fresh `--experimental` schema bundle: 347 files; `v2/ThreadStartParams.json` does expose top-level `dynamicTools`.
- The committed non-experimental baseline now individually pins `v1/InitializeParams.json` and `v2/ThreadStartParams.json`, in addition to its full bundle digest.

Source: [Codex App Server](https://developers.openai.com/codex/app-server/).

## Enforced contract

- `initialize` contains only Desky client metadata; it does not opt into `experimentalApi`.
- `thread/start` contains workspace, fixed approval policy, admitted sandbox and persistence choice; it does not send `dynamicTools`.
- `codexFoundationCapabilities.agentActions` advertises `unsupported`, `transport: none`, and no actions.
- An unexpected unadmitted server request, including `item/tool/call`, receives JSON-RPC `-32601` and is never executed or translated from model arguments.
- Existing stable command/file approval requests retain their scoped, validated allow/deny handling.

## Verification

- Focused app-server client/runtime/schema suite: 3 files and 19 tests passed.
- Full repository suite: 45 files passed and 3 opt-in files skipped; 209 tests passed and 3 skipped.
- Installed-Codex no-turn live smoke: 1 test passed; exact CLI admission, initialization, account state, thread listing and production teardown completed.
- Non-experimental schema verification: 273 files matched bundle SHA-256 `bc8adec76ef96c5000c2cd7de1359387880312e5c31d4fe874b155674ded11e2`.
- TypeScript typecheck, ESLint, production dependency audit and Electron Forge Windows x64 packaging passed. Production dependencies reported zero vulnerabilities.

## Next gate

The authenticated source-runtime matrix is now recorded in `F5A2-CODEX-AUTHENTICATED-MATRIX-2026-08-24.md`. Next register Codex only in the direct profile, add explicit provider selection, and repeat the matrix through the packaged UI/lifecycle boundary. Codex remains `production: false` and unreachable until that admission round.
