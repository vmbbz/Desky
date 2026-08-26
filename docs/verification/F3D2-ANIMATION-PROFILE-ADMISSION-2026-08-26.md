# F3d.2 avatar animation-profile admission — 2026-08-26

## Outcome

Desky no longer assumes that every admitted humanoid can safely execute every runnable program in the built-in animation library. Each avatar revision carries an immutable animation-profile identity into the renderer, and production playback admits the library only through that reviewed profile.

## Contract

`desky-humanoid-standard-v1.profile.json` declares:

- library `quaternius-uam-standard-v1`;
- the 15 required hips/spine/head, bilateral arm/hand, and bilateral leg/foot bones;
- state owners for idle, thinking, speaking, and working;
- Phone Check, Dance Break, and Formal Walk as autonomous programs;
- Jump as the sole authored typed-action program;
- reviewed intensity `1` for the current four programs;
- root motion forbidden; and
- project-owner approval with an ISO review timestamp.

Library admission requires an exact set match for every non-catalog program and state binding. A new runnable trigger cannot bypass the profile. Every enabled step is rechecked for forbidden root motion. Only the four profile-enabled programs enter `AvatarMotionController`; the other eleven programs remain catalog data. The scheduler intersects profile intensity with the user's semantic category level.

Marketplace catalog revision 3 requires `animationProfileId`. Milk, CoolBanana, Astronaut, and the isolated Toothpaste pilot use `desky-humanoid-standard-v1`. The external Seed-san VRM 1.0 engineering fixture names the same profile but remains unavailable and outside the marketplace.

## Automated evidence

```text
npm run typecheck                                           PASS
npm run lint                                                PASS
focused profile/library/avatar/controller suite             56 passed
npm run package                                             PASS (Windows x64)
```

The focused suite proves approved-profile parsing, duplicate/unapproved rejection, required-bone failure, exact runnable-program ownership, wrong-trigger rejection, hash admission for all 85 clips, structural binding of all clips to VRM 0.x and 1.0 targets, standing-floor preservation, full Jump completion, scheduler intensity, cache behavior, and marketplace parsing.

## Packaged Windows matrix

A clean isolated profile used the production package and existing transactional switch-soak harness:

- six committed switches;
- all three free avatar IDs observed;
- three marketplace cards and thumbnails;
- all three model cache records `verified`;
- final avatar selection `ready`;
- marketplace commerce disabled; and
- `visualExerciseError: null`.

Diagnostic artifact (ignored/uncommitted):

`artifacts/reference-device/animation-profile-switch-soak-20260826.png.json`

## Honest remaining gates

- The final product-suitable CC0 VRM 1.0 marketplace revision is not selected.
- That product revision needs a native visual review of every profile-enabled state/program; Seed-san proves engineering compatibility, not product admission.
- Catalog-only sit/sleep/magic/combat/prop/locomotion candidates remain non-runnable until each has a complete semantic trigger, safe recovery sequence, avatar profile entry, rights review, and packaged visual evidence.
- macOS package and hardware evidence remains deferred.
