# Security and privacy model

## Trust boundaries

Desky processes untrusted agent text, tool metadata, avatar files, catalog JSON, remote gateway traffic, and user-selected local files. The Electron renderer is treated as untrusted even though its source ships with the app.

## Baseline controls

- Renderer sandbox enabled.
- `contextIsolation: true`; `nodeIntegration: false`.
- Narrow preload bridge with explicit IPC channels.
- Content Security Policy denies arbitrary scripts, frames, objects, and navigation.
- Packaged renderer assets use the privileged, local `desky://` scheme; the legacy file-protocol extra-privilege fuse stays disabled.
- Navigation and new-window requests denied unless explicitly allowlisted.
- Secrets stay in the main process and operating-system credential storage.
- Runtime input is schema-validated before state transitions.
- Production builds reject unsigned update metadata and unexpected executable downloads.

## Agent safety

- Desky does not execute tools; the runtime remains the tool authority.
- Approval cards show the requesting runtime, session, action class, safe target summary, and whether the decision is one-time or persistent.
- Approval defaults to deny on timeout, disconnect, restart, or schema mismatch.
- The companion cannot animate an approval as accepted before runtime acknowledgement.
- Dangerous permission modes require explicit onboarding disclosure and persistent visible status.
- Agent-originated avatar actions require an exact registered tool, selected session, live turn, bounded deduplication identity, and a finite Wave/Jump enum. Other arguments are discarded before IPC; text never selects motion.
- Agent-originated commerce is recommendation/preparation only. The trusted offer is reloaded independently of model text; price, stablecoin, network, recipient, expiry, and grant scope come only from the commerce service and require explicit human approval.
- Payment settlement, durable entitlement, short-lived JWT authorization, and asset delivery are separate trust decisions. JWTs never replace the append-only order/entitlement ledger.
- Release profiles fail closed: a commerce provider disabled for Mac App Store, Microsoft Store, region, or runtime eligibility has no renderer route or main-process command, not merely a hidden button.
- Visual-only actions are reversible and local. Any future action with external side effects must use the runtime's ordinary tool and approval authority instead of this lane.

## Local process supervision

Direct builds may launch supported local runtimes through fixed executable discovery and structured argument arrays:

- No shell interpolation.
- No renderer-provided executable path without validated user selection.
- Minimal inherited environment; secrets passed through supported secure channels.
- Bounded stdout/stderr and event queues.
- Process tree termination on disconnect and application exit.
- Executable version recorded in redacted diagnostics.

Mac App Store builds do not launch arbitrary installed runtimes. Any bundled helper must inherit the app sandbox, be signed as part of the bundle, and have a reviewable fixed purpose.

The Codex adapter is direct-profile only. It accepts no renderer-provided executable path: main scans its PATH for the expected filename, resolves a real absolute file, reads its version without a shell, and currently admits only `codex-cli 0.146.0-alpha.3`, imported from the committed schema-baseline manifest. The protocol verifier generates schemas with `shell: false` inside an isolated temporary `CODEX_HOME`, bounds file count and byte size, rejects links/non-JSON entries, canonicalizes nondeterministic object-key order, verifies full-bundle and consumed-schema SHA-256 values, then deletes generated output. The runtime process receives a reviewed environment allowlist that deliberately excludes ambient API keys and unrelated secrets. App-server JSONL is limited to 1 MiB per message; stderr retention is limited to 64 KiB and renderer diagnostics are redacted; correlated requests time out. Malformed/oversized envelopes, malformed consumed notifications, schema/version drift and tree-termination failure are terminal. Only a typed recoverable process exit can trigger at most three fresh admission attempts; lost turns are never replayed and pending approvals expire. Invalid approval requests are declined. Native reasoning, commands, output, diffs, arguments, account details, and paths are not forwarded.

The admitted Codex client never enables `initialize.capabilities.experimentalApi` and never supplies `thread/start.dynamicTools`. The exact stable and experimental schemas were compared on 2026-08-24: only the experimental thread-start schema exposes `dynamicTools`. Desky therefore reports typed actions as unsupported and returns JSON-RPC `-32601` for an unexpected unadmitted server request, including `item/tool/call`; it does not execute or reinterpret model-supplied arguments. A future MCP-based action helper needs its own signed-process or authenticated-loopback threat model and Store/direct profile review before admission.

