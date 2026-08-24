# F5a.2 Codex runtime conformance — 2026-08-24

## Scope and claim boundary

This round implements and tests the provider runtime behind the generic port, but does not register or expose it. Codex remains direct-only, `production: false`, reconnect unavailable, and typed agent actions unavailable.

## Executable and schema admission

- Main-owned PATH enumeration; no renderer executable input.
- Platform-correct `codex`/`codex.exe` candidate construction, real absolute file resolution, no-shell `--version` call, five-second timeout, and 4 KiB output bound.
- Exact `codex-cli 0.146.0-alpha.3` admission matching the schema set generated locally on 2026-08-24.
- Minimal reviewed child environment. Home/config, platform runtime, locale, terminal, PATH, and proxy variables are allowed; ambient API keys and unrelated values are excluded.

## Semantic conformance implemented

- Existing-account check through `account/read`; missing required auth fails closed with a sign-in instruction.
- Bounded thread list, create/name, resume/select, and selected-session state.
- One active turn, accepted-input and thinking events, ordered assistant deltas, and cancellation through `turn/interrupt`.
- Supported tool item start/completion pairing with no raw command, output, diff, arguments, reasoning, or paths.
- Command and file-change server requests scoped to selected thread and live turn; finite generic decisions map to Codex `accept`, `acceptForSession`, or `decline`.
- Wrong-session and over-capacity approval requests are declined; unknown/duplicate approval resolution fails closed.
- Completed/interrupted/failed terminal normalization with bounded error redaction and exactly-one delivery.
- Explicit disconnect and unexpected process-exit behavior.

## Live installed-CLI smoke

`DESKY_CODEX_LIVE=1 npm run test:codex:live` passed against the installed admitted CLI. It initialized app-server, read current account state, listed threads, and disconnected. It deliberately did not start a model turn or consume credits.

## Automated verification

- `npm test`: 41 test files passed, 2 skipped; 190 tests passed, 2 skipped.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run package -- --arch=x64`: passed; Electron Forge produced the unpacked Windows x64 package. Generated output remains untracked.

## Remaining admission gates

- Reproducible generated-schema artifact/validator pipeline and malformed coverage for every consumed native shape.
- Main-owned workspace folder picker and explicit read-only/workspace-write disclosure; no raw renderer path trust.
- Bounded automatic restart/reconnect and process-tree termination evidence.
- Stable structured Desky action discovery or truthful continued unsupported status.
- Direct-profile connection UI and registry admission only after the above.
- Packaged authenticated real turn, assistant stream, tool approval allow/deny, interruption during tool execution, recovery, CLI upgrade mismatch, and process-crash matrix on Windows and macOS.
