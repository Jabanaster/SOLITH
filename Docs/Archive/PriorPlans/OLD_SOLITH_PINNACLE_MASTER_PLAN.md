# Solith Pinnacle Master Plan

**Goal:** Make Solith the definitive local trainer platform — one-click cheats at scale, restart-stable definitions, expert freeform memory tools, and the safest save editor — without relying on third-party trainer branding or black-box binaries.

**Baseline:** Solith 2.0 (`master`, post JSON/INI write execution)  
**Horizon:** Milestones **R → Z** (estimated 6–12 months of focused engineering + live verification sessions)

---

## Offline-first execution order (no live game required)

Work that can ship without running target games or user input — **do these first**:

| Phase | Deliverables | Milestones |
|-------|--------------|------------|
| **A — Brand & schema** | Advanced Scan Mode naming, neutral catalog types, `certificationLevel` in schema.v1 | R, U (schema) |
| **B — Catalog factory** | CT import parser + IPC, drift quarantine, feedback store, promotion rules, verifier scripts | T, V, W (parser) |
| **C — Library & scan UX** | Paginated library, CT/YAML import buttons, pointer-scan UI, process-watch notification | T, W, Y (watch) |
| **D — Binary scaffold** | Format registry + detection stubs; no real-game binary writes yet | X (architecture) |
| **E — Docs & scripts** | `verify-game-definition.mjs`, `verify-pointer-path.mjs`, `certify-cheat.mjs`, managed-runtime strategy doc | T, U, Z (doc) |

**Blocked on live sessions** (do not fake evidence):

| Item | Why blocked |
|------|-------------|
| Connection baselines (Avowed, Dredge, Crimson Desert) | Requires solo play measurement |
| Restart-verify pointer paths for bundled games | Requires kill/relaunch ritual |
| L2–L4 certification on real cheats | Requires attach + in-game confirmation |
| Managed-runtime live memory (.NET/Mono) | KI-018 — spike only until proven |

**Reordered sprint stack:**

```
Sprint 1 (A+B):  Brand rename + CT import + quarantine + feedback/promotion + scripts
Sprint 2 (C):    Library pagination + pointer scan UI + process watch
Sprint 3 (D+E):  Binary registry scaffold + managed-runtime strategy doc
Sprint 4 (LIVE): Connection baselines + restart-verify 15 cheats  ← requires games
Sprint 5 (LIVE): Certification L3 runs on bundled cheats
Sprint 6 (scale): 50-game seed + 500 metadata pipeline
Sprint 7 (X):    Binary saves wave 1 (per-format research)
Ongoing (Z):     Managed runtime spike when scoped
```

---

## Executive summary

| Pillar | What “pinnacle” means | Primary milestones |
|--------|----------------------|-------------------|
| **Scale** | Thousands of games with verified or scan-assisted one-click cheats | R, S, T |
| **Stability** | Restart-stable pointer paths; no 30s re-scan every session | S, U |
| **Velocity** | Patch-day definition updates via verifier factory + community loop | T, V |
| **Expert depth** | Freeform scan mode + `.CT` import rivals any memory tool | W |
| **Save supremacy** | Structured binary saves + profile-linked paths | X |
| **Trust** | Per-build certification, ratings, offline definitions | V, U |
| **Polish** | Overlay, hotkeys, auto-launch, artwork at catalog scale | Y |
| **Platform pragmatism** | Connection baselines for Steam/Epic/Xbox solo play | S |

---

## Part 1 — How to accomplish each competitor gap

### 1. Thousands of games with one-click cheats

**Today:** 7 bundled verified titles + ~1000 metadata-only catalog entries from remote HTML sync.

**How to close the gap:**

1. **Tiered catalog model** (already partially in `verificationStatus`):
   - `metadata-only` — title, art, categories (current remote sync)
   - `community` — imported mod pack with `requiresDiscovery: true` cheats
   - `verified` — restart-certified pointer paths or save-field mappings

