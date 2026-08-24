# F5b.4 Hermes Windows direct admission — 2026-08-24

## Result

Hermes is admitted as a production adapter in Windows direct builds. Store builds do not instantiate it. A fresh packaged profile and a second packaged process both completed authenticated real-model runs through the Control Center, with the second process receiving no bearer input.

## Credential contract

- Renderer input contains only an optional one-use bearer, endpoint, and remember decision. The bearer is cleared after successful connection.
- Main canonicalizes the endpoint before credential lookup. Saved access is valid only for that exact canonical endpoint.
- The vault record is versioned and contains endpoint plus bearer inside Electron `safeStorage` ciphertext.
- Persistence occurs only after capability/version admission and authoritative session discovery both succeed.
- An explicit valid replacement rotates the record. Failed admission leaves the previous ciphertext untouched.
- A successful connection with storage disabled removes saved access. Encryption unavailability fails closed.
- Reconnect retains the resolved bearer only in the main-process runtime lifecycle; disconnect and exhausted recovery release it.

## Automated fixture evidence

Focused tests prove configuration bounds, exact-endpoint reuse, successful post-admission persistence, failed-rotation preservation, explicit removal, persistence-unavailable failure, Store factory non-instantiation, and direct-only descriptor admission.

## Packaged authenticated matrix

The fresh Windows x64 package ran against loopback Hermes `0.20.5`, `openai-codex`, and `gpt-5.4`:

1. A clean profile selected Hermes through the rendered provider switch and supplied the bearer through the password input.
2. It admitted the server, persisted access, disconnected, and reconnected with the token field blank.
3. It created a unique session and streamed `DESKY_HERMES_PACKAGED_STREAM_OK` from the real model.
4. It requested a guarded terminal command, allowed it once, exposed the reachable Stop control during execution, and reached one terminal cancellation.
5. The packaged app exited with code zero through bounded shutdown.
6. A second packaged Desky process reused the same profile with `DESKY_HERMES_UI_TEST_TOKEN` absent, connected from OS-encrypted storage, created a new session, and streamed `DESKY_HERMES_PACKAGED_RESTART_OK`.

Both diagnostics reported:

```text
visualExerciseError: null
hermesUiExercise: passed
hermesTokenLeak: false
activeAdapterId: hermes
adapterStatus: connected
process exit: 0
```

The profile vault reported schema version 1, only the `hermes:active-profile` entry, no plaintext bearer, and a 180-character encrypted payload. Captures and temporary profiles remain outside the repository.

## Verification

- Focused Hermes/profile/visual-policy tests: passed.
- Typecheck: passed.
- Lint: passed.
- Fresh Windows x64 package: passed.
- Clean-profile packaged authenticated lifecycle: passed.
- Second-process saved-access lifecycle: passed.
- Production dependency audit and full regression suite are rerun before commit.

## Remaining Hermes gates

- remote `https://` deployment and certificate-failure evidence;
- stable typed Desky action discovery or a retained unsupported declaration;
- macOS Keychain, package, lifecycle, and performance evidence;
- any future Store topology must be designed and admitted separately rather than inheriting direct-build authority.
