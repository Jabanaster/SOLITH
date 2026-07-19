# WeMod Adoption Plan — Solith / Solith

**Status:** AA–AG **shipped** · tag `v2.2-wemod-adoption` @ `6ddefb8`  
**Product:** Solith 2.0+ (`solith@2.0.0`)  
**Baseline:** `master` @ `6ddefb8` · L/M tagged · `v2.1-shell-polish` + `v2.2-wemod-adoption`  
**Date:** 2026-07-15 (status refresh)  

---

## 1. Executive summary

WeMod succeeds on **discovery, presentation, and operational UX** — not on secret reverse-engineering technology. Solith should adopt WeMod’s **product shape** while rejecting its **closed engine**.

| Adopt | Adapt (Solith twist) | Reject |
|-------|----------------------|--------|
| Launcher install scanning | Open `schema.v1` instead of encrypted blobs | Proprietary trainer format |
| Installed / running badges | Evidence-based L0–L4 cert instead of opaque QA | User trainer upload to closed store |
| Per-game cheat deck UI | Save-field + gated live memory | Broad unscoped cheat expansion |
| Version / stale detection | Local repair ritual + docs | Cloud Boosts / popularity paywall |
| Hotkeys + overlay | Backups + approval gates | Obfuscation / anti-extraction |
| Process-detect surfacing | Attach-to-running (not launch-only) | Copying WeMod/MrAntiFun trainers |

**Strategic outcome:** A local-only trainer shell that *feels* as convenient as WeMod but remains **auditable, offline, and safety-bounded**.

---

## 2. Design principles

1. **Local-first** — All install detection, demand signals, and status live in SQLite; no required network.
2. **Evidence over brand** — `certificationLevel`, hash prefixes, and restart-verify replace “trust the platform.”
3. **Transparent artifacts** — Definitions are JSON/YAML in repo or user-imported; never opaque RAM-only blobs.
4. **Fail visible** — Patch drift shows **Stale / Needs re-verify**, not silent broken cheats.
5. **Scope discipline** — AGENTS.md hard boundaries unchanged (no online multiplayer, injection stealth, unscoped controls).
6. **One format per milestone** — Binary save wave 1 (Terraria `.plr`) stays sequential; don’t parallel five commercial parsers.

---

## 3. Gap analysis (today vs WeMod)

| WeMod capability | Solith today | Gap |
|------------------|--------------|-----|
| Steam/Epic/GOG install scan | Catalog metadata + manual `addGame` | **No launcher path discovery** |
| “You own this game” surfacing | `steamAppId`, CDN art | **No installed badge** |
| Running game detection | `catalog-process-watch` (15s poll) | **No user-facing toast / quick attach** |
| Per-game cheat screen | Trainer page + library cards | **No unified “deck” per catalog title** |
| Version match | `executableHashPrefixes`, fingerprints | **No library-wide stale banner** |
| Hotkeys | Global bindings + overlay | Parity ✓ |
| In-game overlay | Overlay + layout presets | Parity ✓ (tune top 7) |
| Notify / demand | Request verification UI | **No local priority queue** |
| Post-patch repair | Manual milestones S/U | **No automated stale → ritual UX** |
| Drag-drop exe | Partial via add game | **Polish: drop on library window** |
| Creator pipeline | Discovery Lab, CT import, schema.v1 | **Stronger than WeMod** — market it |

---