2. **Definition factory pipeline:**
   ```
   Remote listing / user YAML / CT import / Discovery export
              ↓
   schema.v1 draft (compiler in src/core/definitions/)
              ↓
   Automated verifier (headless or semi-auto — see Milestone U)
              ↓
   Promote to verified OR keep community + scan_required badge
   ```

3. **Bundled seed expansion:**
   - Script: `scripts/generate-trainer-catalog-seed.mjs` already exists
   - Add Steam AppID → executable name resolver (`steam-appid-lookup` table)
   - Batch-compile top 500 Steam single-player titles as `metadata-only` with correct cover art

4. **One-click UX for non-verified:**
   - Toggle still works: auto-scan workflow (`scan_unknown` in schema.v1)
   - UI badge: “Scan required first session” vs “Verified — instant”
   - Session cache (`cheat-toggle-store`) remembers confirmed address until process exit

5. **Files to extend:**
   - `src/core/trainer-catalog/store.ts` — bulk import, verification flags
   - `src/core/trainer-catalog/bundled-definition-seed.ts` — scale to N games
   - `src/core/definitions/compile.v1.ts` — batch compile
   - `src/app/pages/TrainerLibraryPage.tsx` — tier badges, launch funnel

**Success criteria:** 500+ catalog entries with mod packs; 50+ `verified`; any `community` title launchable in &lt;90s first session.

---

### 2. Restart-stable pointer paths

**Today:** `live-control-catalog.ts` has one restart-verified control (Atomfall). Bundled cheats use `scan_unknown` and session-local addresses.

**How to close the gap:**

1. **Pointer path as first-class data** (schema.v1 already has `MemoryFeatureResolutionV1.pointerChain` + `signature` AOB):
   ```typescript
   resolution: {
     moduleName: 'Game-Win64-Shipping.exe',
     baseOffset: '0x1959a28',
     pointerChain: [0x18, 0x2F4],
     signature: '48 8B 05 ? ? ? ?'  // fallback if offset drifts
   }
   ```

2. **Verification ritual** (document in `scripts/verify-pointer-path.mjs`):
   - Attach to running game
   - Resolve path → read value → matches on-screen
   - Kill game → relaunch (new PID, ASLR)
   - Resolve again → read → must match
   - Write safe test value → verify in-game → rollback
   - Record: executable hash prefix, game version, evidence string

3. **Runtime resolution order** (`feature-resolver.ts` / `aob-resolver.ts`):
   1. Try static `pointerChain` from definition
   2. On miss → try AOB `signature` → derive offset
   3. On miss → fall back to `scan_unknown` workflow
   4. On success → optionally persist to session cache

4. **Registry storage:**
   - Extend SQLite `trainer_catalog` payloadJson or new `verified_pointers` table
   - Key: `(catalogGameId, featureId, executableHashPrefix)`

5. **Files:**
   - `src/core/live-memory/pointer-resolver.ts`
   - `src/core/live-memory/feature-resolver.ts`
   - `src/core/definitions/schema.v1.ts`
   - `scripts/verify-pointer-path.mjs` (new)

**Success criteria:** All 7 bundled memory games have ≥3 restart-verified cheats each; second session attach uses pointer path in &lt;2s (no full scan).

---

### 3. Patch-day updates (update factory)

**Today:** `fingerprint-verify.ts` + `FingerprintDriftDialog.tsx` detect executable hash drift; no automated re-verification queue.

**How to close the gap:**

1. **Drift → quarantine workflow:**
   - On attach: `fingerprintBlocksAttach()` → modal (exists)
   - On quarantine: set all cheats for that definition to `status: needs_reverify`
   - Library shows “Patch detected — verification pending”

2. **Update factory (CI + local):**
   ```
   Game update detected (Steam API / local exe hash change)
              ↓
   Queue entry in definitions_update_queue.json
              ↓
   Operator runs: npm run verify:game -- --id palworld
              ↓
   For each cheat: pointer resolve → restart test → pass/fail
              ↓
   Auto-bump gameVersion in schema.v1; export YAML; recompile catalog
   ```

3. **Community velocity:**
   - Export drift report as YAML diff (“offset 0x1959a28 → broken”)
   - Import fixed YAML from community → run verifier → promote

