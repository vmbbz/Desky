# Commerce and entitlement architecture

## Objective

Desky needs one durable answer to a simple question: “May this account/device use this admitted avatar revision?” The answer must remain consistent whether the grant came from the free tier, Apple StoreKit, Microsoft commerce, x402 on Base, x402 on Solana, a promotion, or customer support.

Payment proves that a transaction was authorized and settled. An entitlement grants product access. A JWT carries a short-lived authorization projection. These are separate objects with separate lifecycles.

## Implemented foundation — F4x.1a–c, 2026-08-25

The first executable slice is deliberately provider-disabled:

- `src/shared/commerce.ts` defines and strictly parses versioned product, offer, order, payment-attempt, and entitlement-event contracts. Unknown fields, unsafe identifiers/timestamps, duplicate arrays, floating/zero/negative/oversized atomic amounts, invalid provider/source combinations, and backwards state transitions fail closed.
- The pure order and payment state machines permit only explicit forward transitions and make an exact repeated transition idempotent.
- Entitlement events append without mutation. Exact event replay is idempotent; event-ID collisions and duplicate source/type references fail. Projection handles time-bounded grants, refunds/revocations/expiry, and explicit support restoration without treating payment or a JWT as the ledger.
- `src/main/commerce/access-token.ts` verifies compact Ed25519 JWS tokens with exact `alg=EdDSA`, `typ=desky-access+jwt`, admitted `kid`, issuer, audience, numeric-date, maximum-lifetime, scope, grant, and claim-field policy. Signature verification occurs before claims are interpreted. Unknown claims, algorithm confusion, wrong keys, tampering, future/expired/overlong tokens, duplicate scopes/grants, and oversized encodings fail closed.
- The runtime commerce policy resolves the four Windows/macOS direct/store release profiles but enables only `free`. StoreKit, Microsoft, x402 Base, x402 Solana, support mutation, external checkout, and production payments remain unreachable.
- F4x.1b adds an exact authoritative quote that binds account, offer/product/catalog revisions, exact avatar revisions, provider, release profile, region, atomic amount, expiry, and provider settlement terms. x402 quotes require network/asset/recipient together; native-store quotes reject those chain fields.
- An asset grant now binds one entitlement event to exact product/catalog/avatar revisions and an explicit delivery state.
- `src/service/commerce/sqlite-commerce-ledger.ts` is a service-side conformance repository, not an Electron or production-hosted database adapter. It uses strict tables, foreign/unique constraints, WAL, full synchronization, compare-and-swap transitions, exact idempotent replay, and one transaction for verified payment settlement, order grant, entitlement event, and asset grant. Tests prove rollback and close/reopen durability.
- F4x.1c adds exact clean-device/session-refresh/reconciliation contracts, a fixed-origin HTTPS main client, a framework-neutral hosted HTTP boundary, and a production repository port. The port stores refresh digests—not credentials—and requires transactional compare-and-swap, current/previous digest rotation, reconciliation snapshots, and append-only audit.
- Strict Ed25519 JWKS parsing admits only bounded `OKP`/`Ed25519` signing keys. The rotating cache refreshes on expiry or unknown `kid`, admits intentional overlap, supports an emergency release revocation set, and permits stale keys only for a bounded outage window.
- Refresh material is main-only and OS encrypted through the existing `safeStorage` vault. Clean-device restore requires a one-time code, PKCE verifier, installation identity, and idempotency key. Every refresh rotates the credential/generation and carries a deterministic rotation ID for crash-safe service replay.
- The distinct `desky-offline-lease+jwt` is installation-bound, revision-exact, and capped at 72 hours. Online verification pins its public key in the encrypted session so offline restart does not require JWKS. Server time and system-monotonic elapsed time detect observed rollback; a monotonic reset/offline reboot or material wall-clock rollback requires reconnection.
- The recovery coordinator persists nothing until access token, lease, account, installation, refresh generation, catalog, exact active grants, and reconciliation all agree. No access token is persisted and recovery proofs never enter storage.

This is not yet a deployed durable network service. The executable API/repository/recovery boundaries now pass local adversarial tests, but production still requires the hosted database adapter and migrations, real identity-provider PKCE flow, TLS/domain, managed signing-key custody, backups/restore drills, rate limits, reconciliation workers, monitoring, incident evidence, and clean-device hardware verification. Every payment provider remains unreachable. No checkout or paid UI is exposed.

