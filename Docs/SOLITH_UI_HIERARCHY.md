# Solith UI hierarchy

**Rule:** The top banner owns brand identity. The sidebar is navigation only.

## Brand surfaces (one primary banner)

| Surface | Role | Content |
|---------|------|---------|
| **Top banner** (`SolithTopBanner`) | Primary brand | HTML `SOLITH` title, tagline, emblem image, text-free backdrop art |
| **Loading state** | Transient identity | Small emblem only — no slogan block |
| **Page module headers** | Section context | Optional small artwork + page title — not product slogan |

## Sidebar (tool rail)

| Allowed | Forbidden |
|---------|-----------|
| Small emblem (28px) | Full product slogan |
| Tiny muted “Solith” label (11px) | Large title + subtitle block |
| Compact collapse control (28px icon) | “Collapse” CTA button row |
| Nav icons + section labels | Second banner / hero treatment |

## Custom artwork usage

| Asset | Use |
|-------|-----|
| Winged controller | Game Library, live trainer contexts, multi-game cheats |
| Phoenix | Backups / recovery |
| Dragon | Advanced section label only |
| Hooded figure | Sensitive/profile pages — not normal nav |
| Legacy top-banner JPEG | Concept art only — not rendered in shell |

## CSS tokens

- Banner canvas: `aspect-ratio: 4.57 / 1`, max-height 220px
- Shell background: `solith-shell-background.png` at 1920×1080 — not legacy 705×200 landscape
- Sidebar header: `min-height: 44px`

When adding new UI, ask: **Does this duplicate the top banner?** If yes, remove or demote it.