4. **Files:**
   - `src/core/definitions/fingerprint-verify.ts`
   - `src/app/components/FingerprintDriftDialog.tsx`
   - `scripts/verify-game-definition.mjs` (new)
   - `.github/workflows/definition-verify.yml` (optional nightly on bundled games)

**Success criteria:** Game patch simulation (hash change) quarantines cheats within one attach; single command re-verifies and republishes definition.

---

### 4. Polish at scale (artwork, categories, “it just works”)

**How to close the gap:**

1. **Steam CDN artwork** — already in `games.ts` via `steamImages()`; extend to full catalog seed
2. **Category taxonomy** — normalize remote sync categories to fixed enum: Player, Combat, Currency, World, Stats, Misc
3. **Launch funnel:**
   - Library card → detect running exe → hybrid launch dialog (exists) → auto-select profile
   - “No mod pack” → offer Advanced Scan Mode or guided first-scan wizard
4. **Empty states** — per-tier copy in `TrainerLibraryPage.tsx`
5. **Performance** — virtualized grid for 1000+ cards (`react-window` or paginate at 48 with infinite scroll)

**Files:** `TrainerLibraryPage.tsx`, `LibraryLaunchDialog.tsx`, `bundled-definition-seed.ts`, CSS modules

**Success criteria:** Search “Elden” → art + category + clear badge + launch path in one screen; scroll 1000 entries at 60fps.

---

### 5. Community trust loop

**How to close the gap:**

1. **Local ratings** (no cloud required):
   ```sql
   CREATE TABLE definition_feedback (
     catalogGameId TEXT,
     featureId TEXT,
     executableHashPrefix TEXT,
     rating INTEGER,  -- -1 fail, 0 untested, 1 works
     note TEXT,
     recordedAt TEXT
   );
   ```

2. **“Works on my version”** — store `executableHashPrefix` + `gameVersion` with each positive rating

3. **UI:** After successful write/freeze, prompt “Mark cheat as working?” (optional, dismissible)

4. **Promotion rule:** 3+ local positive ratings + verifier pass → eligible for `verified` export in shared YAML packs

5. **Fast iteration:** YAML import already exists; add `npm run export:community-pack` for sharing definition bundles offline

**Files:** new `src/core/trainer-catalog/feedback-store.ts`, IPC in `electron/trainer-catalog-ipc.ts`

**Success criteria:** User can rate cheats; Library shows “Community confirmed (N)” vs “Verified (Solith)”.

---

### 6. Arbitrary process + address + script power

**Today:** `v2FreeformMemoryEnabled` + Advanced Scan Mode (`LiveMemoryTrainerPage.tsx`) — attach, address entry, scan, freeze.

**How to close the gap:**

1. Rename UI to **Advanced Scan Mode** (brand-neutral; done in Milestone R)
2. **Expand capabilities:**
   - Memory region list (VirtualQueryEx wrapper in memoryjs layer)
   - Bookmarked address list (persist per game in SQLite)
   - Watch list with freeze per row (extend `LiveWatchPanel.tsx`)
3. **Sandboxed scripts** (Milestone W2):
   - Lua subset OR JSON “recipe scripts” (read → compare → write)
   - No `os.execute`, no DLL load — AST whitelist
4. **Settings:** `v2FreeformMemoryEnabled` remains off-by-default for casual users

**Files:** `LiveMemoryTrainerPage.tsx`, `live-memory-session.ts`, new `src/core/live-memory/script-runner.ts`

**Success criteria:** Power user can attach to any exe, scan, freeze, bookmark — without enabling bundled one-click cheats.

---

### 7. Pointer scan / dissect / debugger / speedhack

**How to close the gap:**

| CE feature | Solith approach | Milestone |
|------------|-----------------|-----------|
| First/next scan | `memory-scanner.ts` — exists | polish W1 |
| Pointer scan | `pointer-scanner.ts` — exists; expose in UI | W1 |
| Dissect data structures | Hex + type guess panel next to watch list | W2 |
| Debugger | **Out of scope** — no breakpoints (anti-cheat risk, complexity) | — |
| Speedhack | Timer hook via `QueryPerformanceCounter` patch — scoped, optional | W3 |

