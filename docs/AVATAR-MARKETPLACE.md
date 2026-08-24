# Avatar marketplace master plan

## Product thesis

Desky's marketplace is a trusted companion catalog, not a speculative asset market. It turns a large, uneven public VRM registry into a small number of dependable desktop experiences with known rights, compatibility, motion behavior, provenance, and support.

The simplest user promise is:

> Choose a companion. See exactly who made it and what its licence permits. Unlock Desky's tested experience once, then use it across supported Desky builds.

Users pay for Desky-ready curation and delivery. They do not buy exclusive ownership of an open-source model, and Desky never conceals the public source or original licence.

This document is the product and build authority for avatar discovery, motion-personality controls, catalog admission, offers, marketplace UX, and rollout. `docs/COMMERCE-ENTITLEMENTS.md` owns payment and authorization contracts. `docs/ASSETS.md` owns source/rights admission. Store-specific capability rules remain in `docs/DISTRIBUTION.md`.

## Non-negotiable principles

1. **Three excellent free companions before a large locked grid.** The free product must be complete, attractive, offline-capable, and useful indefinitely.
2. **Admission before monetization.** A registry record is a candidate. Only a rights-reviewed, binary-tested, provenance-complete catalog record can become an offer.
3. **One entitlement, multiple commerce rails.** Free grants, StoreKit, Microsoft commerce, x402 Base, x402 Solana, support grants, and future promotions all resolve to the same product grant model.
4. **No wallet in the agent.** Agents can discover and prepare; people approve and wallets sign.
5. **No false scarcity.** “Unlock for Desky” is accurate. “Own this avatar” is not.
6. **Licences are visible before and after purchase.** Creator, source, licence, attribution, and modification disclosure are first-class UI.
7. **Store policy is a runtime capability.** The same source tree renders only commerce actions permitted by the signed distribution profile and current storefront eligibility.
8. **The renderer never becomes a marketplace security boundary.** Catalog validation, entitlement checks, downloads, hashes, cache mutation, and secrets stay in the main process or service.
9. **An unlocked avatar remains usable during reasonable outages.** Paid access cannot require a network round trip on every launch.
10. **Motion personality is policy, not a bag of filenames.** User energy settings, normalized agent state, reduced motion, and per-avatar safety profiles govern animation.

## Scope and boundaries

### V1 includes

- first-class Marketplace route in the control center;
- search, collection filters, preview, provenance, licence, compatibility, and install state;
- three permanent free companions;
- individual and pack entitlement foundations;
- local cache, restore, activation, and update behavior;
- motion-energy presets and category controls;
- distribution-profile-aware checkout providers;
- support/admin grants and catalog takedown handling; and
- provider-neutral agent discovery and checkout preparation after human UX ships.

### V1 excludes

- NFT ownership checks, token-gated licences, minting, trading, or resale;
- user-to-user marketplace listings;
- auctions, rarity, loot boxes, randomized paid unlocks, or speculative pricing;
- silent agent spending;
- arbitrary remote avatar URLs in the premium catalog;
- community uploads before moderation/reporting operations exist; and
- a proprietary animation applied to an avatar unless both licences permit the combined distribution and use.

## Catalog architecture

The word “catalog” refers to four distinct layers. They must not collapse into one JSON file.

```text
Open Source Avatars registry
        │ ingest candidate metadata at a pinned source commit
        ▼
Desky admission pipeline
rights + embedded VRM policy + hashes + load/animation/performance matrix
        │ emits immutable admitted records
        ▼
Signed Desky catalog
presentation + compatibility + release availability + offer IDs
        │                                  │
        ▼                                  ▼
Marketplace UI                     Entitlement/order service
        │                                  │
        └──────────── allowed asset IDs ───┘
                           │
                           ▼
              content-addressed asset CDN/cache
```

### Candidate registry

The existing main-process avatar broker remains the only network ingest boundary. It fetches `projects.json`, fetches each collection file, joins `project_id`, applies host/size/time policies, and treats all fields as untrusted.

The pinned 2026-08-24 snapshot contains 4,274 candidates. That scale is useful for discovery but too large for indiscriminate client exposure. Ingestion stores the upstream commit, exact source record hash, and fetch time so catalog changes are reviewable.

