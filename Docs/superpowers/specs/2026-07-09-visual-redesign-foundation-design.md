# Solith Visual Redesign — Foundation Pass

**Status:** Approved, pending implementation plan
**Date:** 2026-07-09
**Scope:** Foundation only — design tokens, fonts, icon system, and the cross-cutting shell components (top status bar, sidebar, game-profile hero, module card, activity log, bottom status bar). No redesign of page-specific business content (trainer/live-watch/backups/discovery/settings internals), no feature/trainer/live-memory/safety-scope changes.

**Revision note:** this direction went through three mockup rounds. Round 1 (muted single desaturated-cyan accent, minimal personality) and round 2 (added dual-accent + depth but leaned grey/brown "tactical console") were both explicitly rejected as too drab. Round 3 ("Immersive Game Command Center," navy/cyan/violet) is the approved final direction below — this document describes only that final state, not the intermediate rounds.

## Target identity

**"Premium in-game command center / game HUD / save-trainer hub."** The user should feel like they're managing a game profile from inside a polished game menu — not using a dark admin dashboard that happens to have game labels on it.

Explicitly not: professional-admin-console-with-game-words, dark spreadsheet, database admin panel, VS Code clone, flat web form, terminal-only UI, childish/arcade UI, cheap neon, cyberpunk overload, muddy brown/grey, AI-generated sci-fi panel spam.

## Constraints discovered during exploration (unchanged from round 1)

- **Offline-only CSP** (`index.html`): `script-src 'self'`, `font-src 'self' data:`, `img-src 'self' data:`, no external connections. All fonts and icons must be vendored into the repo and self-hosted — no CDN.
- **No component framework**: plain React + hand-rolled CSS custom properties + per-component `.module.css`. Confirmed: **no Tailwind, no shadcn/ui, no Radix** for this pass (explicitly declined — avoids new build tooling/dependency risk right after a clean remote-verified state).
- **`base: './'` in `vite.config.ts`**: app loads via `file://` in Electron, so built asset paths must stay relative. `index.css` is loaded via a JS `import` in `src/index.tsx`, so Vite processes it — relative `url()` references in `@font-face` are correctly rewritten, same as other bundled assets.
- **No `THIRD_PARTY_LICENSES.md` exists yet.**
- **No icon library dependency**: vendor a curated SVG subset instead of `@tabler/icons-react`.

## Design tokens (`src/app/styles/index.css`)

Full replacement of the existing `:root` custom-property block (bright cyan/purple/teal neon set). Radius, non-glow shadow, and transition tokens carry over unchanged.

| Token | Value | Usage |
|---|---|---|
| `--bg-base` | `#0b0f1e` | App shell background. **Must always carry a visible navy/indigo hue — never renders as flat/pure black** (e.g. `#0a0a0a` neutral gray-black is wrong; this must read as deep navy) |
| `--bg-topbar` | `#0c1020` | Top status bar, bottom status bar |
| `--bg-sidebar` | `#0e1322` | Sidebar |
| `--bg-main` | `#0f1324` | Main content area (texture applied here — see below) |
| `--bg-card` | `#151b2e` | Module cards, log panel header |
| `--bg-hero` | `linear-gradient(135deg, #1a2138, #121729)` | Game-profile hero card only — the single most elevated surface on the page |
| `--bg-log` | `#0a0d1a` | Activity log body |
| `--accent` | `#4fb8d9` | Primary precision accent: active nav, selected states, primary icon slots, hero border |
| `--accent-dim` | `rgba(79,184,217,.12)` | Accent-tinted backgrounds (active nav row, etc.) |
| `--accent-dim-strong` | `rgba(79,184,217,.16)` | Icon-slot fills, primary button background (see "controlled button" below) |
| `--accent-border` | `rgba(79,184,217,.35)` | Accent borders |
| `--accent-text` | `#7fd6ee` | Text/icons on accent-tinted backgrounds |
| `--accent-secondary` | `#8b7cd8` | Violet — **restricted usage**: live-memory / system / "special" modules only. Not a general-purpose second color. |
| `--accent-secondary-dim` | `rgba(139,124,216,.12)` | |
| `--accent-secondary-text` | `#b3a6ec` | |
| `--safe` | `#5cb88a` | Emerald — SAFE/verified states only |
| `--safe-dim` | `rgba(92,184,138,.12)` | |
| `--caution` | `#c99a4a` | Amber — CAUTION states |
| `--caution-dim` | `rgba(201,154,74,.12)` | |
| `--danger` | `#c9636b` | Muted red — BLOCKED states |
| `--danger-dim` | `rgba(201,99,107,.12)` | |
| `--gold` | `#c9a227` | **Rare accent only** — save-slot/reward-style emphasis (e.g. a "★ 3 slots" chip). At most one element per screen. Never a card rail, never a button, never a running theme color. |
| `--text-primary` | `#eef1fa` | |
| `--text-secondary` | `#aab3cc` | Bumped brighter than round 2's `#8a93a3` for "B-level readability" |
| `--text-muted` | `#78819c` | Also bumped brighter than round 2 for the same reason |
| `--border` | `#232c48` | Card/panel borders |
| `--font-sans` | `"IBM Plex Sans", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif` | |
| `--font-mono` | `"JetBrains Mono", "Cascadia Code", Consolas, "SFMono-Regular", monospace` | |