**UI work:** Add “Pointer scan” tab in Advanced Scan Mode wired to `scanForPointerPath()` with progress bar and candidate list (like existing narrowing UI in `GameSpecificCheatMenu`).

**Success criteria:** User discovers pointer path in UI and exports to schema.v1 YAML.

---

### 8. `.CT` ecosystem import

**How to close the gap:**

1. **Parser** (`src/core/definitions/ct-import.ts`):
   - Parse XML CheatTable 6.x/7.x subset: `CheatEntry`, `Address`, `Offsets`, `VariableType`
   - Map `VariableType` → `MemoryDataType`
   - Reject: `AutoAssembler`, `LuaScript`, `CreateThread` (code execution)

2. **Import flow:**
   ```
   User selects .CT file
        ↓
   Parse → schema.v1 draft
        ↓
   Review screen (list cheats, flag unsupported entries)
        ↓
   Save to catalog as community / queue for verifier
   ```

3. **Export (later):** schema.v1 → minimal .CT for interoperability

**Files:** new `ct-import.ts`, `tests/ct-import.test.ts`, UI in `TrainerLibraryPage` import menu

**Success criteria:** Import popular .CT table → ≥80% of memory entries become catalog cheats (code entries clearly marked unsupported).

---

### 9. Managed runtime games (.NET/Mono — KI-018)

**How to close the gap:**

**Strategy A — Save-first (Stardew now):**  
Ship save-field controls as primary; market as “safe farm editor” — **already done**.

**Strategy B — Mono/CLR roots (if live memory required):**
1. Detect `mono.dll` / `coreclr.dll` in process module list
2. Use documented Mono embedding APIs OR pattern-scan for GC handle tables (research spike)
3. Separate `ManagedRuntimeResolver` — never mix with native `pointer-scanner.ts` results
4. Document: “Managed games = experimental” until restart-verified

**Strategy C — Console commands (Stardew SMAPI):**  
Executor that writes to SMAPI console pipe or simulates `debug` commands with user approval — separate from memory.

**Recommendation:** **A + C for Stardew**; **B as R&D milestone Z** with no marketing claim until verified.

**Files:** new `src/core/live-memory/managed-runtime-resolver.ts` (spike), `GameSpecificCheatMenu` console wiring

---

### 10. Binary / proprietary save formats at scale

**How to close the gap:**

1. **Format registry** (`src/core/saves/binary-formats/`):
   - Per-game profile: magic bytes, endianness, field map (offset + type)
   - Read-only parse first; write only with struct-level patch (no blind blob edit)

2. **Top 20 targets** (prioritize bundled games + Steam top sellers):
   - Unreal `.sav` (UE save game summary — read header, known offsets)
   - Unity `PlayerPrefs` / `save.dat` patterns
   - Custom JSON-in-binary wrappers

3. **Discovery integration:** byte-diff two saves → propose field map → human review → compile to `SaveFieldFeatureV1` with `format: binary`

4. **Safety:** Same propose → approve → backup → patch → verify workflow; reject if checksum field detected (`save-format.ts` security words)

**Files:** extend `save-format.ts`, new binary adapters mirroring `xml`/`json`/`ini`

**Success criteria:** 5 binary formats with executable field writes and fixture tests.

---

### 11. Steam/Epic/Xbox background networking (KI-017)

**How to close the gap:**

1. **Measure baselines** for each bundled title:
   ```powershell
   # While game in solo offline play:
   Get-NetTCPConnection -OwningProcess $pid -State Established |
     Where-Object { $_.RemoteAddress -notmatch '^(127\.|::1)' }
   ```
2. Record in `game-connection-baselines.ts` with evidence string
3. **Pending:** `Avowed.exe`, `Dredge.exe`, `CrimsonDesert.exe`
4. **Optional tier 2:** ASN allowlist for known platform CDN (higher risk — separate setting `v2PlatformBaselineMode: strict | measured | permissive`)