The current protocol authority is x402 v2. Its HTTP transport uses `PAYMENT-REQUIRED` and `PAYMENT-SIGNATURE`; `PaymentRequirements.amount` is an atomic-unit string, networks use CAIP-2, and verify/settle are distinct facilitator operations. Desky will admit only the exact Base pair selected by server and release policy after F4x.1 completes; it will not infer v2 from legacy v1 headers or wallet callbacks.

## Trust boundaries

```text
Untrusted
  model/agent text | renderer UI | wallet callback parameters | remote catalog
        │
        ▼ strict typed requests
Electron main process
  release-profile policy | OS vault | hash/cache validation | browser handoff
        │ HTTPS, pinned schemas and origins
        ▼
Commerce service
  offers | orders | payment adapters | reconciliation | entitlement ledger
        │                              │
        ▼                              ▼
facilitator/store verification     signed catalog + asset gateway/CDN
```

The renderer can request a quote or display a verified result. It cannot select a merchant recipient, token contract, price, entitlement scope, catalog signature key, or asset URL.

## Domain model

### Product and offer

`Product` is a stable grant target: an avatar, pack, or catalog pass. `Offer` is a region/channel-specific way to obtain it.

```ts
interface Offer {
  offerId: string;
  productId: string;
  revision: number;
  releaseProfiles: ReleaseProfile[];
  regions: string[];
  priceBookId: string;
  providers: CommerceProviderId[];
  startsAt: string;
  endsAt?: string;
  state: "draft" | "active" | "paused" | "retired";
}
```

Prices are authoritative only in a server-issued quote or native store product response. Catalog price labels are display hints and must never authorize a charge.

The executable `VerifiedCommerceQuote` binds the account, exact offer/product/catalog revisions, exact avatar revisions, release profile, region, payment provider, atomic amount, issue/expiry times, and—only for x402—the exact network, asset, and recipient. Orders and payment attempts both carry its `quoteId`; independently supplied renderer or agent terms never become authority.

### Order and payment attempt

```ts
interface Order {
  orderId: string;
  quoteId: string;
  accountId: string;
  offerId: string;
  offerRevision: number;
  idempotencyKey: string;
  currency: string;
  amountAtomic: string;
  state:
    | "created"
    | "awaiting-approval"
    | "awaiting-settlement"
    | "paid"
    | "granted"
    | "cancelled"
    | "expired"
    | "refunded"
    | "disputed";
  createdAt: string;
  updatedAt: string;
}

interface PaymentAttempt {
  attemptId: string;
  orderId: string;
  quoteId: string;
  provider: CommerceProviderId;
  providerReference?: string;
  network?: string;
  asset?: string;
  recipient?: string;
  quoteExpiresAt: string;
  state: "created" | "submitted" | "verified" | "settled" | "failed";
}
```

Amounts are strings in atomic units. Floating-point arithmetic is forbidden. An idempotency key is unique for account/offer/intent and prevents rapid repeated clicks or callbacks from creating duplicate orders.

### Entitlement ledger

Entitlements are append-only grants and reversals, projected into current access:

```ts
interface EntitlementEvent {
  eventId: string;
  accountId: string;
  productId: string;
  type: "grant" | "revoke" | "expire" | "refund" | "support-restore";
  source: "free" | "storekit" | "microsoft" | "x402-base" | "x402-solana" | "support";
  sourceReference: string;
  effectiveAt: string;
  expiresAt?: string;
  reasonCode: string;
}
```

The projection answers whether a product is currently granted. It never mutates or erases payment history. Support changes create explicit events.

### Asset grant

A product entitlement maps to explicit admitted avatar revision IDs. This lets Desky update presentation metadata without silently changing the exact model bytes a perpetual buyer received. Security/takedown updates can suspend delivery while preserving the audit trail and defined customer remedy.

The executable grant also binds `productRevision`, `entitlementEventId`, `catalogVersion`, issue/expiry, and `active | suspended | revoked | expired`. The atomic settlement transaction accepts only an active grant whose account, product, product revision, avatar revisions, event, and issue time exactly match the verified quote and entitlement event.

### Transactional repository semantics

The conformance repository proves the minimum behavior every production adapter must match:

- quote, order, attempt, event, and grant identifiers are immutable; exact replay succeeds and collisions fail;
- account/idempotency keys and provider references are unique;
- order/attempt state changes use compare-and-swap to detect concurrent writers;
- settlement requires `awaiting-settlement` plus a `verified` attempt before quote expiry;
- quote, order, attempt, settlement evidence, entitlement event, and asset grant must match exactly;
- payment `settled`, order `granted`, the append-only event, and the asset grant commit in one transaction or all roll back;
- close/reopen retains the exact ledger and cannot issue a second grant for an exact replay.