### Admission record

Every admitted avatar has an immutable revision:

```ts
interface AdmittedAvatarRevision {
  schemaVersion: 1;
  avatarId: string;
  revisionId: string;
  source: {
    registry: "open-source-avatars" | "direct-author";
    registryCommit?: string;
    projectId: string;
    sourceRecordSha256: string;
    sourceModelUrl: string;
    sourcePageUrl?: string;
  };
  rights: {
    licenseId: string;
    creator: string;
    attributionText?: string;
    licenseUrl: string;
    modificationNotice?: string;
    reviewedBy: string;
    reviewedAt: string;
  };
  binary: {
    sha256: string;
    bytes: number;
    vrmVersion: "0.x" | "1.0";
    mediaType: "model/gltf-binary";
  };
  compatibility: AvatarCompatibilityProfile;
  animationProfileId: string;
  state: "candidate" | "admitted" | "suspended" | "retired";
}
```

Admission is immutable. A changed model produces a new revision and repeats every gate.

### Signed presentation catalog

The presentation catalog changes more often than model revisions and contains:

- localized name, summary, tags, and thumbnail references;
- collection and sort rank;
- admitted revision ID and compatibility summary;
- `free`, `unlockable`, `unavailable`, or `retired` availability by release profile/region;
- offer IDs, never raw price authority;
- installed/update state hints;
- signed catalog version, issue time, expiry/stale policy, and key ID.

The main process verifies its signature before exposing a typed projection to the renderer. Unknown fields fail closed at the security boundary but may be retained by the service for forward compatibility.

### Asset delivery

Production assets are immutable objects addressed by SHA-256. A successful entitlement check produces a short-lived signed HTTPS download URL or an authenticated stream. Main:

1. validates allowed scheme/host/port;
2. enforces time and byte limits;
3. validates content signature and exact hash;
4. writes the object and provenance sidecar atomically;
5. reparses both before use; and
6. evicts by bounded LRU policy without deleting the active avatar.

GitHub and upstream Arweave/IPFS URLs remain provenance inputs, not the premium production CDN and not the access-control mechanism.

## Free tier and first-avatar policy

Milk remains the working default, but the final three must be selected by evidence rather than taste alone.

### Selection portfolio

- **Friendly iconic default:** immediately legible at companion scale and strong on low-end GPUs.
- **Representative humanoid:** medium proportions, complete normalized humanoid, useful for broad motion compatibility.
- **Stylistically distinct companion:** demonstrates range without requiring special shaders, props, or missing bones.

All three must be verified CC0-1.0 for the first release, pass embedded commercial/redistribution checks, load offline from the release/cache design, and pass the representative animation/state matrix. At least one must cover VRM 0.x and one VRM 1.0 when qualifying binaries are available. A project label such as unversioned `CC-BY` is not sufficient for admission without the canonical terms.

### Free-tier promise

- no payment account required;
- no expiring trial;
- full agent connection and companion features;
- all core state animations and motion controls;
- local activation and restart persistence; and
- source/licence/provenance visible.

Premium changes choice and polish, not agent capability, safety, or accessibility.

## Motion personality

Users should choose a temperament, not configure 85 animation filenames.

### Presets

| Preset | Intended behavior |
| --- | --- |
| `Paused` | Static readable state changes only; no autonomous or conversational body animation. |
| `Quiet` | Blink/gaze and long calm idle intervals; rare restrained reactions. |
| `Balanced` | Default. Living idle, state-readable thinking/speaking, occasional reactions, rare playful moments. |
| `Lively` | Shorter quiet intervals and richer reactions/play, still bounded and interruptible. |
| `Custom` | User-selected category intensity and frequency within safety limits. |

System reduced-motion remains authoritative when the mode is `System`. An explicit in-app Reduced preference may be stricter. No preset can weaken cancellation, approval readability, or GPU suspension policy.

### Human categories

