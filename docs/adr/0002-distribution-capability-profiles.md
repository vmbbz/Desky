# ADR 0002: Store and direct capability profiles

- Status: accepted
- Date: 2026-08-22

## Context

Desky should connect to remote gateways and locally installed agent runtimes. The Mac App Store requires sandboxing and restricts arbitrary process and downloaded-code behavior, while a notarized direct app can support broader local integrations.

## Decision

Build one product with compile-time `store` and `direct` capability profiles. The main process enforces capabilities; renderer flags are informational only.

## Store profile

- Authenticated network gateways.
- User-selected avatar files through platform-approved access.
- Store-managed updates.
- No arbitrary installed agent CLI launching on macOS.
- Only reviewed, bundled, sandbox-inheriting helpers.

## Direct profile

- Store profile features plus supported local runtime supervision.
- Signed in-app updates.
- Explicit executable discovery, consent, and diagnostics.

## Consequences

- Feature availability appears before purchase and during onboarding.
- Adapter descriptors declare required capabilities.
- CI must build and test both profiles.
- Store review cannot be treated as repackaging the unrestricted build.
