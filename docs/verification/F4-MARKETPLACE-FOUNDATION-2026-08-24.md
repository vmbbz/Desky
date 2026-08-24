# F4 marketplace and motion-personality foundation — 2026-08-24

## Scope

This round implements the smallest payment-free slice from `docs/AVATAR-MARKETPLACE.md`:

- persisted Paused, Quiet, Balanced, Lively, and Custom companion-energy policies;
- semantic Presence, Conversation, Reactions, Playful, and Locomotion/Fantasy category levels;
- runtime enforcement in the existing autonomous scheduler and single-owner motion controller;
- a strict bundled marketplace catalog/parser and a free-only entitlement decision;
- a first-class Companions control-center route;
- one real admitted entry, Milk, and two visibly unavailable admission slots; and
- an exact main-owned source-opening route. No payment, wallet, x402 SDK, locked price, or simulated entitlement was added.

## Security and truthfulness

- Personality categories filter only already admitted file tags; they cannot name or re-enable catalog-only clips.
- Paused reuses the reduced-motion execution path and suppresses authored/procedural body motion.
- Quiet removes Playful and Locomotion autonomy and lengthens quiet intervals; Balanced remains the default.
- The policy is parsed in shared code, stored in main-owned `desktop-state.json`, and can be changed only from the control center.
- The renderer receives a bounded catalog projection. Commerce-disabled catalogs reject locked entries, and candidates cannot be presented as available.
- External source opening accepts only an avatar ID and resolves the exact catalog-owned HTTPS URL in main.
- The Marketplace says `Commerce disabled · free foundation`, shows `Payment rails Off`, and never displays invented prices or products.

## Automated verification

Final commands:

```text
npm run typecheck
npm run lint
npm test
npm run package
```

Results:

- typecheck passed;
- lint passed;
- 32 test files passed, one skipped;
- 146 tests passed, one skipped; and
- Windows x64 packaging passed after stopping only the old packaged Desky process that held `out/Desky-win32-x64/dxil.dll`.

New tests cover preset/category parsing, malformed persistence recovery, semantic tag mapping, quiet/lively cadence, scheduler reset, commerce-disabled catalog rules, candidate availability rejection, and the free entitlement decision.

## Packaged Windows evidence

The fresh package ran through the production `desky://` renderer with isolated application data and the control-center `marketplace` visual state. The ignored diagnostic reported:

```text
surface: control-center
marketplaceVisible: true
marketplaceCards: 3
marketplaceCommerce: Commerce disabled · free foundation
marketplaceActive: Active companion
rootChildren: 1
```

The ignored 762 × 720 capture visibly showed:

- one polished Milk card labelled Free and Active companion;
- source/licence, CC0-1.0, performance, animation, creator, and attribution information;
- two dashed free slots labelled Admission in progress rather than fake avatars;
- one admitted / three-free target / payment rails off metrics; and
- clear human-payment language below the catalog.

The package, isolated profile, screenshots, diagnostics, downloaded models, and generated assets remain ignored and uncommitted.

## Remaining F4 catalog work

- Admit two more real CC0 binary avatars across representative VRM version, proportions, and performance classes.
- Add content-addressed cache/provenance sidecars and transactional active-avatar replacement.
- Move from the bundled foundation authority to a signed/versioned production presentation catalog with stale/rollback policy.
- Add isolated real-model preview, download/update/remove, restart/offline, and twenty-switch leak/recovery evidence.
- Keep commerce disabled until those gates pass and the owner/legal F4x decisions are assigned.