**Automation:** `scripts/measure-connection-baseline.mjs` — attach pid, count connections, output JSON for copy into baselines file

**Success criteria:** All 7 bundled games have measured baselines; solo Steam play attaches without false blocks.

---

### 12. Real-game verification at scale

**How to close the gap:**

1. **Certification levels** (embed in schema.v1):
   - `L0` — unit test only
   - `L1` — fixture/integration test
   - `L2` — single live session verified (human)
   - `L3` — restart verified (kill + relaunch)
   - `L4` — freeze verified (10 min + guard recheck)

2. **Harness:** `scripts/certify-cheat.mjs --game palworld --cheat infinite-stamina --level L3`

3. **CI truth:** CI runs L0–L1 only; L2–L4 recorded in `Docs/Certification/` per release

4. **Bundled requirement:** All `verified` catalog cheats must be ≥ L3 before ship

**Success criteria:** Release evidence pack lists L3 count per bundled game; zero `verified` cheats at L0 only.

---

## Part 2 — Priority stack (your 8 items mapped)

| # | Item | Milestone | Depends on |
|---|------|-----------|------------|
| 1 | Restart verifier + pointer registry (7→50→500) | **S, U** | Live game sessions |
| 2 | Connection baselines (remaining 3) | **S** | Live game sessions |
| 3 | `.CT` import + schema.v1 promotion | **W, T** | ct-import parser |
| 4 | Real-game freeze/write certification | **U** | S, baselines |
| 5 | Managed-runtime strategy | **Z** | R&D spike |
| 6 | Overlay/hotkey polish + auto-launch | **Y** | — |
| 7 | Binary save profiles (top 20) | **X** | per-format research |
| 8 | Brand-neutral terminology | **R** | — |

---

## Part 3 — Implementation milestones (R → Z)

### Milestone R — Brand neutrality & terminology (1 week)
- [x] Remove third-party trainer names from UI, types, comments, user-facing docs
- [x] **Advanced Scan Mode** replaces legacy “CE mode” labeling
- [x] Remote sync sources: neutral display names; URLs remain technical config only
- [x] `CheatSource` enum → `Community Catalog`, `Remote Listing`, etc.
- [x] Rename `Docs/WEMOD_EQUIVALENT_TRAINER.md` → `Docs/SOLITH_LIVE_TRAINER_PARITY.md`
- [x] Update `ROADMAP.md` post-2.0 section

**Exit:** Grep for competitor brands in `src/` and `src/app/` returns zero user-facing hits.

---

### Milestone S — Connection baselines + pointer registry foundation (2–3 weeks)
- [ ] `scripts/measure-connection-baseline.mjs`
- [ ] Live sessions: measure Avowed, Dredge, Crimson Desert
- [ ] Add baselines to `game-connection-baselines.ts`
- [ ] `scripts/verify-pointer-path.mjs` + docs
- [ ] Restart-verify Palworld + Undisputed top 3 cheats each
- [ ] Wire verified paths into `bundled-definition-seed.ts` (`resolution.pointerChain`)
- [ ] `feature-resolver.ts`: static path before scan

**Exit:** 7/7 games attach in solo Steam play; ≥15 restart-verified cheats total.

---

### Milestone T — Catalog scale & update factory (3–4 weeks)
- [x] Expand bundled seed to 50 games (metadata + art)
- [x] Remote sync quality: dedupe, normalize categories, executable guess from title
- [x] Drift quarantine workflow (auto `needs_reverify`)
- [x] `scripts/verify-game-definition.mjs`
- [x] Library virtualized grid + tier badges

**Exit:** 50 mod-pack games; drift quarantine demo on hash change.

---

### Milestone U — Certification harness (2–3 weeks)
- [ ] `certificationLevel` in schema.v1
- [ ] `scripts/certify-cheat.mjs` (L1–L4)
- [ ] Run L3 on all bundled verified cheats; document in `Docs/Certification/`
- [ ] Feedback store + post-success rating prompt

**Exit:** Bundled cheats all ≥ L3 documented; feedback API works offline.

---