Codex descendants are terminated through an OS tree primitive rather than direct-child `kill`: fixed shell-free Windows `taskkill.exe /T /F`, or a detached Unix process group with bounded TERM-to-KILL escalation. The taskkill helper is itself time-bounded. A normal Electron quit is delayed until the adapter registry has been disposed once, with a ten-second outer ceiling. A real Windows parent/descendant test proves explicit tree termination. Cleanup after a root process has already disappeared is best-effort on Windows because the OS may no longer retain the parent-tree identity; this limitation is why no turn is replayed and why the restarted runtime repeats every admission check. Packaged direct-profile evidence now covers the selectable provider, authenticated session, approval controls and process-tree Stop behavior.

`turn/interrupt` is not trusted as a process-containment acknowledgement. The authenticated Windows matrix proved that the admitted app-server could report an interrupted turn while its approved command continued to a delayed filesystem write. Desky now treats Stop as interrupt-then-recycle: after the protocol request it terminates the supervised app-server tree while the root PID is live and freshly re-admits/resumes the thread. A delayed marker test proves that the cancelled descendant no longer reaches its write. If tree termination or re-admission fails, the adapter enters a truthful error state rather than claiming recovery.

Codex never accepts a workspace path through IPC or its opaque adapter configuration. Only the direct-profile Control Center can invoke the native folder picker. Main canonicalizes the selected real directory and returns a short-lived opaque grant with a safe basename label; grants are memory-only, capped at eight, expire after fifteen minutes, and are revalidated before use. Filesystem roots are refused. A read-only grant cannot be replayed as workspace-write; issuing workspace-write requires a native main-process confirmation, and the user's home directory or any selected ancestor containing it cannot receive write scope. `danger-full-access` is absent from the shared contract and UI. The fixed approval policy remains `on-request`; the recommended default is `read-only`. Store-profile IPC rejects workspace selection, and profile-aware construction never instantiates Codex there.

The packaged authenticated harness has one narrowly scoped consent substitute: it activates only for the `codex-ui` exercise when the profile, screenshot and read-only workspace are proper descendants of one uniquely named `desky-codex-ui-*` OS-temporary root. Cross-drive paths, traversal, an ordinary root name, incomplete environment contracts and write scope fail closed. Normal applications therefore continue through the native picker. The harness independently records byte-exact allow evidence and absence of denied/cancelled markers after the cancellation survival window; no test workspace or credential enters the package or repository.

The authenticated adapter exercise deliberately does not inherit `DESKY_VISUAL_TEST_DISABLE_NETWORK`. That legacy flag denies the main-owned avatar fetcher for dedicated cache/offline evidence; applying it to a fresh Codex profile produced a truthful but irrelevant avatar load error. The `codex-ui` policy now keeps live avatar acquisition enabled, while every avatar-specific offline exercise retains the denial behavior.

## Network policy

- TLS for every non-loopback connection.
- Plain WebSocket permitted only on loopback during development and only with a visible insecure-state warning.
- Certificate errors never offer a silent bypass in production.
- Redirects, DNS rebinding, localhost access, and private-network endpoints receive adapter-specific policy.
- Gateway tokens are scoped to the minimum supported permissions.
- OpenClaw requests only `operator.read`, `operator.write`, and `operator.approvals`; device tokens are bound to the paired Ed25519 identity and exact saved endpoint profile.

## OpenClaw credential handling

- The renderer submits an opaque adapter configuration through the generic bridge and clears its credential input after a successful connection. The selected main-process runtime performs exact provider validation; generic IPC never interprets, stores, or broadcasts the credential.
- The credential, device private key, and paired device token are never returned through IPC.
- Persistence uses Electron `safeStorage`; unavailable OS encryption is a hard failure, not a plaintext downgrade.
- Saved vault records contain base64-encoded ciphertext. Connection state contains URL, auth kind, server version, and redacted status only.
- URLs containing user-info, query parameters, or fragments are rejected to keep credentials out of logs and diagnostics.
- Every adapter operation rejection is bounded and provider-redacted before reaching the renderer. OpenClaw authentication and protocol failures additionally remove token/password/authorization patterns, the submitted credential, and any saved device token.

## Hermes foundation security