| Category | Examples | Default role |
| --- | --- | --- |
| Presence | looking around, breathing, blink, gaze | continuous life without demanding attention |
| Conversation | attentive, thinking/searching, speaking gestures | communicate agent state |
| Reactions | nod, success, concern, wave | acknowledge meaningful events |
| Playful | celebration, dance, stretch | rare personality moments |
| Locomotion & fantasy | walk, run, jump, magic | explicit user/agent request or specially admitted program |

The advanced UI exposes category levels (`Off`, `Low`, `Normal`, `High`) and a calmness/frequency slider. Individual clip selection remains a developer/admission tool, not normal settings.

### Scheduler contract

The scheduler consumes semantic programs and policy:

```ts
interface MotionPersonalityPolicy {
  preset: "paused" | "quiet" | "balanced" | "lively" | "custom";
  categories: Record<MotionCategory, 0 | 1 | 2 | 3>;
  quietIntervalRangeMs: [number, number];
  repeatWindow: number;
  maxDecorativeSharePerHour: number;
}
```

Per-avatar animation profiles declare compatible semantic programs, crop/fit margins, root-motion permission, required bones, collision/prop exclusions, and reviewed intensity. Runtime intersects:

```text
OS accessibility
  ∩ user's motion policy
  ∩ normalized companion state
  ∩ avatar compatibility profile
  ∩ admitted animation rights
= eligible semantic programs
```

The existing one-owner motion arbiter remains authoritative. An explicit typed Wave/Jump action outranks decorative motion; agent state outranks personality; approval/cancellation/error clear lower-priority queues.

## Marketplace experience

The Marketplace is a first-class route within the standard control-center window. It may visually occupy the full content area, but it is not a nested modal: browser-like navigation, deep state restoration, keyboard focus, screen-reader landmarks, and back behavior must work.

### Entry points

- Control Center navigation: `Companions`.
- Current-avatar card: `Change companion`.
- Locked recommendation from an agent: opens the exact detail page but never checkout automatically.
- Tray: only `Change companion…`, which opens the control center.

### Browse surface

- responsive grid with stable thumbnail aspect ratio;
- search by name, creator, collection, and tag;
- filters for `Free`, `Unlocked`, `Available`, VRM version, style, and performance class;
- visible state chips: `Free`, `Unlocked`, `Installed`, `Update`, `Unavailable`;
- no fake scarcity, countdown timers, dark patterns, or default sorting by price;
- skeleton/loading, verified offline-stale catalog, empty, and error states.

### Detail and preview

The detail route shows:

- large isolated preview with safe demo states;
- compatibility/performance summary;
- included Desky motion profile and revision;
- creator, source, licence, attribution, and modification notice;
- exact offer wording and tax/fee disclosure supplied by the checkout provider;
- installed/download size and offline availability;
- report/legal contact; and
- activate, download, restore, update, or checkout action as applicable.

Preview never mutates the active desktop avatar until the user chooses `Use companion`. A failed preview cannot evict the current working companion.

### Commerce state machine

```text
locked
  -> fetching quote
  -> awaiting human approval
  -> awaiting wallet/store settlement
  -> reconciling order
  -> granting entitlement
  -> downloading
  -> verifying
  -> ready to activate
```

Every state is durable enough to resume after app/browser restart. `Cancel` is available before signing. A duplicate callback is idempotent. Settlement success followed by delivery failure shows `Purchased — retry download`, never `Buy again`.

### Offer vocabulary

- `Unlock for Desky`
- `Unlock collection`
- `Included with Catalog Pass`
- `Free`

Avoid `Buy ownership`, `exclusive`, `rare`, `NFT`, or claims that Desky created a third-party avatar.

## Offer strategy

### Product types

| Type | Grant | Launch role |
| --- | --- | --- |
| Free avatar | perpetual | three launch companions |
| Individual unlock | perpetual | low-friction preference purchase |
| Collection pack | perpetual | best-value themed bundle |
| Catalog pass | time-bounded | only after a credible recurring release cadence |
| Support grant | bounded/perpetual | customer-service correction, never public pricing |

No paid random rewards. No consumable avatar credits at launch. No per-avatar monthly subscription.

### Pricing method

Do not hardcode final prices in this plan. Validate three price bands with:

1. a non-charging marketplace prototype measuring detail-to-checkout intent;
2. interviews that test whether users value motion/profile/support, not merely the model;
3. regional tax-inclusive display and transaction-cost modeling;
4. support/refund load assumptions; and
5. 30-day activation and retention by free vs unlocked companion.

Each offer has a fiat-denominated price book. An x402 quote snapshots that amount into an exact allowlisted USDC atomic amount for a short expiry. Desky does not price in volatile SOL or ETH.

## Agent-facing commerce capability

Commerce is separate from every gateway adapter. OpenClaw, Claude, Hermes, Codex, and future runtimes consume the same Desky capability contract after their provider adapter normalizes tool discovery.

### Read-only tools

- `desky.catalog.search`
- `desky.catalog.get`
- `desky.entitlement.status`

### Deliberate action tools

- `desky.checkout.prepare` returns an offer summary and approval/deep-link ID; it does not spend.
- `desky.avatar.activate` may activate only an already entitled, downloaded, verified avatar and remains subject to local user policy.

There is no `buy` tool with wallet authority. Provider instructions may explain these tools, but users should not need to edit global gateway prompts. Capability discovery and exact tool schemas are adapter responsibilities; unsupported runtimes simply omit the capability.

Agent-originated recommendations are visibly labelled. The human checkout surface shows the same trusted offer independently of model text, and ignores any model-supplied price, recipient, network, or asset address.

## Operations and governance

### Catalog operations

- two-person rights/admission approval for paid listings;
- immutable audit record for source, model hash, licence, compatibility, and reviewer;
- staged catalog publication with signature verification and rollback;
- takedown state stops new purchases immediately without remotely deleting a valid cached asset unless legally required;
- support playbook for unavailable sources, broken updates, refunds, and mistaken attribution;
- creator/source correction route.

### Reliability objectives

- marketplace browse remains usable from last verified catalog during bounded outages;
- already installed entitlements remain usable through an offline lease;
- checkout never loses a settled order;
- reconciliation is idempotent across callback, polling, and support replay;
- catalog or entitlement outage never breaks the current free/installed avatar;
- active avatar replacement is transactional with rollback.

### Privacy

- do not link wallet addresses to conversation content or gateway transcripts;
- store the minimum order/account data required for restore, tax, fraud, and support;
- document retention and deletion exceptions;
- keep catalog analytics opt-in and free of agent text;
- do not expose wallet address or purchase history to connected agents unless the user explicitly asks for a bounded status query.

## Delivery program

### M0 — owner and legal decisions

- choose Desky source licence, publisher entity, selling regions, tax provider, support/refund policy, and privacy URLs;
- obtain written confirmation/terms for monetizing the Desky-ready service around source collections;
- approve public vocabulary and attribution format;
- decide whether the Mac App Store launches with StoreKit products or with only the three free avatars.

Exit: signed decision record and release-profile capability matrix.

### M1 — motion personality

- persist `Paused`, `Quiet`, `Balanced`, `Lively`, and `Custom`;
- add category-level policy and accessible control-center UX;
- map existing programs to semantic categories/intensity;
- prove OS reduced-motion precedence, cancellation, and performance.

Exit: deterministic scheduler tests and packaged visual matrix on Milk.

### M2 — admitted catalog and three free avatars

- implement normalized admitted revision and signed presentation schemas;
- build the ingest/admission report at a pinned upstream commit;
- select three CC0 avatars from actual binary evidence;
- implement content-addressed cache and provenance sidecars;
- transactional activation, restart restore, corrupt-cache recovery, offline use.

Exit: three avatars pass VRM, motion, provenance, replacement, GPU, and accessibility gates on Windows and macOS.

### M3 — marketplace without money

- first-class Companions route, grid, filters, detail, preview, attribution;
- `Free` entitlement provider and visibly labelled development fixtures for locked states;
- download/update/retry/remove flows;
- telemetry and usability study.

Exit: keyboard/screen-reader path and 20 consecutive avatar switches without leak/crash/current-avatar loss.

### M4 — durable entitlement service

- account/wallet binding and recovery design;
- offer, order, payment-attempt, entitlement, asset-grant, refund, and audit models;
- short-lived access JWT/JWKS rotation and bounded offline lease;
- support grants, restore, device migration, takedown, and refund tests;
- no production payment adapter yet.