### Milestone V — Community trust loop (2 weeks)
- [x] `definition_feedback` table + IPC
- [x] Library shows community confirmation counts
- [x] `export:community-pack` / import round-trip
- [x] Promotion rules: community → verified candidate
- [x] Post-success rating prompt in live trainer UI

**Exit:** Rate cheat → see count on Library card.

---

### Milestone W — Advanced Scan + `.CT` import (4–6 weeks)
- [x] W1: Pointer scan UI in Advanced Scan Mode
- [x] W2: `ct-import.ts` + import UI + tests (fixture .CT files)
- [x] W3: Watch list bookmarks + optional speedhack (scoped)
- [x] Export schema.v1 → YAML from pointer scan result

**Exit:** Import .CT → catalog cheats; discover pointer in UI → export YAML.

---

### Milestone X — Binary save profiles (6–8 weeks, parallelizable)
- [x] Binary format registry architecture
- [ ] 5 formats with read + write (game-specific) — **5 demo profiles; RFSA + SLTH/RSAV/BPKG/GDAT scaffolds**
- [x] Discovery byte-diff → field proposal pipeline
- [x] Integrate with TrainerHost save router (structured binary extensions)

**Exit:** 5 binary formats in support matrix as `executable`.

---

### Milestone Y — Polish & auto-launch (2–3 weeks)
- [x] Overlay layout presets per game
- [x] Hotkey rebind UI + conflict detection
- [x] Process watch: auto-prompt when known exe starts
- [x] Onboarding wizard (first-run)
- [x] Resolve KI-011 pagination / virtual scroll

**Exit:** Cold start → game detected → trainer ready in &lt;60s.

---

### Milestone Z — Managed runtime R&D (ongoing / optional)
- [ ] Spike: Mono module detection + root enumeration
- [ ] Decision doc: ship or permanently save-first for .NET games
- [ ] Stardew console executor (if scoped)

**Exit:** Documented strategy; no false “live memory works” claims.

---

## Part 4 — Suggested build order (sprints)

**Offline-first** (current execution track):

```
Sprint 1 (R+T+V+W parser): Brand rename + CT import + quarantine + feedback/promotion + verifier scripts
Sprint 2 (T+W+Y watch):     Library pagination + pointer scan UI + process watch
Sprint 3 (X+Z doc):         Binary registry scaffold + managed-runtime strategy
```

**Live verification** (requires running games):

```
Sprint 4 (S):       Connection baselines (3 remaining) + restart-verify 15 cheats
Sprint 5 (U):       L3 certification runs on bundled cheats
Sprint 6 (T scale): 50-game seed + drift quarantine demo on real patch
Sprint 7 (Y):       Overlay/hotkey polish
Sprint 8 (X):       Binary saves wave 1 (5 formats)
Ongoing (Z):        Managed runtime spike
```

---

## Part 5 — What we deliberately will not build

- DLL/kernel injection, anti-cheat bypass, stealth
- Online/multiplayer targeting
- Downloading or executing third-party trainer `.exe` binaries
- Cloud account requirement for core features
- Debugger breakpoints in live games (scope creep + risk)

---

## Part 6 — Release tags (proposed)

| Tag | Content |
|-----|---------|
| `v2.1-solith-brand-neutral` | Milestone R |
| `v2.2-solith-restart-stable` | Milestone S |
| `v2.3-solith-catalog-50` | Milestone T |
| `v2.4-solith-certified` | Milestone U |
| `v2.5-solith-advanced-scan-ct` | Milestone W |
| `v3.0-solith-pinnacle` | S+T+U+W+Y complete; X partial (≥5 binary) |

---

## Part 7 — Evidence & governance

Every `verified` promotion requires:
1. Entry in `game-connection-baselines.ts` (if live memory)
2. Restart verification log in `Docs/Certification/<game>/<cheat>.md`
3. schema.v1 YAML committed under `definitions/bundled/`
4. Test fixture or L1 harness proof
5. No competitor trademarks in user-facing strings

---

*This plan is the single source of truth for post-2.0 pinnacle work. Update `ROADMAP.md` when each milestone is accepted.*