- The first Hermes topology is an external API server: tools execute on the Hermes server host, not in Desky. Capability admission requires Hermes to report `runtime.mode=server_agent`, server-side tool execution, no split runtime, bearer authentication required, and the exact run/session/approval/stop endpoints Desky consumes.
- Non-loopback endpoints require HTTPS. Plain HTTP is accepted only for literal localhost, IPv4 loopback, or IPv6 loopback and is surfaced as insecure-local state. URL user-info, query parameters, and fragments are rejected.
- The bearer token is held only by the unregistered main-process client and is redacted from errors. Durable OS credential storage is deliberately not implemented yet; the runtime cannot be registered until it uses the existing vault-grade persistence policy or an equivalent provider-specific store.
- JSON responses are capped at 512 KiB and individual SSE frames at 256 KiB. Malformed JSON, incomplete/oversized SSE, capability drift, cross-run events, invalid approval choices, and a stream that closes without a terminal event fail closed.
- Approval scope is never broadened: `allow-always` is offered only when Hermes includes `always`; every local approval route is bound to one run and expires on terminal state or disconnect. Stop remains pending until Hermes emits `run.cancelled`; disconnect records a local cancelled terminal and aborts transport after requesting server stop.
- Hermes live tests never accept a bearer on the command line or in a committed file. The harness reads `DESKY_HERMES_LIVE_TOKEN` from its process environment, confirms invalid-token errors do not echo the submitted secret, and deletes the sessions it creates. The full model matrix is separately gated because its terminal probes execute on the Hermes host; admission-only verification does not require or imply model/provider authorization. The authenticated matrix now passes with Hermes `openai-codex` OAuth and `gpt-5.4`. Its approval probes match Hermes's actual safety detector while targeting unique nonexistent `/tmp/desky-hermes-*` paths, verify that Hermes redacts the target before renderer-safe display, and use only a bounded sleep after allow-once to prove cancellation during execution.
- Hermes reconnects only errors classified by the main-owned client as transport loss, HTTP 408/429, or HTTP 5xx. Authentication failures, malformed JSON/SSE, invalid native events, missing capabilities, and version/model drift never retry. The runtime performs at most three fresh admissions after 0.5/2/6.5 seconds, rechecks the complete capability surface, and restores only a still-listed selected session. Pending approvals expire, a lost turn fails exactly once, and user input is never replayed. A lifecycle generation prevents a delayed retry or stale client from reclaiming state after explicit disconnect or replacement.
- Hermes bearer input crosses the isolated preload bridge once and is cleared from renderer state after success. Persistence uses the same main-process `SecureVault` and Electron `safeStorage` boundary as OpenClaw. The record contains schema version, canonical endpoint, and bearer inside OS-encrypted ciphertext; it is written only after admission and session discovery succeed. Blank-token reuse requires an exact endpoint match. Failed admission or rotation cannot overwrite the prior record, while a successful connection with storage disabled deletes it. Encryption unavailability fails the requested persistence operation instead of silently storing plaintext or downgrading policy.
- Packaged Windows evidence uses a fresh profile and confirms the vault contains only ciphertext, the bearer is absent from renderer text/diagnostics, Stop completes during real tool execution, and a second Desky process reconnects and streams without receiving the bearer again. The test bearer is read from the local Hermes configuration into process environment only for the enrollment pass and is never printed or committed.
- Remote Hermes endpoints must use HTTPS. The pinned Hermes server itself listens with plain aiohttp TCP, so TLS termination belongs to a reverse proxy or private-network ingress controlled by the operator; the bearer must never traverse an unencrypted remote hop. Desky relies on the platform trust store, exposes no `ignoreTLS`/custom-agent escape hatch, classifies known certificate-chain/name/expiry failures as terminal, and replaces native certificate detail with a bounded renderer-safe error. A local HTTP exception exists only for loopback hosts.
- Stable Hermes MCP is an external configuration surface, not permission for Desky to inject code into the gateway. Any future avatar-action MCP helper needs explicit install/remove UX, signed binaries, authenticated local IPC or mutually authenticated remote routing, per-profile configuration consent, upgrade compatibility, tool-schema discovery, and fail-closed teardown. Until that topology is admitted, Hermes advertises avatar actions as unsupported and Desky does not parse model prose into commands.
- A passive admission check runs every 30 seconds only while connected and idle; an active SSE stream is the liveness signal during a turn. The authenticated relay matrix cuts both paths and proves recovery plus no replay. The separately gated process-restart harness accepts only an absolute executable named `hermes`/`hermes.exe`, invokes fixed `gateway restart` arguments with `shell: false`, bounds stderr and runtime, and proves fresh model success after the installed Windows gateway returns.

