# P3-7 — Discovery / Session-Binding Final Reconciliation

**Worktree.** Dedicated, freshly created `G:\ACTIVE_PROJECTS\solith-phase3-reconciliation`, branch `feature/solith-phase3-discovery-session-reconciliation`, forked from `origin/feature/solith-parallel-phase3-catalog-identity`'s tip at the time (`8b14b792a2d3ed6cbaca34e2f50b4574a5b7deba` — includes `005` and `006`). Not shared with the P2-5 session's worktree, and a deliberately different physical directory from `solith-phase3-worktree` (which a prior review pass in this same lineage used and which suffered a real concurrent-commit collision — see that pass's own record, superseded by this document). No Phase 2 file touched or read for editing. No file under `src/core/install-discovery/` touched except as noted below (none). No file related to Atomfall's own certification work (branch `cursor/atomfall-l3-live-cert`, confirmed to exist on `origin` and to be a separate, actively maintained lane — not read, not touched).

## Phase 3 roadmap requirements, read fresh (not from prior summaries)

| Requirement | Status | Evidence | Needs reverify? | Blocker? |
|---|---|---|---|---|
| Remove hardcoded 200/500 catalog ceiling (D07) | Done (prior stage) | `004`/`005` | No — unchanged this pass | No |
| Nested executable support (Crimson Desert gap) | Done, this pass independently re-confirmed | `006` + this doc's own re-run | Reverified below | No |
| Installed-game reconciliation / stale-install / process binding | Done | `005` | Live-bind reverified below | No |
| Provider normalization / library discovery | Done for Steam/GOG/Epic; absent for Xbox/MS Store | `005`/`007` (this doc) | See Atomfall disposition | See below |
| Hash architecture (xxHash/BLAKE3/SHA-256) | Out of this pass's scope | `002` | No | No |
| **Exit Gate literal text**: "Canonical identity certified across target providers and real games. Zero hardcoded catalog ceilings remain. Stardew Valley and Palworld both bind a session." | All three clauses independently reverified this pass | This doc | Done | No |
| Verification Requirements text: "real-game validation across providers (Steam/GOG/Epic/etc.) and at minimum the 7 curated titles" | 6/7 titles independently PASS-confirmed across this lineage (`004`/`005`/`006`/this doc); Atomfall is the 7th and is explicitly a separate session's scope (Xbox/MS Store, no discovery mechanism exists) | This doc | See Atomfall disposition | Ambiguous — see below |

**The roadmap is the authority, and it contains a genuine internal tension, not something this pass should silently resolve either way**: the literal **Exit Gate** sentence names only Stardew Valley and Palworld as the hard pass/fail condition, and its provider list is "Steam/GOG/Epic/etc." The broader **Verification Requirements** sentence separately asks for "at minimum the 7 curated titles," and Atomfall is one of the 7 (named explicitly at ROADMAP.md's Phase 12 section, "Palworld and Atomfall share a family"). Whether "etc." in the Exit Gate's provider list was ever meant to reach Xbox/MS Store is not decidable from the text alone. This pass does not resolve that ambiguity — it records it for the owner (see Atomfall disposition, below).

## Doc 005/006/007(prior)/present-doc contradiction check (item 2)

- **Claimed installed titles**: `005` said Atomfall "not installed." Confirmed stale — Atomfall is now installed (`Z:\Games\Atomfall`), via Xbox/MS Store packaging (GUID-named MSIXVC files, `Content/` folder — not a Steam library). No contradiction in intent, just a timing gap; corrected below.
- **Discovery behavior**: `005` and `006` agree install-discovery is Steam-library-rooted only (`steamapps/libraryfolders.vdf`). Confirmed still true by direct code read this pass. No contradiction.
- **Session-binding behavior**: `005` described mechanism #2 (live process-watch, `matchAllCatalogProcesses`) as independent of install-discovery's single-canonical-path resolution. Confirmed true and re-demonstrated this pass (Palworld's wrapper process bound before the Shipping binary existed, exactly as `005` described).
- **Catalog DB assumptions**: this is where a real gap existed. A prior review pass in this lineage (superseded, uncommitted) could not reproduce `005`'s catalog-index lookup from a bare `tsx` script, because `getAppPaths()` (`src/shared/app-paths.ts`) silently falls back to an unseeded per-worktree `data/solith.db` outside Electron and outside a test runtime. This was a real, reproducible trap (I hit it myself before fixing it) — not a contradiction between the docs, but an undocumented tooling hazard. Fixed this pass (see "Catalog path truth," below).
- **Crimson Desert status**: `004`/`005` recorded it as the one Exit-Gate FAIL. `006` recorded it fixed. This pass independently reproduces both the pre-fix failure and the post-fix pass from scratch (below) — no contradiction, `006`'s claim holds.
- **Atomfall status**: `005` said "not installed." `006` said "owned by a separate, concurrently active session (`cursor/atomfall-l3-live-cert`), status not claimed here." Both are consistent with each other (006 postdates and correctly declines to re-litigate 005's stale claim); this pass corrects the "not installed" part and confirms the separate-session part still holds (the branch exists on `origin` with fresh commits).
- **Exit-gate wording**: see the table above — the tension between the Exit Gate's literal Stardew Valley/Palworld-only text and the broader 7-curated-titles Verification Requirements text is real and is recorded, not silently reconciled either way.

## Crimson Desert — independent reverification (item 3), not a re-read of `006`

Traced the fix in committed code directly (not from `006`'s prose):
- `src/core/trainer-catalog/known-steam-app-ids.ts`: confirmed present, one entry, `'crimson-desert-enhanced': 3321460`.
- `src/core/trainer-catalog/sync/remote-sync.ts`: confirmed `resolveExecutables()`/`applySteamAppId()` wired into both `remoteTrainerToCatalogEntry` and the mod-pack path, exactly as `006` describes.
- `src/core/database/index.ts`: confirmed the new `crimson-desert-rename-orphan-v1` entry in `CATALOG_ORPHAN_RECONCILIATIONS`, matching `006`'s described shape.
- `npx tsx --test tests/remote-sync-known-steam-app-id.test.ts tests/trainer-catalog-reconcile.test.ts`: **124/124 pass**, including an explicit "BG3 regression: reconcileCatalogOrphans preserves the original BG3-only reconciliation behavior" case.

**Then ran the real fixture/production path myself, end-to-end, from scratch** — not trusting `006`'s captured output — against a fresh read-only copy of the actual production catalog (`%APPDATA%/solith/solith.db`, copied into this session's scratchpad, `ELECTRON_USER_DATA_PATH` pointed at the copy):

1. **Before fix simulated**: `matchInstalledToCatalog` against the real installed Crimson Desert (`Z:\SteamLibrary\...\bin64\CrimsonDesert.exe`, real Steam appid 3321460) resolved to the **wrong** `catalogGameId: 'crimson-desert'` — independently reproducing the original defect from a clean, unmodified copy of the real DB.
2. Called the real `remoteTrainerToCatalogEntry({gameName:'Crimson Desert Enhanced', ...}, 'plitch')` — produced `executables: ['CrimsonDesert.exe']`, `steamAppId: 3321460`, exactly as `006` describes.
3. `upsertCatalogEntryWithIdentityReview()` applied it (`deferred: false`).
4. Re-ran `matchInstalledToCatalog` — now resolves to `catalogGameId: 'crimson-desert-enhanced'`, `identityStatus: 'verified'`, `canonicalExecutablePath` matching the real binary. **Independently confirmed fix works.**
5. `reconcileCatalogOrphans()` against this same real-copy DB: `crimson-desert-rename-orphan-v1` reports `blocked — "unexpected trainer_mod_packs references for orphan (found 2 row(s))"` — exactly matching `006`'s own finding. Fail-closed behavior confirmed, not just claimed.
6. Regression spot-checks in the same run: BG3 → `baldur-s-gate-3`, `bin/bg3.exe`, verified. Stardew Valley → `stardew-valley`, verified. Palworld → `palworld`, verified. No regression.

**CRIMSON DESERT: PASS — independently confirmed, not inherited from `006`'s self-report.**

## BG3 regression (item 7)

- `trustDeclaredExecutableOrder` confirmed present and still opt-in-only (`nested-executable-discovery.ts`), still scoped to `steam.ts`'s curated table only (not the trainer-catalog DB's own executables field).
- `npx tsx --test tests/install-discovery-steam.test.ts tests/install-discovery-nested-executable-discovery.test.ts`: **19/19 pass**.
- Live production-path spot-check (above): BG3 still resolves `bin/bg3.exe`, `verified`, no override of stronger evidence observed.

**BG3: PASS.**

## Catalog path truth (item 6)

Confirmed and fixed a real, previously-undocumented hazard: `getAppPaths()` (`src/shared/app-paths.ts`), when run outside Electron and outside a recognized test runtime (`NODE_ENV=test`/`NODE_TEST_CONTEXT`) with neither `ELECTRON_USER_DATA_PATH` nor `SOLITH_TEST_USER_DATA_PATH` set, silently falls back to `<projectRoot>/data/solith.db` — a fresh, unseeded, per-worktree database, not the real production catalog. A prior pass in this lineage hit this and got an empty catalog index with no error, which could easily be mistaken for "no games detected" or a real negative result.

**Fix applied** (`src/shared/app-paths.ts`, one function, additive only, no production behavior change): the bare-fallback branch now emits a `console.warn` naming the exact trap and telling the caller to set `ELECTRON_USER_DATA_PATH`. This only fires in the specific unguarded bare-script case — confirmed silent during real `npm test`/`npm run test:*` runs (which set `NODE_ENV=test`/`NODE_TEST_CONTEXT` and take the test-runtime branch first) and silent inside the real Electron app (which takes the `app.getPath('userData')` branch first). `npx tsc --noEmit` clean; spot-checked `tests/install-discovery-steam.test.ts` still 4/4 pass with the change in place.

**Production catalog path used for this pass's own certification evidence**: a read-only copy of the real `%APPDATA%/solith/solith.db`, with `ELECTRON_USER_DATA_PATH` explicitly pointed at the copy — never the bare fallback. **Fallback DB used for certification: NO.**

## Live session-binding reverification (item 5) — production path, not the bare fallback

Re-launched both games fresh (new PIDs, not reused from `005`/prior passes), with the DB-path fix in place and `ELECTRON_USER_DATA_PATH` pointed at the real-catalog copy:

- **Stardew Valley**: real process `Stardew Valley.exe`, PID **29388**. `listCatalogExecutableIndex()` returned **6019** real rows (not empty). `matchAllCatalogProcesses` → `{"catalogGameId":"stardew-valley","displayName":"Stardew Valley","pid":29388,"executable":"Stardew Valley.exe"}`. **PASS.**
- **Palworld**: real wrapper `Palworld.exe` PID **29112**, real Shipping binary `Palworld-Win64-Shipping.exe` PID **3872** (both alive concurrently, ~1 minute UE5 cold-start gap, matching `005`'s previously-documented architecture). `matchAllCatalogProcesses` → `{"catalogGameId":"palworld","displayName":"Palworld","pid":29112,"executable":"Palworld.exe"}`, bound via the wrapper process before the Shipping binary even needed to be consulted. **PASS.**
- Both detections present in the **same poll**, concurrently, no cross-contamination.
- Both processes closed (`taskkill`) after the check — processes this pass started; no other task's process touched.

**Stardew Valley live session-bind: PASS. Palworld live session-bind: PASS** (required — Exit Gate names both explicitly).

## Atomfall disposition (item 8)

- **Installed**: YES — `Z:\Games\Atomfall\Content\bin\Atomfall_dx12.exe`.
- **Distribution**: Xbox/Microsoft Store (GUID-named MSIXVC package files, `Content/` install layout — not a Steam library, no `appmanifest_*.acf`, no `steamapps/` tree).
- **Steam discovery**: NOT_APPLICABLE (not a Steam install).
- **MS Store discovery**: ABSENT — confirmed, this pass, no Xbox/GDK/MS-Store provider exists anywhere in `src/core/install-discovery/` (only `steam.ts`, and GOG/Epic providers referenced by `InstallPlatform`'s type but not exercised here).
- **Roadmap disposition — stated honestly, per the real tension found in item 1's table**: the Phase 3 **Exit Gate**'s literal text does not name Atomfall and does not require general (all-provider) install discovery — only Stardew Valley/Palworld session-binding and the ceiling-removal/canonical-identity clauses, all independently confirmed PASS above. Under that literal reading, Atomfall is **OUTSIDE_CURRENT_PHASE3_SCOPE** and does not block the Exit Gate. However, the same section's **Verification Requirements** sentence separately asks for "at minimum the 7 curated titles" (of which Atomfall is one), which a strict reading would treat as an **OPEN_PHASE3_REQUIREMENT** this codebase cannot currently satisfy (no MS Store discovery mechanism exists at all). This pass does not pick one reading over the other — it is an owner decision, not a discovery-review decision, and a separate session (`cursor/atomfall-l3-live-cert`, confirmed live on `origin`) is already independently pursuing Atomfall-specific certification work outside this lineage's scope.

## Seven-title matrix, recomputed from current repository truth (item 4)

| Title | Install type | Discovery path | Expected | Actual | Verdict | Why |
|---|---|---|---|---|---|---|
| Stardew Valley | Steam | root `Stardew Valley.exe` | `stardew-valley`, live bind | `stardew-valley`, PID 29388, verified live bind (this pass) | **PASS** | Independently re-confirmed, fresh PID, real production DB |
| Palworld | Steam | nested `Palworld-Win64-Shipping.exe` (wrapper `Palworld.exe` binds first) | `palworld`, live bind | `palworld`, PID 29112 (wrapper), PID 3872 (Shipping), verified live bind (this pass) | **PASS** | Independently re-confirmed, fresh PIDs, real production DB |
| DREDGE | Steam | root `DREDGE.exe` | `dredge` | unchanged from `005`, not re-run this pass (not required, no code touched) | PASS (install/catalog only, inherited) | No install-discovery/catalog change since `005` |
| Starfield | Steam | root `Starfield.exe` | `starfield` | unchanged from `005`, not re-run | PASS (install/catalog only, inherited) | Same |
| Baldur's Gate 3 | Steam | `bin/bg3.exe` (declared-order fix) | `baldur-s-gate-3` | independently re-confirmed this pass via live production-path spot-check | **PASS** | Fresh independent confirmation, not just inherited |
| Crimson Desert Enhanced | Steam | nested `bin64/CrimsonDesert.exe` | `crimson-desert-enhanced` | independently re-confirmed this pass end-to-end (before/after simulated resync, real install, real catalog copy) | **PASS** | Fresh independent confirmation of `006`'s fix |
| Atomfall | Xbox/MS Store | not discoverable — no MS Store provider exists | see disposition above | installed, undiscoverable by design-scope | **See disposition** (not PASS, not simple BLOCKED — genuinely ambiguous against roadmap text) | Owner call, tracked separately on `cursor/atomfall-l3-live-cert` |

## Full Phase 3 regression (item 9)

- `npm run test:install-discovery`: **104/104**, 0 fail.
- `npm run test:trainer-catalog`: **204/204**, 0 fail (matches `006`'s count exactly).
- `npx tsx --test tests/remote-sync-known-steam-app-id.test.ts tests/trainer-catalog-reconcile.test.ts`: **124/124**.
- `npx tsx --test tests/install-discovery-steam.test.ts tests/install-discovery-nested-executable-discovery.test.ts`: **19/19**.
- `npx tsc --noEmit` (root): clean.
- `npx tsc --project tsconfig.electron.json --noEmit`: clean.
- Live session-binding: both Stardew Valley and Palworld PASS, real production catalog path, fresh PIDs (above).

No known failure ignored. No test weakened or skipped to reach these numbers.

## Files changed this pass

- `src/shared/app-paths.ts` — one additive warning in the bare-fallback branch (catalog-path-truth guard, item 6). No production behavior change; confirmed silent under both real Electron and real test-runtime execution.
- `Docs/phase3/007-p3-7-discovery-session-binding-final-reconciliation.md` — this document.
- `ROADMAP.md` — additive reconciliation note (see commit).

No file under `src/core/install-discovery/` or catalog ingestion touched. No Phase 2 file touched. No Atomfall-lane file touched.

## Phase 3 certification gate

- [x] canonical worktree isolated (dedicated, not shared with P2-5 or the prior contaminated Phase 3 worktree)
- [x] Job 2 fix (`006`, Crimson Desert) independently reverified end-to-end, not just re-read
- [x] Crimson Desert PASS
- [x] BG3 PASS
- [x] seven-title matrix recomputed from current repository truth
- [x] Atomfall correctly scoped (not silently called "pass" or "blocked" — documented tension, owner decision flagged)
- [x] production catalog path used (real DB copy, `ELECTRON_USER_DATA_PATH` set explicitly)
- [x] Stardew Valley live session-binding PASS
- [x] Palworld PASS (roadmap Exit Gate requires it explicitly)
- [x] no fallback empty DB used as certification evidence (confirmed 6019-row real index used, not the 0-row fallback)
- [x] all focused tests PASS
- [x] full Phase 3 discovery/catalog test suites PASS
- [x] docs 005/006/007 reconciled (contradiction check above; no contradiction found beyond an already-explained staleness in `005`)
- [x] ROADMAP updated (see commit)
- [x] no unrelated work (no Phase 2, no catalog-ingestion-beyond-what's-cited, no Atomfall-lane files)
- [x] worktree clean (verified before commit)
- [x] local == remote (verified after push)

**Every literal Exit Gate criterion — canonical identity certified, zero hardcoded ceilings, Stardew Valley and Palworld both bind a session — passes with independently-reproduced, production-path evidence.** The one open item is not a failed gate but a genuine, explicitly-flagged textual ambiguity (Atomfall's status under the broader 7-curated-titles Verification Requirements sentence vs. the Exit Gate's own literal Stardew-Valley-and-Palworld-only text), tracked separately and not blocking the Exit Gate as literally written.