SQLite is used only for deterministic local conformance and crash/reopen testing. The hosted service must implement these invariants with a production-supported transactional database, migration discipline, backups, restore drills, and multi-instance concurrency tests.

## Access tokens

### Token purpose

The commerce service issues a short-lived access JWT only after reading the current entitlement projection. The token authorizes bounded catalog/asset operations and is not a receipt.

Suggested protected claims:

```json
{
  "iss": "https://commerce.desky.example",
  "aud": "desky-assets",
  "sub": "opaque-account-id",
  "iat": 0,
  "nbf": 0,
  "exp": 0,
  "jti": "unique-token-id",
  "scope": ["catalog:read", "asset:read"],
  "grants": ["product:avatar.milk"],
  "catalogVersion": "..."
}
```

Production rules:

- asymmetric EdDSA or ES256 signing after dependency/platform review;
- explicit accepted algorithm list; `none` and algorithm confusion fail closed;
- `kid` mapped through HTTPS JWKS with bounded caching and rotation overlap;
- exact issuer and audience validation;
- short expiry, initially 5–15 minutes;
- bounded clock skew;
- unique `jti` for incident correlation, not routine per-request server lookup;
- no email, wallet address, payment transaction, source URL, price, or secret;
- distinct token type/audience from login, refresh, admin, and signed catalog artifacts.

Refresh/recovery credentials are opaque, rotating, revocable values stored only in the OS credential vault. They are never placed in renderer storage.

`/.well-known/jwks.json` is fetched only from the configured HTTPS service origin without redirects. Unknown/duplicate fields, wrong curves/algorithms/use, non-canonical key material, oversized responses, duplicate `kid`, and explicitly revoked keys fail. An unknown token `kid` triggers one bounded refresh; overlapping old/new keys are accepted only while the authority publishes both or the bounded stale-outage policy remains valid.

### Offline lease

Installed content may continue through a signed offline lease containing only product/revision grants and a bounded expiry. Initial target: 72 hours, tunable by incident and support evidence. Free avatars do not require a lease. A perpetual purchase should recover automatically when connectivity returns.

The verified offline public key is pinned with the encrypted lease so an app restart during an outage does not need JWKS. Main records last trusted server time and expects a system-monotonic clock source. Same-boot elapsed time cannot be reduced by changing wall time. Material wall-clock rollback or a monotonic reset (normally an offline reboot) produces reconnect-to-verify rather than silent deletion. Desky does not claim that an ordinary PC exposes a tamper-proof persistent clock across reboot; this is an explicit limitation of offline access.

## Restore and refresh API

The admitted hosted surface is deliberately narrow:

- `POST /v1/session/restore`: one-time recovery code + PKCE verifier + installation ID + idempotency key;
- `POST /v1/session/refresh`: session/installation IDs + current refresh credential/generation + deterministic rotation ID + reconciliation cursor;
- `GET /.well-known/jwks.json`: bounded Ed25519 public signing keys.

Responses return a rotating refresh credential, short access JWT, offline lease, authoritative server time, and a full exact reconciliation snapshot. Requests and responses are `no-store`; redirects, unknown routes/fields, wrong content types, oversized bodies, identity drift, generation skips, credential reuse, and token/snapshot disagreement fail closed. The service stores refresh digests and bounded replay metadata, never plaintext credentials, wallet keys, conversation content, access tokens, or leases.

## Commerce-provider interface

```ts
interface CommerceProvider {
  readonly id: CommerceProviderId;
  isAvailable(context: ReleaseCommerceContext): Promise<Availability>;
  createQuote(input: QuoteRequest): Promise<VerifiedQuote>;
  beginApproval(quote: VerifiedQuote): Promise<ApprovalHandoff>;
  reconcile(orderId: string): Promise<OrderSnapshot>;
  restore(accountId: string): Promise<RestoreResult>;
}
```

Provider implementations never write entitlements directly. They return verified payment/store evidence to the commerce service, which performs idempotent order transition and entitlement issuance.

### Free provider

The first implementation grants allowlisted free product IDs locally/from the signed catalog without an account, payment, or network secret. It proves the marketplace and activation domain before commerce exists.

### x402 provider

The x402 v2 adapter:

1. asks the commerce service for a short-lived exact quote;
2. receives allowlisted `scheme`, CAIP-2 `network`, atomic USDC amount, asset address/mint, recipient, nonce/correlation, and expiry;
3. shows those verified terms on Desky's trusted human approval surface;
4. opens the system browser/registered wallet flow only after deliberate confirmation;
5. submits the signed payment payload to the resource server;
6. verifies/settles through the configured facilitator;
7. independently validates settlement terms and provider reference;
8. commits `paid`, emits a grant once, and issues a receipt/access token;
9. reconciles by callback and polling until a terminal state.

Security invariants:

- only exact x402 v2 is admitted for initial purchases;
- production network, USDC asset/mint, merchant recipient, and facilitator origins are configuration allowlists;
- a wallet or model cannot replace server-issued terms;
- quote expiry is enforced;
- nonce/replay protection is required;
- Base and Solana use separate adapters and conformance fixtures;
- the public x402.org test facilitator is never used for mainnet;
- merchant signing/settlement credentials remain server-side;
- no agent or renderer receives a wallet private key;
- a successful chain transfer with mismatched order terms goes to manual reconciliation, never an automatic grant.

The initial production rail is Base only. Solana is added only after the shared order/entitlement model has proven restore, refund, monitoring, and support behavior. Multi-chain from day one would double failure modes without improving the marketplace product.

### StoreKit provider

The Mac App Store provider uses StoreKit products and server-verifiable transaction evidence. It supports purchase, restore, refund/revocation updates, and family-sharing policy where configured. The MAS renderer and main process contain no reachable x402 checkout path unless a future explicit entitlement and regional implementation are approved.

### Microsoft provider

Microsoft Store policy 7.19 currently permits secure third-party purchase APIs for digital goods in non-game PC apps, but it does not specifically pre-approve x402. Initiating cryptocurrency transactions brings company-account and financial-transaction requirements. The initial Microsoft Store release is therefore free-only. A later Store profile may enable x402 only after then-current policy, company identity, declarations, certification, regional legal review, reviewer notes, explicit provider/authentication/confirmation controls, and marketplace/content obligations pass. A Microsoft commerce provider remains interchangeable. Direct Windows uses its own reviewed x402 capability without inheriting Store APIs. See `docs/research/MICROSOFT-STORE-X402-POLICY-2026-08-24.md`.

## Release-profile capability matrix

| Profile | Free | x402 Base | x402 Solana | Native store commerce | External checkout UI |
| --- | --- | --- | --- | --- | --- |
| Windows direct | yes | planned | later | no | planned |
| Microsoft Store | yes | disabled for initial release; later certification-gated | disabled | optional later | disabled for initial release |
| macOS direct | yes | planned | later | no | planned |
| Mac App Store | yes | disabled by default | disabled by default | StoreKit if premium ships | disabled unless eligible entitlement exists |

Capabilities are compiled/signed release configuration plus runtime storefront eligibility, not a renderer setting, remote feature flag alone, URL parameter, or agent instruction.

The initial Microsoft Store artifact is `windows-store-free`: premium commerce implementation and UI are excluded from its import graph and package. Retaining x402 source in the shared repository does not make it a dormant Store capability. A later Store enablement requires a newly built `windows-store-third-party-commerce` artifact, updated disclosures/declarations, certification, package flight, and gradual rollout. The direct website build remains a separate supported channel and may reach the x402 production gate first. This channel decision is detailed in `docs/DISTRIBUTION.md`.

## Human approval contract

Before signing, Desky shows:

- companion/product and admitted revision;
- creator/source/licence;
- total fiat reference and exact USDC amount;
- network and recognizable network name;
- shortened merchant recipient with a details expander;
- offer/quote expiry;
- what is granted and whether it expires;
- refund/support link;
- `Cancel` and a single deliberate continue action.

The approval view is owned by Desky/main and rehydrates the server-verified quote. Model-generated text cannot overlay, obscure, or substitute it. Accessibility names include amount and action. Closing the window cancels the local handoff but does not assume an already submitted transaction failed; reconciliation continues safely.

## Recovery and reconciliation

### Required paths

- app closes before wallet opens;
- user rejects wallet signature;
- wallet signs after quote expiry;
- facilitator verify succeeds but settle times out;
- settlement completes but callback is lost;
- duplicate callbacks and user retry;
- wrong network/asset/recipient/amount;
- Base/Solana reorg or provider reports reversal;
- StoreKit refund/revocation;
- account or device replacement;
- entitlement service unavailable;
- catalog asset suspended after purchase;
- JWT signing-key rotation or compromise.

