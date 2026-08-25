# Desky brand kit

Desky gives the agents people already use a living, trustworthy place on their desktop.

## Brand platform

- **Official name:** Desky
- **Motto:** **Give your agent somewhere to be.**
- **Product descriptor:** A living desktop for the agents you already use.
- **Founding mascot:** Milk
- **Brand promise:** presence without intrusion; personality without hiding control.

The Desky identity is avatar-independent. Milk is the founding mascot and launch character, but the corporate mark must continue to represent the product when a user chooses another avatar.

## Official mark

The mark is a **desktop portal D** with a separate **presence signal**:

- the open D is a window, a doorway and a place for an agent to inhabit;
- the blue signal says that something is present and responsive;
- the simple geometry stays legible at tray, taskbar and Store-icon sizes.

Use the supplied assets without redrawing their proportions:

- `logo/desky-app-icon.svg` — authoritative scalable application icon;
- `logo/desky-app-icon-512.png` — transparent 512 px raster export;
- `logo/desky-mark-on-dark.svg` and `logo/desky-mark-on-light.svg` — mark-only variants;
- `logo/desky-lockup-on-dark.svg` and `logo/desky-lockup-on-light.svg` — mark and wordmark variants.

Keep clear space around the mark equal to the diameter of its presence signal. Do not put Milk inside the corporate mark, recolor individual pieces outside this palette, add crypto/network logos, or use the glow as the only boundary on a light background.

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

Desky campaign art uses four recurring ideas:

1. **The edge:** Milk sits on a window, screen or physical desk edge.
2. **The crossing:** a limb or shadow crosses the digital/physical boundary.
3. **The signal:** one mint line, ripple or light source indicates presence.
4. **The space:** generous quiet space lets the companion feel intentional.

Avoid generic AI brains, robot heads, glowing coins, code rain, blockchains, hologram clutter and crypto speculation imagery.

## Launch images

- `poster/desky-through-the-screen-x.png` — **primary reveal**; explains the companion idea immediately.
- `poster/desky-school-desk-x.png` — **warm follow-up**; introduces Milk as the new classmate.
- `poster/desky-first-signal-x.png` — **technical/onchain teaser**; use for the signed-authorization story.
- `poster/*-background.png` — clean generated masters without typography.

The exact generation prompts are preserved in `prompts/`. `scripts/render-posters.ps1` reapplies deterministic brand typography to the background masters with FFmpeg.

## Voice

Desky sounds calm, curious and exact. Prefer short observations over hype. The product can be playful; claims about security, payments and agent capabilities must be literal.

Say “onchain access” or “signed authorization” when that is what exists. Do not imply that Desky has deployed a proprietary smart contract: the current pilot uses the x402 flow and the admitted Base Sepolia USDC contract. Do not say “live,” “buy now,” “mainnet,” “ownership” or “NFT” until the corresponding release gate is actually complete.

## Mascot provenance

Milk comes from the admitted Open Source Avatars catalog and is tracked by Desky as a CC0 `100Avatars R1` asset. The posters are newly generated campaign concepts based on user-supplied footage and the admitted character reference; they are not redistributed upstream thumbnails or VRM binaries.