No `--shadow-cyan` or any glow token. Depth comes from `box-shadow: 0 Npx Mpx rgba(0,0,0,0.4-0.5)` (plain, non-colored) plus the layered surface levels above — never a colored glow.

## Compositional shell (new primitives this pass)

These were designed and approved together as one composition, not as independent pieces — they belong in the foundation pass because they're cross-cutting shell chrome, not page-specific business content.

- **Top status bar**: app mark + wordmark (left), safety-mode chip + last-backup timestamp (right). Thin bottom border with a subtle cyan→violet gradient line (opacity ~0.5, not a glow).
- **Sidebar**: brand block (notched mark, name, tagline) → sectioned nav ("Operations", "System") with icon-slot + label rows. Active item: tinted background + 3px accent-colored left rail + filled icon slot with accent border — not just a thin colored line.
- **Game-profile hero**: the single strongest visual element on the page (per adjustment #2 — "stronger and more central"). Art placeholder + large title (19–24px) + path/engine metadata in mono + status chips + one primary action. Uses `--bg-hero`, the most elevated surface, with a visible accent border and soft (non-colored-glow) shadow.
- **Module card**: generic reusable card for loadout/status items — left accent rail (color = semantic: emerald/violet/danger/cyan per context), icon slot, title, description, metadata row (mono, separated by a thin top border), footer with status chip + secondary label. Slightly notched top-right corner (clip-path, ~10-12px) — visible enough to register, not a gimmick.
- **Activity log**: its own module with a header bar (icon + "ACTIVITY LOG" label) sitting on `--bg-card`, body on `--bg-log` in mono, colored inline tags (`[ok]`/`[warn]`/address values).
- **Bottom status bar**: persistent footer — status dots (offline-mode, live-memory-disabled) + version, mono text.
- **Texture**: a very subtle 22-24px grid (`rgba(~140-170, ~160-190, ~220, 0.02)` lines) applied **only** to `--bg-main` (the large empty main content background) — never on cards, sidebar, or bars.

### Adjustment-driven refinements (from the approval round)

1. Game-HUD feel pushed via: notched shapes on hero/cards/nav mark, filled+bordered icon slots (not bare glyphs), layered shadow depth on the hero specifically.
2. Hero is structurally first in the main content, largest padding/type-size/shadow of any element on the page — the clear focal point.
3. **Primary button ("Apply Change") is not a solid bright-cyan fill.** It uses `background: var(--accent-dim-strong); border: 1px solid var(--accent); color: var(--accent-text);` — a bordered/tinted treatment consistent with the chip language, not a web-CTA-bright button.
4. Violet (`--accent-secondary`) is scoped to live-memory/system-flagged modules only (e.g. the "Live Memory Watch" card's rail + icon). General metadata chips (version, etc.) use neutral/cyan, not violet, so violet stays a meaningful signal rather than decoration.
5. SAFE (emerald) / CAUTION (amber) / BLOCKED (danger-red) remain visually distinct at both the card-rail and chip level — confirmed non-overlapping hues.
6. `--bg-base` fixed at `#0b0f1e` specifically to avoid ever reading as flat/pure black.
7. Grid texture confirmed main-content-only.
8. Text tokens bumped brighter than the round-2 draft for contrast/readability.

## Fonts

Unchanged from the original plan: vendor IBM Plex Sans (400/500/600) + JetBrains Mono (400/500), `.woff2` only, under `src/app/assets/fonts/` (not `public/`, per the `base: './'` constraint). `@font-face` via relative `url()` in `index.css`.

Global typography guard (fixes the serif-leak risk from native form controls not inheriting `font-family`):
```css
button, input, select, textarea { font-family: inherit; }
```
Remove the redundant per-component `font-family: Inter, ...` declarations this replaces.

## Icons

16 vendored Tabler SVGs (trainer, backups, discovery, settings, safe/check, caution/warning, blocked/lock, game/profile, save/config, live-watch/activity, database/storage, log/terminal, search, refresh, apply/check, cancel/x) under `src/app/components/icons/`, plus a small `Icon.tsx` wrapper (`<Icon name="trainer" size={16} />`, `currentColor`-based). No new npm dependency.

## `THIRD_PARTY_LICENSES.md` (new, repo root)

Create it, covering: IBM Plex Sans (OFL 1.1), JetBrains Mono (OFL 1.1), the 16 vendored Tabler icon SVGs (MIT), and a cross-reference to the existing `vendor/memoryjs-3.5.1-patched/LICENSE.md` (MIT).

## Shared primitives touched this pass

- `.btn-primary`, `.btn-secondary`, `.btn-add` — re-tint per the "controlled button" rule above, drop redundant `font-family`
- `.sidebar`, `.nav-section button` — rebuilt per the sidebar spec above (icon slots, sectioning, stronger active state)
- `.engine-badge` and variants — `.unity` keeps accent-cyan tint; `.unreal`/`.godot` (previously purple/teal) become neutral steel, since those hues aren't part of this palette
- `.game-card` — superseded by the new generic module-card pattern where it represents a loadout/status item; where it's genuinely just a game-library entry (not a loadout item), re-tint to the new tokens without the full module-card treatment
- New: top status bar, bottom status bar, game-profile hero, module card, activity log — as specified above
- Checkbox styles, scrollbar thumb color — re-tint to `--accent`-derived values

## Explicit non-goals for this pass

- No Tailwind, shadcn/ui, or Radix
- No `@tabler/icons-react` or any new npm dependency
- No redesign of page-specific business content inside trainer/live-watch/backups/discovery/settings (the shell around them changes; their internal contents are a later pass)
- No removal of `backdrop-filter` blur structurally — not addressed either way this pass; the new hero/card treatment doesn't depend on it
- No feature changes, no trainer logic changes, no live-memory behavior changes, no safety-scope changes
- No new game-support claims, no Palworld live-cheat claim
- Gold (`--gold`) must not become a de facto third theme color — enforce the "rare, at most one element per screen" rule during implementation review

## Verification plan

1. `npx tsc --noEmit`
2. `npm run test:trainer-schema`, `npm run test:live-memory`, `npm run test:trainer-host`, `npm run test:cheat-toggle`
3. `npm test` (full suite, expect 535/535 unchanged — this pass touches no application logic)
4. `npm run build:electron`
5. Visual check: start the dev server, screenshot the shell (top bar, sidebar, hero, module cards, log, bottom bar) to confirm: no serif leak, no glow, background reads as navy not black, violet appears only on live-memory/system modules, gold appears at most once, primary button reads as controlled/bordered not a bright web CTA