Every provider reference is unique. Background reconciliation is bounded, observable, and safe to retry. Support can search by Desky order ID and provider reference, then issue an auditable correction without editing a JWT or database row in place.

## Threat model and controls

| Threat | Control |
| --- | --- |
| forged/modified catalog | asymmetric signature, schema parser, version/expiry policy |
| renderer changes displayed price | verified quote rendered from typed main projection; server validates all terms |
| model requests malicious recipient | recipient/network/asset ignored from agent inputs and enforced by allowlist |
| replay/duplicate settlement | x402 nonce, provider reference uniqueness, order idempotency, append-only grant event |
| stolen access JWT | short expiry, narrow audience/scope, OS-vault refresh, no raw asset URL in token |
| JWT algorithm confusion | pinned algorithm and key use; issuer/audience/type validation per RFC 8725 |
| CDN scraping | signed short-TTL URLs, rate limits, entitlement checks; no claim of perfect DRM |
| cache substitution | content-addressed filename, exact SHA-256, signed provenance sidecar, reparse on read |
| support/admin abuse | least privilege, MFA, two-person paid-catalog changes, immutable audit events |
| chain/provider outage | installed offline lease, retry/reconcile, second rail only after operational maturity |
| refund then indefinite use | stop token/lease renewal, apply documented offline grace, preserve support evidence |
| store-policy leakage | signed release capability profile, build tests proving disabled providers have no route |

## Service data and privacy

Minimum server records include opaque account ID, orders, payment references, grant events, catalog/product IDs, region/tax records required by law, and security/audit events. Wallet addresses are personal/security-sensitive identifiers and are not analytics dimensions.

Conversation text, gateway prompts, tool transcripts, and agent-provider credentials never enter commerce services. Agents receive only bounded catalog and entitlement answers requested by the user.

Account deletion removes optional profile data and revokes credentials, while legally required financial records follow a disclosed retention schedule. The privacy policy must explain this distinction before paid launch.

## Observability and service objectives

Track without conversation content:

- quote creation and expiry;
- approval handoff result;
- verification/settlement latency by provider/network;
- reconciliation age and terminal failure reason;
- payment-to-grant latency;
- duplicate prevention events;
- token issuance/verification failures by reason;
- asset authorization/download/hash result;
- restore and offline-lease result.

Initial objectives:

- zero duplicate charges caused by Desky retries;
- 99.9% of verified settled payments issue or recover a grant within five minutes;
- 99.5% entitlement restore success excluding invalid credentials/provider outage;
- 100% recipient/asset/network mismatches fail closed;
- existing installed companion remains usable during catalog outage.

## Verification gates

### Contract

- schema fuzzing and unknown-field/version rejection;
- amount atomic-string bounds and no float conversions;
- idempotent order/grant transitions;
- provider adapter conformance fixtures;
- JWT wrong algorithm/key/issuer/audience/type/expiry rejection;
- signing-key rotation overlap and emergency revocation;
- release-profile provider unreachability tests.

### Integration

- Base Sepolia exact USDC success, rejection, expiry, retry, callback loss, and duplicate;
- Solana devnet equivalent before any Solana mainnet work;
- StoreKit sandbox purchase/restore/refund when that provider starts;
- clean-device restore and OS-vault migration behavior;
- settled-payment/delivery-failure recovery;
- offline lease through network and clock anomalies.

### Packaged experience

- screen-reader and keyboard purchase/restore path;
- browser/wallet focus returns to Desky without stealing focus unexpectedly;
- no secret/payment payload in renderer logs or diagnostic export;
- Windows direct, Microsoft Store, macOS direct, and MAS each expose only allowed providers;
- uninstall/cache/account-deletion behavior matches disclosures.

## Owner decisions before production commerce

1. Legal publisher and selling entity.
2. Source-code licence and commercial-service terms.
3. Merchant wallet custody/signing and incident authority.
4. Facilitator selection, SLA, fees, data handling, sanctions controls, and fallback.
5. Tax/VAT/GST merchant-of-record strategy and supported countries.
6. Refund, charge dispute, takedown, and customer-support policy.
7. Account identity, wallet binding, recovery, and device limits.
8. Final offer types and validated prices.
9. StoreKit versus free-only Mac App Store launch.
10. Privacy, terms, support, and security-contact URLs.

No mainnet payment code is release-ready until these decisions have named owners and acceptance evidence.
