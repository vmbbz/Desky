# F5d.4 speech-plane and package disposition — 2026-09-01

## Claim

The next multi-provider voice architecture and its package boundary are admitted as a documented release gate. This record does not claim Hermes, Codex, or Claude voice implementation, and it does not close the remaining OpenClaw F5d.3 live audio matrix.

## Source audit

- Current OpenClaw voice remains the only implemented Deskiii path.
- Pinned Hermes source `057dcdf236f8a6a26721c10fcc6ccb72726e272a` contains `/api/audio/transcribe`, `/api/audio/voice-config`, and `/api/audio/speak-stream` on its Dashboard/Desktop web server, not on Deskiii's admitted `/v1` API Server. The admitted server explicitly advertises `audio_api: false` and `realtime_voice: false`. No Hermes speech design is therefore admitted yet; provider credential export remains rejected.
- Pinned Codex source `6478a751fde8884b2fdc76486fe23175a8e795d4` contains `thread/realtime/*` audio protocol, but the methods are experimental. The published stable app-server overview does not list them. Production capability remains disabled.
- The supported Claude Agent SDK surface has no documented audio transport. Claude requires the shared cascade design after its existing authenticated admission gate.

## Package evidence

Command:

```powershell
npm run make:windows:direct:dev
```

Result:

- make completed successfully;
- ASAR release policy passed with 13,190,004 inspected bundle bytes and four commerce signatures absent;
- setup executable: 148,328,448 bytes, SHA-256 `e54489ad479f5d7c3eaebd2922b9848355ea982311e7e4b92b083022a9e4b957`;
- full update package: 147,282,790 bytes, SHA-256 `4fad49bdb997518b84b8a24f48c0c36a720376fe8586a2e850ec902930828ad1`;
- production dependency audit: zero vulnerabilities;
- development artifact remained unsigned as required;
- current package root: 387,571,359 bytes across 75 files;
- current `app.asar`: 13,197,736 bytes;
- direct-installer budget remaining: 46,671,552 bytes.
- eight external agent/speech runtime payload signatures absent under the unpacked update package.

`npx asar list out/Deskiii-win32-x64/resources/app.asar` reports compiled Webpack/HTML/licence/package entries only. No external gateway, Python runtime, local speech model, native audio engine, or Claude executable is present.

The Windows distributable verifier now fails on external-runtime payload signatures in ordinary package roots. The existing ASAR verifier continues to reject the Claude SDK from both admitted release candidates.

The updated verifier passed both existing artifact families:

- Windows direct development Squirrel installer/update: eight external-runtime signatures absent;
- Windows Store-free development MSIX: eight external-runtime signatures absent, Store identity/assets/ASAR policy unchanged.

Repository verification after the policy and documentation update:

- 98 test files passed, 7 skipped;
- 535 tests passed, 12 skipped;
- TypeScript typecheck passed;
- ESLint passed;
- production dependency audit reported zero vulnerabilities.

## Explicit size exception

The Claude admission-only executable is 337,745,056 bytes and remains outside ordinary packages. Voice work does not make it necessary. The base direct installer must stay below its existing budget; Claude promotion therefore requires a separately reviewed optional provider pack or hosted topology rather than silently inflating every installation.

## Remaining evidence

1. Complete OpenClaw F5d.3 audible output, transcript ordering, interruption, clear/mark, disconnect, and same-session recovery.
2. Extract the live OpenClaw implementation behind the provider-neutral speech runtime without regression.
3. Select and admit a speech runtime. Prefer a versioned Hermes `/v1` audio contract if upstream provides one; otherwise treat its Dashboard/Desktop server or another speech provider as a distinct security, credential, lifecycle, and billing boundary.
4. Prove cross-agent cascade with direct Codex and Hermes.
5. Revisit native Codex realtime only when stable; add Claude only after its authenticated agent and distribution gates.