## 4. Architecture (target state)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Solith Shell (Electron)                   │
├──────────────┬──────────────────────────────────────────────────┤
│ Trainer      │  Install Discovery Service (NEW)                  │
│ Library      │    Steam VDF/ACF · Epic manifests · GOG registry  │
│              │    → installed_games table                        │
├──────────────┼──────────────────────────────────────────────────┤
│ Trainer Deck │  Status Engine (NEW)                              │
│ (per game)   │    hash match · process watch · cert level        │
│              │    → working | stale | metadata-only | running    │
├──────────────┼──────────────────────────────────────────────────┤
│ Overlay      │  LiveMemorySession + TrainerHost (existing)       │
│ Hotkeys      │  trainer-hotkeys + overlay-layout-presets         │
├──────────────┼──────────────────────────────────────────────────┤
│ Discovery    │  schema.v1 compile · CT import · certify scripts  │
│ Lab          │  verify-pointer-path · measure-connection-baseline│
└──────────────┴──────────────────────────────────────────────────┘
```

### New SQLite tables (proposed)

```sql
-- Installed game discovery (read-only scan results)
CREATE TABLE installed_games (
  id TEXT PRIMARY KEY,
  catalog_game_id TEXT,
  platform TEXT NOT NULL,          -- steam | epic | gog | manual
  install_path TEXT NOT NULL,
  executable_path TEXT,
  steam_app_id INTEGER,
  detected_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(platform, install_path)
);

-- Local demand / interest (offline prioritization)
CREATE TABLE catalog_demand (
  catalog_game_id TEXT PRIMARY KEY,
  notify_count INTEGER DEFAULT 0,
  verification_requests INTEGER DEFAULT 0,
  last_requested_at TEXT
);

-- Per-game trainer health (derived, refreshable)
CREATE TABLE trainer_health (
  catalog_game_id TEXT PRIMARY KEY,
  executable_hash TEXT,
  status TEXT NOT NULL,            -- working | stale | unknown | metadata_only
  checked_at TEXT NOT NULL,
  stale_reason TEXT
);
```

### New IPC channels (proposed)

| Channel | Purpose |
|---------|---------|
| `install-discovery-scan` | Trigger full launcher scan; return summary |
| `install-discovery-list` | List `installed_games` joined to catalog |
| `trainer-health-check` | Recompute stale status for one or all games |
| `catalog-demand-notify` | Increment local notify (no network) |
| `catalog-process-detected` | Already exists — wire UI subscription |

---

## 5. Milestone track — Adoption phases AA–AF

Phases are **offline-buildable** unless marked **LIVE**. Live phases reuse Milestone S/U slots; do not fake evidence.

### Phase AA — Install Discovery Engine (offline)

**Status:** **DONE** (shipped with Milestone M package)

**Theme:** WeMod-style “see what I own” without cloud.

**Deliverables**

- [x] `src/core/install-discovery/steam.ts` — parse `libraryfolders.vdf`, `appmanifest_*.acf`
- [x] `src/core/install-discovery/epic.ts` — read Epic launcher manifest JSON (registry → path)
- [x] `src/core/install-discovery/gog.ts` — registry `GOG.com\Games` keys
- [x] `src/core/install-discovery/index.ts` — merge, dedupe, match `catalogGameId` via `steamAppId` + `executables`
- [x] `scripts/scan-installed-games.mjs` — CLI report for evidence packs
- [x] IPC: `install-discovery-scan`, `install-discovery-list`
- [x] Settings: `installDiscoveryEnabled` (default true), `installDiscoveryLastScan`

**Matching rules**

1. `steam_app_id` exact match → catalog row  
2. Else executable basename match against catalog `executables[]`  
3. Else `metadata-only` with manual link option  

**Tests**

- `tests/install-discovery-steam.test.ts` — fixture VDF/ACF under `tests/fixtures/steam/`
- `tests/install-discovery-match.test.ts` — catalog join logic
- No tests that read real `%ProgramFiles%` — fixtures only

**Gate**

```
npx tsc --noEmit
npm run test:install-discovery   # new script
```

**Files (estimate):** ~12 new, ~4 touched (`electron/main.ts`, preload, `global.d.ts`, Trainer Library)

---

### Phase AB — Library status UX (offline)

**Status:** **DONE** (installed badge + filter; running via process toast — full sort/drag polish remains AG)

**Theme:** WeMod library cards + “installed” / “running” at a glance.

**Deliverables**

- [ ] Trainer Library card badges: `Installed`, `Running`, `Verified`, `Stale`
- [ ] Filter chips: Installed only · Running only · Needs re-verify
- [ ] Sort: Recently played (local) · Installed first · A–Z
- [ ] Manual add: drag `.exe` onto library → `addGame` + link to catalog if match
- [ ] Empty state copy: “Scan for installed games” button → `install-discovery-scan`

**UI rules** (extends `Docs/SOLITH_UI_HIERARCHY.md`)

- Badges on **card cover**, not in sidebar  
- Status strip on **Trainer Deck** header (Phase AC), not duplicated in banner  

**Tests**

- `tests/trainer-library-status.test.tsx` or Playwright `trainer-library-installed.e2e.test.ts`
- Virtualized grid still < 300ms search at 1000 entries (`perf-13` budget)

**Gate**

```
npm run test:trainer-catalog
npm run test:performance   # perf-13
```

---

### Phase AC — Per-game Trainer Deck (offline + LIVE attach)

**Status:** **DONE** (`TrainerDeckPage` + IPC; live attach still gated)

**Theme:** WeMod’s single-game cheat screen — toggles, hotkeys, cert badges.

**Deliverables**

- [ ] New route: `#/trainer/deck/:catalogGameId` (or enhance existing Trainer page)
- [ ] Header: cover, title, **health strip** (Working / Stale / Metadata only)
- [ ] Cheat rows from compiled `schema.v1`:
  - Save-field controls → TrainerHost path
  - Memory features → LiveMemorySession (when LIVE enabled)
