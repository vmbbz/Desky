# F5b.5 Hermes transport and action disposition — 2026-08-24

## Result

The admitted direct Hermes adapter keeps remote TLS and typed avatar actions fail-closed. Pinned-source review found no stable API-client-local tool registration mechanism. Hermes has stable read-only capability/toolset discovery and separately configured MCP tools, which implies a distinct helper topology rather than an in-process Desky callback.

## Remote transport finding

Reviewed source: official `NousResearch/hermes-agent` revision `057dcdf236f8a6a26721c10fcc6ccb72726e272a`.

- `gateway/platforms/api_server.py` builds `web.TCPSite` with host, port, and reuse policy but no SSL context.
- Hermes defaults to loopback and requires `API_SERVER_KEY`; a network-accessible bind can execute terminal/file tools as the Hermes host user.
- Therefore a remote deployment must place an operator-owned HTTPS reverse proxy or trusted private-network ingress in front of the protected Hermes listener.
- Desky accepts plain HTTP only for `localhost`, `127.0.0.1`, or `::1`; every remote endpoint must be HTTPS.
- Desky uses native platform certificate validation and offers no bypass or custom insecure agent.

The client now classifies known certificate expiry, hostname, issuer, self-signed-chain, and leaf-verification failures as terminal `Hermes TLS certificate validation failed.` errors. Native details are not forwarded to the renderer, and the failure is not put through reconnect backoff.

This is a source and client-policy gate, not evidence of a real remote deployment. The operational remote matrix still needs a real TLS ingress, trusted certificate, invalid-certificate probe, streaming, approval, Stop, reconnect, and rotation evidence.

## Typed action finding

The stable API Server advertises `/v1/capabilities` and `/v1/toolsets`. Those routes allow deterministic read-only discovery of enabled toolsets and their concrete tool names. They do not let an API client register a callback or tool schema; capabilities explicitly report `admin_config_rw: false`.

Hermes can discover and register third-party tools through `mcp_servers` in Hermes configuration. That mechanism is process-wide, server-owned, and refreshed through Hermes MCP reload behavior. It is not equivalent to Desky registering a local callback during API connection.

Consequences:

1. No user or agent must edit a system prompt to make avatar actions work.
2. Desky must not parse assistant text for `Jump` or `Wave`.
3. Desky must not silently mutate Hermes configuration.
4. A future integration needs a separately signed Desky Action MCP helper, explicit per-profile consent, authenticated local IPC or mutually authenticated remote routing, bounded schemas, discovery/version admission, upgrade/removal behavior, and Store/direct packaging decisions.
5. Until that subsystem passes its own matrix, Hermes truthfully reports `agentActions.availability: unsupported`.

## Verification

- Pinned Hermes source tree clean at the admitted revision.
- Remote plaintext and URL-credential rejection remain covered.
- HTTPS request routing and bearer header behavior remain covered.
- New nested certificate-cause classification test passes and proves no native certificate detail leaks.
- Full repository gates are rerun before commit.
