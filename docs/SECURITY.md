# Security and privacy model

## Trust boundaries

Desky processes untrusted agent text, tool metadata, avatar files, catalog JSON, remote gateway traffic, and user-selected local files. The Electron renderer is treated as untrusted even though its source ships with the app.

## Baseline controls

- Renderer sandbox enabled.
- `contextIsolation: true`; `nodeIntegration: false`.
- Narrow preload bridge with explicit IPC channels.
- Content Security Policy denies arbitrary scripts, frames, objects, and navigation.
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

## Avatar parser safety

- Enforce download and decompressed-size limits.
- Confirm file signature and parse through maintained libraries.
- Block external resource fetches not declared and validated by the asset loader.
- Bound texture dimensions, skeleton size, morph count, and animation duration.
- Dispose failed parses and avoid persisting rejected content.

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

As of the foundation build, `npm audit --omit=dev` reports zero production vulnerabilities. The full audit reports advisories in Electron Forge's archive extraction, rebuild, prompt, and development-server dependency tree. npm's automatic forced fix would downgrade Forge packages to incompatible historical versions, so it is not applied.

Until upstream packages resolve the tree:

- Forge remains exact-version pinned.
- CI runs on fresh, isolated hosted workers and does not package untrusted source archives.
- Production dependency audit remains a hard gate.
- Full-audit results are reviewed on every dependency update.
- Unresolved high/critical build-tool findings block a public release unless they are removed or receive a written, scoped security acceptance.

## Vulnerability reporting

A `SECURITY.md` contact and coordinated disclosure window must be added before the repository becomes public. Until an owner-provided security address exists, the repository remains non-public and `package.json` remains private.
