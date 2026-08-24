# F5b.2 Hermes authenticated matrix — 2026-08-24

## Result

The Hermes source-runtime gate passes on Windows against a real loopback Hermes API Server and a real model provider. This evidence upgrades F5b.2 from fixture/admission-only status to authenticated streaming, guarded approval, and execution-cancellation proof. It does **not** make Hermes a release-admitted Desky adapter.

## Runtime baseline

- Upstream: `NousResearch/hermes-agent`.
- Source revision: `057dcdf236f8a6a26721c10fcc6ccb72726e272a`.
- Runtime version reported by `/health`: `0.20.5`.
- Clean source checkout: sibling of the local OpenClaw projects at `C:\dev-shared\openclaw-projects\hermes-agent`, detached at the admitted revision with the canonical upstream remote.
- Transport: bearer-authenticated Hermes API Server on `http://127.0.0.1:8642`; plaintext remains loopback-only.
- Model route: Hermes `openai-codex` provider, OAuth-authorized, model `gpt-5.4`.
- Approval policy: `approvals.mode=manual`.
- Local lifecycle: per-user Hermes gateway startup launcher; no administrator-level service or Desky-bundled runtime was installed.

No bearer, OAuth credential, account identity, signing material, or model response containing private data is recorded in this document, the repository, or command-line arguments.

## Live matrix

`npm run test:hermes:matrix:live` sets the three explicit live gates in a child process. The bearer is supplied only through `DESKY_HERMES_LIVE_TOKEN` in that process environment.

| Gate | Verified behavior |
| --- | --- |
| Authentication failure | A fresh wrong bearer is rejected; the submitted value is absent from the renderer-safe error. |
| Capability admission | Hermes reports the exact server-agent execution topology, authentication requirement, version, and run/session/approval routes consumed by Desky. |
| Session lifecycle | Desky creates, selects, and deletes an isolated disposable Hermes session. |
| Real streaming | A real `gpt-5.4` turn streams `DESKY_HERMES_LIVE_OK` and emits exactly one successful terminal. |
| Approval deny | A safety-flagged command produces `approval.requested`; Desky denies the bound request and receives a denied resolution. |
| Approval allow-once | A second safety-flagged command is admitted only for the current operation. No broader scope is inferred. |
| Cancellation during execution | After the approved tool reaches `tool.started`, Desky sends Stop during a 30-second sleep and receives exactly one `turn.failed` terminal with `kind=cancelled`. |
| Cleanup | Runtime transport disconnects and every Desky-created Hermes session is deleted. |

Observed result:

```text
Test Files  1 passed (1)
Tests       3 passed (3)
```

## Approval-probe safety

Hermes manual mode prompts for safety-detector findings, not every terminal invocation. The previous harmless print probe therefore could not exercise the approval endpoint.

The admitted probes use `chmod 777` against a unique, nonexistent `/tmp/desky-hermes-*` path. This deterministically matches Hermes's `world/other-writable permissions` detector but has no filesystem effect because the target does not exist. The denied phase never executes. The allow-once phase continues, via a command separator, to a bounded Python sleep solely to create a real cancellable process. Hermes converts the raw command to the renderer-safe summary `chmod 777 [path]`; the test asserts both the command class and absence of the unique path.

## Repository regression evidence

- `npm test`: 55 files passed, 5 skipped; 254 tests passed, 7 skipped.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run package`: fresh Windows x64 Electron package passed.
- `npm audit --omit=dev`: zero vulnerabilities.
- Full `npm audit`: 31 Electron Forge development-tool advisories remain. npm's forced suggestion is an incompatible Forge downgrade and was not applied.

## Remaining admission gates

F5b.3 subsequently completed bounded reconnect, selected-session restoration, relay-driven idle/active loss, no replay, fixture protocol/version drift, and a real Windows gateway restart. See `docs/verification/F5B3-HERMES-RESILIENCE-2026-08-24.md`.

Hermes stays `production: false`, direct-only, and unregistered until all of the following remaining gates pass:

1. vault-grade bearer persistence and rotation;
2. clean packaged Windows UI lifecycle and process ownership evidence;
3. remote HTTPS/TLS policy and Store-profile eligibility decision;
4. stable typed Desky-action discovery or a truthful unsupported disposition;
5. macOS package, credential-store, lifecycle, and performance evidence.
