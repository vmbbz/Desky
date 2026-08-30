# Deskiii brand kit

Deskiii gives the agents people already use a living, trustworthy place on their desktop.

## Brand platform

- **Official name:** Deskiii
- **Motto:** **Give your agent somewhere to be.**
- **Product descriptor:** A living desktop for the agents you already use.
- **Founding mascot:** Milk
- **Brand promise:** presence without intrusion; personality without hiding control.

Milk is Deskiii's permanent brand character, even when a user selects a different companion from the marketplace. The chosen avatar represents the user's companion; Milk represents Deskiii itself.

## Official mark

The official icon is a close-up of **Milk**. It is supported by a responsive family rather than forcing one detailed drawing into every context:

- the close-up Milk icon is the primary Store, launcher and social-avatar asset;
- the simplified Milk carton is the compact mark used beside the wordmark;
- the one-color Milk silhouette is the tray and monochrome-system glyph;
- the richer “Milk at the edge” scene is reserved for splash, onboarding and campaign motion.

This makes the brand literal: Deskiii is not a letter or an abstract AI symbol; it is a companion with a recognizable face. The carton cap, asymmetric folded side, milk-blue bands and face remain the four protected recognition features.

Use the supplied assets without redrawing their proportions:

- `logo/desky-app-icon.svg` — authoritative scalable application icon;
- `logo/desky-app-icon-512.png` — transparent 512 px raster export;
- `logo/desky-mark-on-dark.svg` and `logo/desky-mark-on-light.svg` — mark-only variants;
- `logo/desky-lockup-on-dark.svg` and `logo/desky-lockup-on-light.svg` — mark and wordmark variants.
- `logo/desky-tray-glyph.svg` — one-color system-tray glyph;
- `logo/desky-companion-mark.svg` — expressive window-edge mark for large surfaces;
- `logo/raster/` — inspected 16–256 px raster exports and tray templates;
- `logo/platform/apple/` — unmasked background and mascot layers for Icon Composer.

The hosted checkout uses `desky-lockup-on-dark.svg` in its header and the cropped Milk application icon for browser favicon and touch-icon surfaces. Its build copies these masters under content-hashed filenames, so the checkout cannot drift to a separately redrawn mark. The retired abstract `D` portal must not return on hosted commerce surfaces.

Keep clear space around the compact mark equal to the height of one eye. Do not add the word `MILK` inside small icons, substitute another marketplace avatar, remove the face, turn the carton into a generic rounded robot, add crypto/network logos, or place limbs in the 48 px and smaller icon.

Apple delivery must import the unmasked full-canvas layers into Icon Composer and let the system apply its final mask and Liquid Glass treatment. Windows uses the straight-on flattened master and the size-specific raster exports. The richer mark never replaces the compact tray glyph.

## Color

| Role | Token | Hex | Use |
| --- | --- | --- | --- |
| Foundation | Ink | `#0A0E17` | Wordmarks, dark surfaces, high-contrast text |
| Depth | Midnight | `#111827` | Control Center and cinematic fields |
| Air | Cloud | `#F5F8FF` | Bright campaign fields and light text |
| Identity | Signal Mint | `#75E6D7` | Primary brand signal and key actions |
| Presence | Milk Blue | `#78B7E2` | Presence dot and mascot connection |
| State | Success | `#89F29B` | Completed/connected states only |
| State | Attention | `#FFC56B` | Approval and attention only |
| State | Danger | `#FF7D91` | Errors and destructive actions only |

Machine-readable values live in `brand-tokens.json`.

## Typography

- **Display and campaign:** Space Grotesk, 400–700. Use open counters, restrained tracking and sentence case except for the short `DESKY` wordmark.
- **Interface and long copy:** Inter when packaged; otherwise the native UI stack (`Segoe UI Variable`, `SF Pro Text`, sans-serif).
- **Motto treatment:** regular weight, sentence case, and a full stop.

The admitted Space Grotesk variable font and its upstream metadata are in `fonts/space-grotesk/`. It is distributed under the SIL Open Font License 1.1 included beside the font. The logo mark remains vector geometry and does not depend on a font.

## Visual language

Deskiii campaign art uses four recurring ideas:

1. **The edge:** Milk sits on a window, screen or physical desk edge.
2. **The crossing:** a limb or shadow crosses the digital/physical boundary.
3. **The face:** Milk's expression is the recognition anchor and may react without changing construction.
4. **The space:** generous quiet space lets the companion feel intentional.

Avoid generic AI brains, robot heads, glowing coins, code rain, blockchains, hologram clutter and crypto speculation imagery.

## Launch images

- `poster/desky-through-the-screen-x.png` — **primary reveal**; explains the companion idea immediately.
- `poster/desky-school-desk-x.png` — **warm follow-up**; introduces Milk as the new classmate.
- `poster/desky-first-signal-x.png` — **technical/onchain teaser**; use for the signed-authorization story.
- `poster/*-background.png` — clean generated masters without typography.

The exact generation prompts are preserved in `prompts/`. `scripts/render-posters.ps1` reapplies deterministic brand typography to the background masters with FFmpeg. `scripts/render-logos.ps1` regenerates the inspected raster icon family from the vector master.

## Voice

Deskiii sounds calm, curious and exact. Prefer short observations over hype. The product can be playful; claims about security, payments and agent capabilities must be literal.

Say “onchain access” or “signed authorization” when that is what exists. Do not imply that Desky has deployed a proprietary smart contract: the current pilot uses the x402 flow and the admitted Base Sepolia USDC contract. Do not say “live,” “buy now,” “mainnet,” “ownership” or “NFT” until the corresponding release gate is actually complete.

## Mascot provenance

Milk comes from the admitted Open Source Avatars catalog and is tracked by Deskiii as a CC0 `100Avatars R1` asset. The posters are newly generated campaign concepts based on user-supplied footage and the admitted character reference; they are not redistributed upstream thumbnails or VRM binaries.
