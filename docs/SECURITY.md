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