## Claude foundation security

- The direct Claude topology pins the official Agent SDK exactly and launches its bundled agent process through that supported library. Desky does not discover the unrelated `claude` executable on PATH or scrape CLI output.
- Configuration accepts an opaque workspace grant, never a renderer path. Plan mode resolves only a read-only grant; default/on-request resolves a separately confirmed workspace-write grant. The foundation does not expose bypass-permissions or accept-edits.
- The child environment is rebuilt from a small OS/proxy allowlist. Ambient AI-provider keys and unrelated secrets are dropped; only the explicitly supplied `ANTHROPIC_API_KEY` is added, together with a Desky client identifier and disabled auto-memory. `settingSources: []` prevents user/project settings from silently widening the app-selected baseline.
- Initialization must report `apiKeySource=ANTHROPIC_API_KEY`. Consumer OAuth/login is rejected in accordance with Anthropic's published third-party restriction. The API key remains main-owned, is redacted from every failure, and is not yet persisted; vault integration is a production-admission gate.
- SDK permission callbacks remain the runtime authority. Desky never infers approval from text, never invents persistent scope without SDK suggestions, binds each request to the live turn, denies it on abort/disconnect, and reports only basename/bounded redacted targets. The SDK permission flow can resolve calls before `canUseTool`; authenticated adversarial testing must verify the exact effective policy rather than claiming that callback sees every tool.
- Cancel aborts and closes the SDK query, denies pending callbacks, and records one local cancelled terminal. Full process-tree/crash/clean-package evidence remains required because fixture cancellation is not containment proof.
- Runtime switching disconnects the active adapter before selecting another. State, events, and typed actions from inactive registered runtimes are not forwarded through IPC.

## Avatar parser safety

- Main owns avatar catalog/model download; the sandboxed renderer receives no arbitrary URL-fetch IPC.
- Enforce HTTPS allowlisted registry hosts, request timeouts, download and decompressed-size limits.
- Confirm file signature and parse through maintained libraries.
- Block external resource fetches not declared and validated by the asset loader.
- Bound texture dimensions, skeleton size, morph count, and animation duration.
- Dispose failed parses and avoid persisting rejected content.

Local VRM Animation preview is an explicit control-center action. Main owns the native file chooser and returns no raw path. It rejects files over 32 MiB, malformed/non-VRMA glTF containers, missing/invalid humanoid channel maps, oversized structural counts, and external buffer/image URIs before sending exact bytes to the ambient sandbox. The renderer additionally rejects clips over 120 seconds or 256 tracks. Selection bytes live only in process memory for the current session; this preview path cannot write the asset cache, admit a release asset, or be invoked by agent text.

## Privacy

- No analytics until a separate opt-in is presented.
- No conversation text, prompts, tool arguments, file contents, tokens, or precise filesystem paths in telemetry.
- Diagnostics are previewed before export.
- Users can delete cached assets, connection data, and transcripts independently.
- Privacy labels and policies are generated from implemented behavior, never aspirations.

## Release security gates

- Dependency audit and licence inventory.
- Electron fuses reviewed and set for packaged builds.
- ASAR integrity enabled where supported.
- Code signing and notarization verified on clean machines.
- CSP and renderer sandbox tested in packaged output.
- Secret scan and generated artifact audit.
- Threat-model review for every new adapter or IPC command.

## Current dependency advisory status

As re-verified on 2026-08-22, `npm audit --omit=dev` reports zero production vulnerabilities. The full audit reports 31 findings in Electron Forge's archive extraction, rebuild, prompt, and development-server dependency tree: 1 critical, 24 high, 3 moderate, and 3 low. npm's automatic forced fix would downgrade Forge packages to incompatible historical versions, so it is not applied.

Until upstream packages resolve the tree:

- Forge remains exact-version pinned.
- CI runs on fresh, isolated hosted workers and does not package untrusted source archives.
- Production dependency audit remains a hard gate.
- Full-audit results are reviewed on every dependency update.
- Unresolved high/critical build-tool findings block a public release unless they are removed or receive a written, scoped security acceptance.

## Vulnerability reporting

A `SECURITY.md` contact and coordinated disclosure window must be added before the repository becomes public. Until an owner-provided security address exists, the repository remains non-public and `package.json` remains private.