- [ ] Columns: Name · Type · Cert level · Hotkey slot · Toggle · Backup indicator
- [ ] Actions: Load definition · Export · Request verification · Open install folder
- [ ] `requires_approval` controls: explicit confirm modal (existing safety pattern)

**Blocked on LIVE (partial UI now)**

- Live toggles show “Session required” until attach succeeds  
- Restart-verify badge uses `verify-pointer-path` checklist link  

**Tests**

- Unit: deck maps `memoryFeatures` + `saveEditor.saveFields` to control rows
- E2E: Stardew save-field row renders; memory row shows gated state offline

**Gate**

```
npm run test:definitions
npm run test:trainer-states   # extend
```

---

### Phase AD — Version & stale detection (offline)

**Status:** **DONE** (`trainer-health` + deck/library surfacing)

**Theme:** WeMod post-patch awareness — Solith-visible.

**Deliverables**

- [ ] `src/core/trainer-health/index.ts` — compute status from:
  - Definition `executableHashPrefixes` vs scanned exe SHA256 prefix
  - `trainer_health` table cache
- [ ] On app start + after install scan: batch health check
- [ ] Library + Deck: **Stale** banner with reason (`executable_mismatch`, `no_definition`, `quarantined`)
- [ ] Stale card actions: “Run offline check” → `certify-cheat.mjs --level L1` via IPC wrapper
- [ ] Docs template: `Docs/Certification/<game>/REVERIFY.md`

**Scripts**

- Extend `scripts/certify-cheat.mjs` to accept `--catalog-game-id` resolving bundled definition
- `scripts/trainer-health-report.mjs` — CI nightly artifact

**Tests**

- `tests/trainer-health.test.ts` — hash match/mismatch fixtures

**Gate**

```
npm run test:trainer-health
node scripts/trainer-health-report.mjs
```

---

### Phase AE — Process detect & quick attach (offline UI; LIVE attach)

**Status:** **DONE** (`ProcessDetectToast` → Trainer Deck)

**Theme:** WeMod “game is running” → cheats ready.

**Deliverables**

- [ ] Subscribe renderer to `catalog-process-detected` (preload + hook)
- [ ] Toast: “{displayName} detected — Open Trainer Deck?”
- [ ] Tray optional (future): minimize to tray when game running — **defer** if scope creep
- [ ] Reduce `catalog-process-watch` interval to 5s when Trainer Deck open; 15s idle
- [ ] Deck “Attach” button pre-fills PID from last detection event

**LIVE**

- Attach flow uses existing `LiveMemorySession`; no new injection patterns

**Tests**

- `tests/catalog-process-watch.test.ts` — mock process list
- Playwright: emit fake IPC event → toast visible

