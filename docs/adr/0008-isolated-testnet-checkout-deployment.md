# ADR 0008 — Isolated testnet checkout deployment

## Status

Accepted for the unfunded F4x.2e.1 deployment on 2026-08-25.

## Context

F4x.2d proved the browser handoff and one-shot settlement boundary locally, but a real browser requires an HTTPS origin and a serverless deployment cannot use process memory or SQLite as payment truth. Desky Store packages must also remain free-only and contain none of the hosted x402 runtime.

## Decision

- Deploy a separate Netlify project at `https://desky-checkout-testnet.netlify.app`; it is an isolated testnet checkout application, not Desky's marketing site or an Electron renderer.
- Serve a minimal static page with hashed local JavaScript/CSS, no third-party scripts, no inline executable content, a same-origin-only CSP, no framing, no referrer, and explicit testnet language.
- Expose only fixed browser bootstrap/resume/submit Functions plus health/readiness probes in this slice. Missing database, merchant, or facilitator configuration returns sanitized `503 temporarily-unavailable` and cannot fall back to simulation or memory.
- Use `PostgresCheckoutLedger` for hosted checkout/session/settlement/grant state. Compound transitions use row locks, exact replay checks, uniqueness constraints, and database transactions. SQLite remains local conformance only.
- Keep the hosted workspace and dependencies outside Electron's import graph. `@netlify/database` is a root development dependency solely so Netlify discovers the database migration; it is not a Desky production dependency.
- Do not admit a merchant recipient, facilitator credential, funded wallet, desktop commerce route, or paid release profile until database provisioning and the remaining operational gates succeed.

## Consequences

- The page is publicly reachable over HTTPS but cannot initiate payment without a valid desktop-created session and the missing server configuration.
- Netlify's current team plan rejected built-in Database provisioning with HTTP 403. The deployed site therefore remains intentionally unhealthy/fail-closed until the owner upgrades that plan or supplies a separately managed PostgreSQL connection.
- A production checkout will use a separate site, database, domain, secrets, deployment context, and legal/operational admission. The testnet site is never promoted in place to mainnet.
