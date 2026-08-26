# Hermes HTTPS ingress

Hermes Agent's admitted API Server remains a loopback HTTP service. A remote direct-build deployment places an operator-owned HTTPS ingress in front of it; Desky connects only to the public HTTPS origin and never receives a certificate-bypass control.

```text
Desky direct build
  | HTTPS + bearer + system trust validation
  v
operator ingress :443
  | private host / loopback HTTP
  v
Hermes API Server 127.0.0.1:8642
```

## Reference boundary

`deploy/hermes/Caddyfile.example` is a reference, not an automatic deployment. The operator supplies a DNS name and publicly/system-trusted certificate, keeps Hermes on loopback or a private host network, and sets the existing Hermes bearer independently. TLS terminates at the ingress; bearer authentication remains enforced by Hermes and is never embedded in the proxy configuration.

The ingress must preserve streaming responses without buffering, reject oversized request bodies, remove its server banner, and emit HSTS, no-sniff, and no-referrer headers. Firewall policy exposes only 443 publicly. Port 8642 must not be internet reachable.

## Production checklist

1. Bind Hermes to loopback/private networking and verify it is unreachable from the public interface.
2. Point a dedicated DNS name to the ingress.
3. Obtain a certificate whose SAN includes that exact name and whose chain reaches the target OS trust stores.
4. Deploy the reference policy or an equivalent managed load balancer/reverse proxy.
5. Configure Desky with `https://<exact-name>` and the Hermes bearer; do not put the bearer in the URL.
6. Run the authenticated Hermes source/package matrix through the ingress.
7. Rotate the bearer, reconnect from saved OS-vault access, then remove saved access and prove failure.
8. Exercise server restart, active SSE loss, cancellation during execution, certificate expiry/name/untrusted-chain failures, and recovery after a valid replacement certificate.

## Fail-closed behavior

Desky classifies expired, not-yet-valid, untrusted, hostname-mismatched, and unsupported TLS handshakes as sanitized terminal failures. It does not loop indefinitely and never exposes native certificate detail to the renderer. Ordinary connection resets and retryable HTTP statuses retain the bounded Hermes recovery policy.

The committed real-socket harness uses only operator-generated ephemeral test certificates supplied by environment path. It proves that an actual untrusted HTTPS ingress and `wss://` Gateway both fail terminally; no test private key or certificate is committed.

## Still external

This repository does not own a public Hermes domain, DNS zone, certificate, firewall, or server. A real operator deployment and the macOS trust/Keychain/package matrix therefore remain release evidence, not locally completed claims.
