# F5a.2 Codex direct-profile admission — 2026-08-24

## Claim boundary

Codex is now an admitted production adapter in Desky's direct-download profile. The exact packaged Windows x64 application selected the provider through the Control Center, used the installed Codex account through the supervised official app-server, created a real thread, streamed model output, exercised real command approvals, stopped an executing descendant, reconnected, resumed the selected thread and streamed again.

This does not claim Mac App Store compatibility, remote Codex transport, arbitrary CLI-version compatibility, or typed avatar-action registration. The official app-server surface still makes client-local `dynamicTools` experimental, so Desky does not enable that API and reports Codex avatar actions unsupported. Stable MCP would require a separately configured and independently admitted helper/server; it is not silently substituted. See the [official Codex app-server documentation](https://developers.openai.com/codex/app-server/).

## Admitted architecture

- Direct-profile startup constructs both `OpenClawRuntime` and `CodexRuntime`; the provider picker enumerates cloned descriptors from the main-process registry.
- Store-profile startup constructs only `OpenClawRuntime`. Codex is absent rather than merely hidden or disabled in the renderer.
- Selecting a provider form does not disconnect the active runtime. The main registry performs the bounded teardown/switch only when Connect submits that provider's opaque configuration.
- Codex workspace selection remains a direct-profile, Control-Center-only native consent operation. The renderer receives an opaque, expiring grant and safe label, never the canonical path.
- Codex remains pinned to `codex-cli 0.146.0-alpha.3` plus the exact 273-schema canonical baseline. Version or consumed-schema drift fails closed.

## Packaged authenticated matrix

The final package at `out/Desky-win32-x64/Desky.exe` passed the following against a fresh profile and isolated read-only OS-temporary workspace:

1. Selected Codex from the real provider picker and obtained the scoped workspace grant.
2. Connected through the renderer, preload, generic adapter IPC, registry and supervised runtime; the final diagnostic reported `activeAdapterId: codex` and `adapterStatus: connected`.
3. Created a named `Desky conformance packaged …` thread and streamed exactly `DESKY_CODEX_PACKAGED_STREAM_OK`.
4. Denied an actual shell write through the rendered approval card; the denied marker remained absent.
5. Allowed one actual shell write; the main-process oracle read the exact 23-byte `DESKY_PACKAGED_ALLOW_OK` value.
6. Allowed a delayed real shell command, waited until the active-turn Stop control was actionable, pressed Stop, observed `reconnecting`, and waited twelve seconds beyond the delayed-write deadline. The cancelled marker remained absent.
7. Streamed exactly `DESKY_CODEX_PACKAGED_RECOVERY_OK` after process-tree replacement and selected-thread restoration.

Final machine-readable results:

- `visualExerciseError: null`
- `codexUiExercise: passed`
- `codexReconnectObserved: true`
- `deniedMarkerAbsent: true`
- `allowedMarkerExact: true`
- `cancelledMarkerAbsent: true`

The separate final-profile captures reported `openclaw,codex` for direct and only `openclaw` for Store, with `codexFormVisible: false` in Store and no visual exercise error.

Follow-up visual review found that the original manual harness had also set the avatar cache/offline network-denial flag on its fresh profile. The adapter matrix was valid, but the ambient companion consequently showed an unrelated fetch failure. The harness policy now excludes `codex-ui` from avatar network denial. A fresh packaged live acquisition independently returned Milk `ready`, one mapped texture, advancing motion and no clip/exercise error; the offline avatar tests remain denied as designed.

## Harness security boundary

The native folder picker is never broadly bypassed. The package harness can issue only a read-only grant when all of these are true:

- the exercise is exactly `codex-ui`;
- capture path, profile and workspace are proper descendants of one `desky-codex-ui-*` root;
- that root is itself a proper descendant of the operating-system temporary directory;
- paths remain on the expected drive and contain no traversal;
- the complete environment contract is present.

Unit cases reject an ordinary root name, workspace/capture traversal, cross-drive workspace, write scope and incomplete activation. Normal application launches continue through the native picker. No credentials, workspace, marker, generated schemas, screenshots or package outputs are committed.

## Deterministic verification

- Full repository suite: 47 files passed and 4 opt-in files skipped; 218 tests passed and 4 skipped.
- Authenticated source-runtime matrix: one live case passed, covering streaming, deny/allow, real descendant cancellation, same-session recovery, unexpected process crash/reconnect and post-crash streaming.
- Codex schema verification: 273 schemas; canonical digest `bc8adec76ef96c5000c2cd7de1359387880312e5c31d4fe874b155674ded11e2`.
- TypeScript typecheck and ESLint passed.
- Production dependency audit reports zero vulnerabilities.
- Electron Forge Windows x64 packaging passed after the descriptor became `production: true`; the exact resulting package passed both profile captures and the authenticated matrix above.

## Defects rejected during the gate

- A first automation attempt incorrectly waited for the presentation state `working` after approval; approval resolution truthfully transitions the companion back to thinking while the command runs. The final gate keys off the authoritative active turn plus enabled Stop control.
- A second attempt found the New button before React had re-enabled it after connection. The final gate waits for actionability, not DOM presence.
- A prose-only exact-content prompt allowed the model to append punctuation. The final gate supplies an exact command and independently checks bytes in main.

These were harness defects, not converted into product exceptions or false passes.

## Next gate

Freeze the provider-neutral adapter conformance suite and public SDK boundary against the two admitted production implementations, OpenClaw and Codex. Then perform current-source admission research for Claude's supported structured interface and Hermes' programmatic transport. Neither may scrape terminal presentation text or weaken direct/Store capability profiles. x402 remains tracked separately under F4x and is not coupled to adapter admission.
