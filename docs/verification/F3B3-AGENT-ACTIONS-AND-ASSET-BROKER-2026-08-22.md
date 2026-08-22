# F3b3 agent actions and avatar asset broker verification

Date: 2026-08-22

Platform: Windows 11 x64

Desky version: 0.1.0

## Scope

This round implemented the first provider-neutral agent-action command and its OpenClaw transport, then repaired the production-relevant avatar loading boundary discovered during live desktop testing.

The action path is deliberately structured and ephemeral:

```text
OpenClaw typed tool start
  -> exact tool/session/turn validation in main
  -> provider-neutral avatar.perform command
  -> ambient-only typed IPC
  -> bounded Wave/Jump motion queue
```

No assistant-text parsing, arbitrary clip ID, URL, path, duration, amplitude, or bone transform crosses this boundary. Command identity is derived from session, turn, and native tool-call identity, remains stable across reconnects, and is rejected after the first admission.

## Automated evidence

- `npm test`: 23 files passed, 1 intentionally skipped; 97 tests passed, 1 skipped.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run package`: passed after stopping the development watcher that shares Electron Forge's build workspace.
- `npm audit --omit=dev`: 0 vulnerabilities.
- Full `npm audit`: 31 development-tool advisories: 1 critical, 24 high, 3 moderate, 3 low. These remain the documented upstream Electron Forge release gate; no incompatible forced downgrade was applied.
- OpenClaw 2026.8.1 `plugins validate` under its required Node 22.22.3 runtime returned `{ "valid": true, "pluginId": "desky-actions", "errors": [] }`.
- The linked local development-profile install reports `enabled: true`, `status: loaded`, installed dependencies complete, and exactly one declared tool contract: `desky_avatar_action`.

The default shell's Node 22.15.0 could not run this OpenClaw build because its embedded SQLite 3.49.1 is behind OpenClaw's WAL-safety floor. Validation was therefore run with the same Node 22.22.3 executable as the local Gateway. The safety check was not bypassed.

## Live and packaged evidence

The initial live development surface displayed `Failed to fetch` in place of Milk even though the catalog and model endpoints returned HTTP 200 and the model host allowed cross-origin access. The failing renderer fetch was replaced by a main-process broker that:

- owns both catalog and model network access;
- accepts no arbitrary renderer URL;
- permits HTTPS only and an explicit avatar-host allowlist;
- rejects credentials, custom ports, and unapproved hosts;
- caps catalog and model bytes and applies a 60-second request timeout; and
- returns only typed catalog metadata plus the exact model bytes through preload IPC.

After the repair, live Desky visibly rendered Milk. Windows Notification Center was opened above the ambient companion and then closed; the OS overlay remained authoritative and Desky did not break or force itself above that surface.

A later native-image review found that this first live claim was too broad: the VRM geometry was present, but Electron Forge's default development CSP blocked Three.js's generated `blob:` request for Milk's embedded texture, leaving the carton pale and unlabelled. The packaged `desky://` surface was unaffected and decoded the same embedded 1024x1024 map. Desky now supplies an explicit least-privilege development CSP aligned with the packaged renderer policy, with only Forge's required development `unsafe-eval` addition. A fresh clean-profile development capture then reported `avatarState: ready`, `avatarTextureCount: 1`, and visibly restored Milk's face, blue bands, and label. Policy alignment is fixture-tested, and the visual harness records avatar state and texture count so geometry-only rendering can no longer be mistaken for a successful avatar smoke.

A clean-profile packaged capture passed with:

- URL `desky://app/main_window/index.html?surface=ambient`;
- title `Desky` and document state `complete`;
- visible `Milk · VRM 0.x · CC0 · 100Avatars R1` provenance;
- `avatarState: ready` and `avatarTextureCount: 1`;
- `documentFocused: false`;
- exactly two intended interactive regions; and
- the minimal collapsed `Connect an agent` launcher.

Screenshots, logs, downloaded avatar bytes, temporary profiles, and package output remain ignored under `out/`; none is committed.

## Agent setup decision

Users do not edit system prompts, `AGENTS.md`, `CLAUDE.md`, or individual chats. The Gateway's registered tool catalog supplies the typed schema and usage description. An OpenClaw operator performs one reviewed plugin install/enable/policy step and restarts the Gateway. Other future adapters must map a supported structured tool, MCP, app-server, or SDK surface into the same command; runtimes without such a surface do not receive a text-parsing fallback.

## Remaining gates

- Complete a live agent turn that invokes Wave and Jump through the restarted local Gateway and visually verify each one.
- Observe duplicate, wrong-session, terminal-turn, and unavailable-client behavior live in addition to the contract fixtures.
- Add action capability reporting to the provider-neutral adapter descriptor in F5a.
- Admit the first owner-approved redistributable external animation clip.
- Add representative rights-reviewed VRM 0.x and 1.0 binary fixtures.
- Add truthful speech visemes only after a real timing source exists.