Exit: adversarial contract suite proves issuer/audience/algorithm enforcement, revocation-on-refresh, idempotency, and restore.

### M5 — x402 Base pilot for direct builds

- pin x402 v2 SDK and Base Sepolia conformance;
- exact USDC allowlist, merchant recipient allowlist, quote expiry, replay checks;
- browser/wallet human approval and post-payment reconciliation;
- production facilitator due diligence, monitoring, and mainnet canary;
- direct Windows/macOS only initially.

Exit: testnet failure matrix and capped mainnet purchase/restore/refund exercise with no wallet key in Desky or an agent.

### M6 — second payment rail and store commerce

- add Solana behind the same payment-adapter interface only if Base operations are stable and customer demand exists;
- implement StoreKit products/receipts/restore for Mac App Store if premium content ships there;
- validate Microsoft Store third-party-commerce declaration/certification or add Microsoft commerce adapter;
- cross-provider grant reconciliation.

Exit: the same offer produces the same entitlement semantics across every enabled rail and disabled rails have no reachable UI/API.

### M7 — provider-neutral agent discovery

- expose read-only catalog/status tools;
- add prepare-checkout approval deep link;
- map OpenClaw first, then shared adapter-host conformance for other runtimes;
- adversarial prompts cannot change price, asset, network, recipient, or approval.

Exit: agent can recommend and prepare; only the trusted local human surface can authorize spending.

### M8 — launch operations

- support console, receipt export, refunds, takedowns, key rotation, incident runbooks;
- store review notes, screenshots, pricing, localization, tax, consumer terms;
- catalog signing ceremony and rollback drill;
- clean-device purchase/restore/offline/update matrix.

Exit: commerce and catalog incident game day passes before public paid launch.

## Success metrics and guardrails

### Product metrics

- free-avatar activation rate;
- seven- and thirty-day retained companion use;
- detail-to-preview and preview-to-unlock conversion;
- unlocked avatar actually activated within 24 hours;
- pack/pass attach rate;
- animation preset distribution and motion-pause rate.

### Trust/reliability metrics

- entitlement restore success;
- settled-payment-to-grant latency;
- duplicate charge count (target zero);
- download/hash failure rate;
- avatar load success by revision/device;
- refund and support-contact rate;
- attribution/source-link visibility and report resolution.

### Stop conditions

Pause paid expansion if any of these occur:

- unresolved rights complaint;
- duplicate or recipient-mismatch payment;
- settled orders cannot reliably restore;
- catalog signing or entitlement key compromise;
- avatar crash/load failure above the release threshold;
- store rejection caused by an enabled commerce capability; or
- user research shows customers believe they are buying exclusive ownership.

## Immediate next implementation slice

Implement M1 and the schema-only portion of M2/M3. Specifically:

1. motion-personality preference and policy parser;
2. catalog/admitted-avatar schemas and strict parsers;
3. a local signed development catalog containing Milk plus two **candidate** slots, not fake finished products;
4. the Companions route with real provenance/licence data and free-only activation;
5. a commerce-provider interface whose sole implementation is `free`;
6. cache/provenance design tests before adding additional binaries.

This slice creates no wallet, blockchain dependency, paid claim, or secret. It produces the exact UX and domain boundaries that later payment adapters must satisfy.

### Foundation status — 2026-08-24

The first sub-slice is implemented. Main now persists and broadcasts the strict motion-personality policy; the autonomous scheduler filters admitted semantic categories and scales quiet cadence without knowing animation filenames. Paused uses the reduced execution path, Quiet excludes playful/locomotion autonomy, and Balanced remains the saved default.

The control center now has a first-class Companions route backed by a strict bundled catalog and free-entitlement decision. It shows only the actually admitted Milk revision as Free/Active, presents two honest `Admission in progress` slots toward the three-free target, displays provenance/licence/compatibility details, and declares commerce/payment rails disabled. The next sub-slice is two real binary admissions plus content-addressed cache, transactional activation, restart/offline recovery, and signed production-catalog work—not x402.
