# F4 motion-control refactor — 2026-08-31

## Problem found

Deskiii exposed two real but poorly arranged policies. Persisted **Companion energy** controlled cadence and eligible semantic categories, while a session-only **System / Full / Reduced** selector was nested inside the local `.vrma` preview card. Every launch silently reset the second policy to System. On a Windows host requesting reduced motion, a saved Balanced temperament therefore appeared static and looked broken.

## Final contract

- One **Companion animation** card owns both user-facing axes.
- **Energy** answers how often Deskiii moves and which admitted categories are eligible: Still, Quiet, Balanced, Lively, or Custom.
- **Movement** answers how much motion is allowed: Full motion, Follow Windows, or Reduced motion.
- Both policies are validated, main-owned, broadcast to both renderers, and persisted atomically in `desktop-state.json`.
- Full motion is the default for new and migrated state, by product decision.
- When Full overrides a Windows reduced-motion request, the Control Center says so explicitly.
- Still does not mutate the Movement choice. It remains a temperament with zero autonomous/conversational body motion.
- Local `.vrma` preview contains only file selection/playback and obeys the saved settings above.

The runtime precedence remains:

1. cancellation, approval readability, asset admission, and lifecycle safety;
2. Movement accessibility envelope;
3. normalized agent state and explicit typed actions;
4. Energy category/cadence policy;
5. optional local preview.

## Ambient polish included in the same round

- Ready-state avatar provenance no longer becomes ambient hover chrome; loading and actionable graphics/error recovery remain visible.
- The unbounded native title tooltip is replaced with a delayed, glass control guide for Rotate, Move, and Jump.
- The guide is keyboard-associated, pointer-transparent, reduced-motion safe, and suppressed when a below-avatar response needs its space.

## Voice diagnosis

The live OpenClaw catalog reported its realtime provider ready, with `gpt-live-1-codex`, gateway relay, mono PCM16/G.711, and barge-in admitted. Subsequent current-upstream review showed that the selected GA voice `cedar` did not belong to the separate GPT-Live Codex V3 voice contract. After selecting `spruce`, session admission passed. The historical 403 therefore did not establish an account-access failure and was unrelated to this motion-control refactor.

## Verification

- `npm test`: 96 files passed, 7 skipped; 528 tests passed, 12 skipped. The skips remain the existing opt-in credential/platform lanes.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm audit --omit=dev`: zero production vulnerabilities.
- `npm run package:windows:direct`: passed; the signed-profile boundary verifier inspected the ASAR and found all four hosted-commerce signatures absent.
- Fresh packaged Control Center: Balanced and Full selected by default; Movement lives inside the Companion animation card; the local preview owns no Movement control.
- Packaged persistence exercise: selected Reduced motion, exited, reopened the same clean profile, and restored Reduced motion with no exercise error.
- Packaged ambient exercise: Milk reached ready state with full motion, ready provenance computed to `display: none`, and the custom control guide became visible with no exercise error.