---

### Phase AF — Local demand & repair pipeline (offline)

**Status:** **DONE** (catalog-demand + repair checklist)

**Theme:** WeMod Notify Me + repair queue — without cloud Boosts.

**Deliverables**

- [ ] `catalog-demand-notify` IPC — increment `catalog_demand.notify_count`
- [ ] Library: “Notify when verified” for `metadata-only` / `community` tiers
- [ ] Admin/dev view (hidden route or script): `scripts/catalog-demand-report.mjs` sorted by demand
- [ ] Repair workflow doc + UI checklist:
  1. Stale detected (Phase AD)
  2. Offline L1 certify
  3. LIVE: `verify-pointer-path` ritual (Milestone S)
  4. Update definition hash prefixes
  5. Promote cert level
- [ ] Quarantine integration: N negative confirmations → `trainer_health.status = stale`

**Tests**

- Demand counter idempotency per user session policy (1 notify per game per day — configurable)

---

### Phase AG — Polish & parity pass (offline)

**Status:** **DONE** (packaged-smoke 22/22; adoption matrix; overlay bounds table + unit test)

**Theme:** Close remaining WeMod UX gaps.

**Deliverables**

- [x] Overlay bounds: validate top 7 bundled titles @ 1080p + 3440×1440 (`Docs/Reports/OVERLAY_BOUNDS_BUNDLED_TITLES.md`, `tests/overlay-layout-presets.test.ts`)
- [x] Packaged-smoke fixes: point 03 title `Solith`, point 13 `parseSave(gameId, path)`, banner locator
- [x] `Docs/Plans/WEMOD_ADOPTION_MATRIX.md` — one-page adopt/adapt/reject
- [ ] Release tag candidate: `v2.2-wemod-adoption` after fresh-clone gate + **TAG IT** (user-gated)

---

## 6. LIVE-only work (reuse Milestones S, U — do not re-scope)

These complete the adoption story but **require game sessions**:

| Item | Milestone | Script / artifact |
|------|-----------|-------------------|
| Connection baselines | S | `measure-connection-baseline.mjs` |
| Restart-stable pointers | S | `verify-pointer-path.mjs` live mode |
| L3 in-game evidence | U | `certify-cheat.mjs --level L3` |
| L4 production cert | U | Full evidence in `Docs/Certification/` |
| Terraria write promotion | X wave 1 | Fixture round-trip → `canWrite: true` |

**Rule:** Phase AC–AE ship with honest **“offline / session required”** states. LIVE milestones flip badges to **Working** with evidence.

---

## 7. Explicit non-goals

Do **not** implement as part of this plan:

- WeMod trainer import, decryption, or Trainer Spy–style extraction
- Proprietary encrypted cheat blobs
- Public trainer upload marketplace
- Online catalog sync as requirement (optional existing `v2RemoteCatalogSyncEnabled` stays off by default)
- Launch-only-through-Solith requirement
- New cheat categories outside scoped milestones (inventory, teleport, god mode expansion, etc.)
- Anti-debug / stealth injection
- Monetized Boosts queue

---

## 8. File map (consolidated)

| Area | New / modified paths |
|------|----------------------|
| Install discovery | `src/core/install-discovery/*` |
| Health / stale | `src/core/trainer-health/*` |
| DB migrations | `src/core/database/migrations/*` |
| IPC | `electron/install-discovery-ipc.ts`, `electron/trainer-health-ipc.ts` |
| UI | `TrainerLibraryPage.tsx`, `TrainerDeckPage.tsx` (new), `ProcessDetectToast.tsx` (new) |
| Scripts | `scan-installed-games.mjs`, `trainer-health-report.mjs`, `catalog-demand-report.mjs` |
| Tests | `tests/install-discovery*.test.ts`, `tests/trainer-health.test.ts`, e2e extensions |
| Docs | This file, `WEMOD_ADOPTION_MATRIX.md`, per-game `REVERIFY.md` templates |

---

## 9. Dependency graph

