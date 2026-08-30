# Public marketing site

## Purpose

The hosted Netlify project now serves two deliberately separate surfaces:

- `/` is the public Deskiii marketing site. It explains the desktop companion,
  gateway-neutral architecture, companion gallery and trust model.
- `/checkout/*` is the noindex, same-origin hosted wallet checkout. Netlify
  rewrites it to `checkout.html`; its browser client and security policy remain
  separate from the marketing surface.

The public page is intentionally static. It has no analytics, third-party
scripts, external fonts or browser credentials. Brand masters and campaign
posters are copied into content-hashed local assets during the hosted build.
This keeps the site reproducible and prevents the checkout from drifting to a
separately redrawn logo.

## Content contract

The current page describes Deskiii as a client for the agents users
already run. It may mention OpenClaw, Codex, Hermes and Claude as supported or
planned connection surfaces, but must not imply that Deskiii hosts those models,
executes tools independently, or has a production x402/mainnet sale.

The current primary call to action points to the public GitHub repository until
the legal publisher identity, production download URL and support/privacy
pages are ready. Before public launch, add these owned routes under the final
product domain:

- `/download`
- `/support`
- `/privacy`
- `/terms`
- `/security`
- `/company`

The launch page must keep the two Windows paths explicit even while both are
pre-release: **Microsoft Store — free edition** and **Download for Windows —
direct edition**. The Store artifact is free-only and excludes x402; the signed
direct artifact is the first place where the separately reviewed x402 pilot may
appear. Until the corresponding listing and signed installer exist, these
buttons remain visibly marked as coming soon rather than pointing to a fake
checkout or an unverified binary.

The footer must identify the exact registered publisher name, for example
`XEON Protocol (Pty) Ltd`, using the spelling on the company documents.

## Deployment

`netlify.toml` keeps the marketing document at the site root and rewrites only
`/checkout/*` to the checkout document. Both surfaces use local hashed assets;
the global headers continue to disallow framing, third-party scripts,
insecure connections and unnecessary browser capabilities.

The product name is now Deskiii; the final domain remains subject to trademark
clearance and ownership. Any future rename must update the marketing
templates, generated metadata, checkout lockup, package metadata and legal
copy together, while preserving internal entitlement and checkout IDs.
