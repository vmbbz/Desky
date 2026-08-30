# Deskiii logo direction — August 2026

## Outcome

Retire the abstract `D` portal. Make Milk the permanent Deskiii brand character and build a responsive logo family around Milk's carton silhouette and face.

There is no universal or credible “highest-rated logos of 2026” table. The useful evidence is the overlap between current platform rules, juried 2026 identity work and expert trend reporting.

## Evidence

### Platform requirements

- [Apple Human Interface Guidelines: App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons) says to find one concept that captures the app's essence, express it with a minimal number of shapes, keep primary content centered, avoid nonessential text and preserve recognizability across appearance variants.
- [Apple Icon Composer](https://developer.apple.com/icon-composer/) uses full-canvas layered artwork and applies Liquid Glass, refraction, highlights and platform masks in the tool. A pre-masked single PNG is not the complete macOS delivery format.
- [Microsoft's March 2026 app-icon guidance](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-design) prefers a singular literal metaphor, a balanced and distinctive silhouette, few shapes and corners, minimal gradients, straight-on perspective, no typography and explicit small-size testing.

### Current identity practice

- [Creative Bloq's 2026 logo-trend review](https://www.creativebloq.com/design/logos-icons/these-logo-design-trends-will-define-2026) identifies behavioral mascot energy, responsive logo families and restrained tactile depth as current directions—and argues against polished, interchangeable corporate marks.
- [Creative Bloq's May 2026 mascot analysis](https://www.creativebloq.com/design/branding/mascots-are-back-but-not-as-you-know-them) describes modern mascots as active interfaces that guide, react and build recognition through behavior. That directly matches a desktop companion.
- [Core77's 2026 Branding & Identity winner](https://www.core77.com/posts/144500/The-2026-Core77-Design-Awards-Branding-n-Identity-Winners) was praised for restraint, clarity and a coherent system rather than logo complexity.
- [Best Brand Awards 2026](https://www.bestbrandawards.com/winners/year2026) includes mascot-led identity work such as Pets As Therapy, whose dog character expresses everyday connection and makes the system more approachable.

## Desky-specific decision

| Requirement | Decision |
| --- | --- |
| Product metaphor | Milk is the companion; the face is literal, ownable and already present in-product. |
| Store icon | Large cropped Milk face and carton silhouette; no letter and no word. |
| Small-size mark | Simplified carton with cap, face and two blue bands. |
| Tray/mono | One-color carton silhouette with face cutouts. |
| Rich expression | Milk gripping a desktop-window edge, used only at large sizes. |
| Motion | Blink, glance and rise slightly across the edge; never change core proportions. |
| Marketplace | User avatars can change, but Milk remains the Desky brand character. |
| Apple | Export background and mascot as separate full-canvas Icon Composer layers. |
| Windows | Flatten straight-on; validate on the 48 px grid and at 16/24/32/48 px. |

## Rejected directions

1. **Portal D:** generic monogram, weak product metaphor and indistinguishable from utility/finance/developer apps.
2. **Full-body waving Milk:** expressive at 512 px but the arms disappear and create noise below 48 px.
3. **Detailed window scene as the only icon:** tells the story at large sizes but window controls and hands collapse in the taskbar and tray.

## Responsive family

1. `desky-app-icon.svg` — Milk close-up for Store, launcher and profile use.
2. `desky-mark-on-*.svg` — compact mascot mark for wordmarks and headers.
3. `desky-tray-glyph.svg` — monochrome system surface.
4. `desky-companion-mark.svg` — expressive large-format mark.
5. `platform/apple/*.svg` — separately composable Liquid Glass layers.
