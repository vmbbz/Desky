# F5a.2 Codex schema baseline — 2026-08-24

## Claim boundary

This gate makes Desky's admitted Codex protocol reproducible without shipping generated upstream source. It does not register Codex, start a model turn, enable reconnect, expose a workspace picker, or claim Store compatibility.

## Baseline contract

- Admitted CLI: `codex-cli 0.146.0-alpha.3`.
- Generator: `codex app-server generate-json-schema --out <temporary-directory>` without `--experimental`.
- Isolation: a fresh temporary `CODEX_HOME`; reviewed environment variables only; no renderer path or executable input.
- Bounds: at most 512 JSON files, 2 MiB per file, and 16 MiB total raw output. Symbolic links, special entries, non-JSON files, and invalid JSON fail.
- Canonicalization: recursively sorted object keys and preserved array order. This removes generator object-map ordering noise without hiding semantic changes.
- Baseline: 273 files, 1,511,581 canonical bytes, SHA-256 `bc8adec76ef96c5000c2cd7de1359387880312e5c31d4fe874b155674ded11e2`.
- Individual pins: RPC request/notification envelopes and all initialization, account, thread, turn, item, and approval schemas consumed by Desky.
- Output lifecycle: generated files are removed after verification. Only `schema-baseline.json` metadata is committed and bundled.

## Commands

- `npm run codex:schema:verify` regenerates and verifies the admitted baseline without repository writes.
- `npm run codex:schema:refresh` rewrites hashes for the manifest's already-reviewed CLI version. Its diff must be inspected alongside protocol validators and malformed fixtures before commit.

For a deliberate CLI upgrade, first review the upstream protocol and edit the manifest's `codexCliVersion`; then refresh, inspect every changed consumed schema, update safe projection validators and fixtures, and run the complete verification matrix. Runtime executable admission imports the same manifest version, preventing a schema/runtime version split.

## Validator behavior

- Initialization and account details are structurally validated but never forwarded to the renderer.
- Thread lists are bounded and reject malformed entries rather than silently dropping them. Schema-valid long names/previews are accepted but projected to 100-character renderer labels.
- Active-turn start, streamed assistant deltas, item lifecycle timestamps/types, and terminal status/error shapes are validated before state mutation.
- Malformed consumed notifications close the supervised runtime and emit one safe connection failure.
- Malformed or wrong-scope command/file approval requests are declined.
- Unknown notifications outside Desky's consumed surface remain ignored for forward compatibility under the exact admitted CLI.

## Verification

- `npm run codex:schema:verify`: passed against 273 freshly generated schemas and the pinned canonical SHA-256.
- `DESKY_CODEX_LIVE=1 npm run test:codex:live`: passed initialization, account admission, and 23-thread listing without starting a model turn or consuming credits.
- The first stricter live pass found a schema-valid historical preview of 61,906 characters. Validation was corrected to accept schema-valid strings and project renderer labels to 100 characters; no content values were logged during the structural probe.
- `npm test`: 42 test files passed, 2 skipped; 193 tests passed, 2 skipped.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run package -- --arch=x64`: passed; generated Windows output remains ignored and uncommitted.

## Next gate

Main-owned workspace selection and explicit sandbox disclosure are complete. Next is bounded restart/reconnect and process-tree termination evidence. Codex remains unregistered and `production: false` until the packaged authenticated model/tool/approval/cancellation matrix passes.
