# F5b.3 Hermes resilience — 2026-08-24

## Result

Hermes now passes bounded automatic recovery on Windows without replaying lost user input. The evidence covers source fixtures, authenticated loopback transport cuts while idle and active, a fresh real-model turn after recovery, and a real restart of the installed Hermes gateway process.

This completes the F5b.3 resilience slice. It does not admit Hermes for release; credential persistence, packaged UI lifecycle, remote/Store policy, typed actions, and macOS remain separate gates.

## Recovery contract

- `HermesApiClient` classifies only network transport failure, HTTP 408, HTTP 429, and HTTP 5xx as reconnectable.
- Authentication errors, malformed or oversized JSON/SSE, invalid content types/native events, missing capabilities/endpoints, and version/model drift fail closed without retry.
- A 30-second admission heartbeat detects an idle API Server loss. During a live turn, its SSE stream is the liveness signal instead of a competing poll.
- An unexpected close expires every pending approval, emits exactly one failure for the active turn, closes the old connection identity, and never reissues the input or run-start request.
- Recovery makes at most three fresh admissions after 0.5, 2, and 6.5 seconds. Each admission revalidates health, authenticated server-agent/tool topology, required features/routes, and exact pre-loss runtime version/model continuity.
- The previous selected session is restored only if it still appears in the new authoritative session list. No missing session is invented.
- Explicit disconnect increments a lifecycle generation and prevents a delayed retry or stale client from reclaiming state.
- Exhausted retry state releases the in-memory connection configuration instead of retaining an unneeded bearer indefinitely.

## Why turns are not resumed

The pinned Hermes API Server owns tool execution and removes a run's SSE queue when that consumer disconnects. Reattaching would therefore be incomplete or misleading even if the underlying model/tool task continued briefly. Desky treats the turn as lost, emits one terminal error, and allows only a new user/model turn after full server re-admission.

## Automated fixture matrix

The Hermes client/runtime tests prove:

1. retryable versus terminal HTTP/transport classification;
2. low-level network errors are replaced with bounded provider-safe text;
3. selected-session restoration with a new connection identity;
4. exactly one lost-turn failure and one approval-expired event;
5. no call to `startRun` on the replacement client;
6. three-attempt exhaustion;
7. explicit disconnect cancelling a pending retry;
8. malformed cross-run event shutdown without retry;
9. reconnect-time version/model drift shutdown after the first changed admission;
10. passive idle-health recovery.

## Authenticated transport-loss matrix

The live harness creates a temporary authenticated loopback relay in front of Hermes `0.20.5`:

1. It connects, creates an isolated session, cuts the idle transport, observes `reconnecting`, restores transport, and verifies the same selected session.
2. It starts one real model run, severs the active SSE path, observes exactly one lost-turn terminal, and verifies that the relay received only the original run submission.
3. It restores transport, completes a fresh `gpt-5.4` turn containing `DESKY_HERMES_RECOVERY_OK`, and verifies two closed plus three ready connection events across the two deliberate outages.
4. It disconnects and deletes the temporary Hermes session.

Observed authenticated relay result:

```text
[desky-hermes-live] idle/active transport recovery and no-replay passed
Test Files  1 passed (1)
Tests       4 passed (4)
```

## Real Windows gateway restart

The separately gated harness accepts only an absolute executable whose basename is `hermes` or `hermes.exe`, invokes fixed `gateway restart` arguments with `shell: false`, ignores stdout, bounds stderr to 16 KiB, and applies a 60-second process deadline.

The first run exposed a real timing boundary: the installed startup-folder gateway needed about 6.3 seconds from stop to API-listener return, while the old third attempt arrived just before readiness. The production retry schedule was widened, still with exactly three attempts, to 0.5/2/6.5 seconds. A focused rerun then re-admitted the same session and completed `DESKY_HERMES_PROCESS_RECOVERY_OK` through the real restarted gateway.

Observed result:

```text
[desky-hermes-live] real gateway restart and model recovery passed
Test Files  1 passed (1)
Tests       1 passed | 4 skipped (5)
```

## Repository regression evidence

- `npm test`: 55 files passed, 5 skipped; 260 tests passed, 9 skipped.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run codex:schema:verify`: admitted Codex baseline still passes unchanged at 273 schemas.
- `npm run package`: fresh Windows x64 Electron package passed. This is a build gate, not the still-open packaged Hermes UI lifecycle matrix.
- `npm audit --omit=dev`: zero production vulnerabilities.

## Remaining gates

1. Store the bearer through vault-grade OS encryption and prove rotation/removal.
2. Register Hermes only after a packaged Control Center matrix covers connect, restart, Stop, app quit, clean install, and stale credential recovery.
3. Validate remote HTTPS, certificate failure, and the Store/direct distribution disposition.
4. Determine stable typed Desky-action discovery or retain a tested unsupported declaration.
5. Repeat package, credential-store, lifecycle, and performance evidence on macOS.
