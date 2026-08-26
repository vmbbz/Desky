# F5b.7 remote transport-security verification — 2026-08-26

## Result

The locally executable remote transport-security contract passes for OpenClaw WSS and Hermes HTTPS. This result proves fail-closed client behavior; it does not claim an operator-owned trusted public deployment or macOS completion.

## Implemented boundary

- One shared terminal classifier maps expired, not-yet-valid, untrusted, hostname-mismatched, and invalid TLS handshakes to bounded safe codes.
- Native certificate text, host detail, and chain detail do not cross the adapter boundary.
- OpenClaw disables redirects and per-message compression, requires platform certificate validation, caps payloads, and closes on binary or malformed protocol frames.
- OpenClaw and Hermes suppress reconnect after terminal certificate failure; ordinary retryable transport loss retains each adapter's bounded recovery policy.
- `deploy/hermes/Caddyfile.example` terminates TLS outside Hermes, keeps the bearer in Hermes, limits request bodies, preserves SSE streaming, and adds baseline response hardening.

## Evidence

- `npm run typecheck`: pass.
- `npm run lint`: pass.
- Focused transport suite: 7 files, 52 tests passed.
- Opt-in real-socket matrix: 2 tests passed. It started actual HTTPS and WSS listeners with an ephemeral one-day self-signed certificate generated in the operating-system temporary directory and proved that both clients rejected the untrusted chain terminally.
- No certificate or private key is part of the repository or package inputs.

## External gates

1. Deploy a DNS name, trusted certificate, firewall, and private Hermes/OpenClaw origin owned by the operator.
2. Repeat authenticated model streaming, sessions, approvals, cancellation during execution, bearer/device-token rotation, reconnect, and service restart through that ingress.
3. Prove certificate replacement recovery and repeat the package/credential matrix on macOS with Keychain-backed storage.
