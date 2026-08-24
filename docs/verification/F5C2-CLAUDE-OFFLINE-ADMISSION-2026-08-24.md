# F5c.2 Claude offline admission evidence — 2026-08-24

## Result

The Claude direct adapter remains an unregistered `production: false` admission candidate because this machine has no authorized `ANTHROPIC_API_KEY`. Consumer Claude login was not discovered or reused. No real-model, approval, cancellation, or authenticated package claim is made in this gate.

The executable offline slice passes:

- exact `@anthropic-ai/claude-agent-sdk 0.3.241` and bundled Claude Code `2.1.241` admission;
- reviewed environment, no user/project settings, and strict empty MCP configuration;
- effective workspace and permission-mode validation from the typed init frame;
- API-key-source-only admission and consumer-login rejection;
- main-owned OS-encrypted credential reuse;
- post-success-only enrollment, replacement, and explicit removal;
- preservation of the previous credential after rejected auth/policy/version drift;
- renderer-safe key/path redaction;
- direct-only, exact-exercise construction of the unadmitted Control Center candidate; and
- a separate admission package profile that includes the platform SDK executable without inflating ordinary Desky packages before promotion.

## Verification

```text
npm test
55 files passed, 5 skipped
269 tests passed, 9 skipped

npm run typecheck
pass

npm run lint
pass

npm run package
pass; ordinary package contained app.asar and no Claude platform executable

npm run package:claude:admission
pass
out/Desky-win32-x64/resources/claude.exe
337,745,056 bytes
Authenticode status: Valid
Signer: Anthropic, PBC

packaged admission UI exercise
exit 0
adapter options: openclaw,codex,hermes,claude
Claude provider selected and form visible
visual exercise error: none

npm audit --omit=dev
0 vulnerabilities
```

The admission executable is sourced from the exact optional platform dependency `@anthropic-ai/claude-agent-sdk-win32-x64 0.3.241` and is never committed. The runtime receives its explicit packaged path; it does not trust a PATH-installed `claude` binary.

## Remaining authenticated gate

Provide `ANTHROPIC_API_KEY` from an Anthropic Console/API account authorized for Desky testing, then run the source and admission-package matrices for real streaming, deny/allow, Stop during actual execution, post-crash recovery, clean exit, encrypted reuse in a second process, and secret-absence diagnostics. Only a passing matrix may set the descriptor to `production: true` and register Claude in ordinary direct builds.