```
Phase AA (install scan)
    ↓
Phase AB (library badges) ──→ Phase AF (demand)
    ↓
Phase AD (stale detection) ──→ LIVE S/U (repair evidence)
    ↓
Phase AC (trainer deck) ←── Phase AE (process toast)
    ↓
Phase AG (polish + release)
```

**Parallel safe:** AA + AD schema work; AG overlay tuning alongside AB.

**Serial required:** AB depends on AA data; AC health strip depends on AD; AE deck attach depends on AC route.

---

## 10. Verification gates (per release)

Run in order after each phase merge:

```powershell
cd "G:\ACTIVE_PROJECTS\ResourceForge"   # or workspace root

npx tsc --noEmit
npm test
npm run test:trainer-catalog
npm run test:definitions
npm run build:electron
npm run build
node scripts/validate-packaged-host.mjs
node scripts/orphan-check.mjs
npm run test:packaged-smoke    # target 22/22 after AG
npm run test:accessibility     # nightly CI
```

Phase-specific:

| Phase | Extra gate |
|-------|------------|
| AA | `npm run test:install-discovery` |
| AB | `perf-13` catalog search < 300ms |
| AD | `node scripts/trainer-health-report.mjs` |
| AF | `node scripts/catalog-demand-report.mjs` |

Fresh-clone evidence: `Docs/Reports/FRESH_CLONE_VERIFICATION_<date>.md` before any adoption tag.

---

## 11. Suggested schedule (effort, not calendar)

| Phase | Effort | Risk |
|-------|--------|------|
| AA Install discovery | 3–5 days | Medium — launcher format drift |
| AB Library status UX | 2–3 days | Low |
| AC Trainer deck | 4–6 days | Medium — routing + control matrix |
| AD Stale detection | 2–3 days | Low |
| AE Process toast | 1–2 days | Low |
| AF Demand + repair UX | 2–3 days | Low |
| AG Polish + smoke fixes | 2 days | Low |
| **LIVE S/U** | Session-bound | High — external dependency |

**Total offline:** ~16–24 dev days before LIVE evidence pass.

---

## 12. Success metrics

| Metric | Target |
|--------|--------|
| Install scan recall (Steam fixture suite) | ≥ 95% of fixture manifests matched |
| Catalog search @ 1000 entries | median < 300ms (perf-13) |
| User steps: detect install → open deck | ≤ 3 clicks from library |
| Stale detection after hash change | Banner within 1 health check |
| Packaged smoke | 22/22 pass |
| Zero AGENTS.md boundary violations | Security review per phase |

---

## 13. ROADMAP integration

Add to `ROADMAP.md` milestone table:

| Milestone | Theme | Status |
|-----------|--------|--------|
| **AA** | Install discovery (Steam/Epic/GOG) | Not started |
| **AB** | Library installed/running badges | Not started |
| **AC** | Per-game Trainer Deck | Not started |
| **AD** | Stale / version health engine | Not started |
| **AE** | Process-detect quick attach | Not started |
| **AF** | Local demand + repair pipeline | Not started |
| **AG** | Adoption polish + smoke alignment | Not started |

Milestones **S, U, X, Z** remain as defined; AA–AF are the **WeMod adoption track** and do not replace them.

---

## 14. Approval checklist (before coding Phase AA)

- [ ] User approves milestone track AA–AG
- [ ] User approves new SQLite tables + migrations
- [ ] User approves read-only registry/VDF access (no writes outside project)
- [ ] Evidence pack path confirmed for adoption release tag

**Do not commit or tag until user says COMMIT IT / TAG IT.**

---

## 15. Related documents

- `ROADMAP.md` — milestone status
- `Docs/SOLITH_UI_HIERARCHY.md` — banner vs sidebar rules
- `Docs/BinaryFormats/RESEARCH_INDEX.md` — binary wave 1 order
- `Docs/Reports/RELEASE_EVIDENCE_PACK_PROPOSAL.md` — release gating
- `AGENTS.md` — safety boundaries (authoritative)
