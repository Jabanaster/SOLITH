PHASE 3 §3.6 LAUNCHER SLICE (×8) IMPLEMENTED — UNCOMMITTED, VERIFICATION REPORT

# ROADMAP §3.6 — Launcher Slice Verification Report

## 1. Baseline branch/HEAD/dirty reconciliation
- Branch: `review/gate2-5-doc-audit`
- HEAD at start: `0f2cfa731b07260d64c0b7cb5597aa70f1527fc8` (unchanged — no commit made this pass)
- Pre-edit dirty count: 68 = 67 preserved baseline + 1 (`Docs/Reports/PHASE_3_6_19_VALUE_SLICE_COMMIT_AND_NEXT.md`, my own report from the prior turn, never staged). Confirmed via `git status --short` before touching anything; none of the 5 files this pass touches were already dirty.
- Post-implementation dirty count: 73 = 68 + 5 (the files listed in §9). Exact match.

## 2. Exact current §3.6 remaining-value list (post-slice)
- Owned (Availability) — BLOCKED
- Single-player, Offline co-op, Local multiplayer, Online features present, Offline-only support (Mode ×5) — BLOCKED
- All-time classic (Catalog) — BLOCKED / NEEDS OWNER DECISION

## 3. Owned — evidence/classification
No trustworthy ownership evidence source exists. Checked: `installed_games` (only proves installed, not owned), no launcher/library entitlement API integration, `ownershipStatus` in `src/core/canonical-games/render-model.ts` is still hard-coded `undefined` with the comment "no trustworthy ownership evidence source exists yet." No repository changes since `0f2cfa7` touch this. **BLOCKED**, unchanged from the prior reconciliation. Installed is not equated with Owned.

## 4. Mode ×5 — evidence/classification
Checked `AntiCheatStatus`, `catalogExclusionFlags`, `offlinePlayAvailable` — same fields as the prior reconciliation, no new fields added since `0f2cfa7`. None distinguish Single-player vs. Offline co-op vs. Local multiplayer; `offlinePlayAvailable` is a coarse boolean that cannot honestly stand in for "Offline-only support" (a title can have both online and offline modes and still read `true`), and exclusion flags only ever appear on entries already filtered out of the visible catalog. Per explicit instruction, did not infer from generic offlinePlayAvailable, anti-cheat flags, MMO/competitive exclusion flags, "Co-op"/"Multiplayer" text presence, or runtime state. **All 5 values BLOCKED.**

## 5. All-time classic — evidence/classification
Traced:
- Lifetime popularity: real signal exists (`listPositiveFeedbackCountsSorted`, wired to All-time popular).
- Release/age evidence: `releaseDate` column exists (added in §3.5) but is populated by nothing in the ingestion/sync path. Only one hard-coded `releaseDate` value exists anywhere in the repository (`src/core/cheat-system/games.ts:1828`, a single game-profile seed record unrelated to `trainer_catalog_games` ingestion) — confirmed via grep across `hub-sync.ts`, `community-sync-orchestrator.ts`, and the trainer-catalog module; none write `releaseDate`.
- Authoritative threshold: `ROADMAP.md` contains only the bare list entry `- All-time classic` (line 513) with no definition, no cutoff, no rule anywhere in ROADMAP or code.

Answers: (1) no — release/age signal is not meaningfully populated; (2) yes — lifetime popularity signal exists but alone cannot define "classic"; (3) no — no existing threshold/ranking rule. Per instruction, did not invent one, did not substitute `createdAt` for release age, did not define classic as "not popular now." **BLOCKED / NEEDS OWNER DECISION**, left unwired.

## 6. Exact Launcher semantics adopted
Owner-approved V1 definition applied: **Launcher filters mean the detected install platform for installed games only.** Uses `InstallPlatform` evidence from `installed_games` (via the existing `installDiscoveryList` IPC channel, `games[]`). Uninstalled catalog entries carry no launcher evidence and never match any Launcher filter — no storefront-availability inference, no `steamAppId`-based Steam inference (explicitly test-covered). OR within Launcher, AND across Launcher/Availability/Catalog/Genre.

## 7. All 8 Launcher enum/source mappings
| ROADMAP label | `InstallPlatform` value | Evidence source |
|---|---|---|
| Steam | `steam` | `installed_games.platform` |
| GOG | `gog` | `installed_games.platform` |
| Epic Games Store | `epic` | `installed_games.platform` |
| Ubisoft Connect | `ubisoft` | `installed_games.platform` |
| EA app | `ea` | `installed_games.platform` |
| Xbox / Microsoft Store | `xbox` | `installed_games.platform` |
| Battle.net | `battlenet` | `installed_games.platform` |
| Standalone | `manual` | `installed_games.platform` |

**Honest caveat found and reported, not silently fixed beyond the minimal necessary correction:** the current install-discovery **scanners** (`steam.ts`, `epic.ts`, `gog.ts`) and the `install-discovery-commit` IPC Zod schema (`z.enum(['steam','epic','gog','xbox','manual'])`) do not yet produce or accept `ubisoft`/`ea`/`battlenet` records — only the `InstallPlatform` type declares all 8. This means those 3 filters are mechanically correct and will never fabricate a match, but will honestly show 0 results until a scanner/commit path for those 3 platforms exists — the same "sparse but truthful" pattern already accepted for New release/Recently added in the committed 19-value slice. This gap was **not** touched (no new scanner, no schema change) — out of scope for a filter-composition task, and not required to make the filter mechanism itself correct.

## 8. Exact implementation scope
- Added `TrainerLibraryLauncherFilter` type (= `InstallPlatform`), `TRAINER_LIBRARY_LAUNCHER_FILTER_LABELS`, `matchesLauncher()`, and launcher composition (AND) in `filterTrainerLibraryEntries()`.
- Added `installedPlatformsByCatalogGameId` to `TrainerLibraryFilterContext`; `launcher` made optional on `TrainerLibraryFilterState` so the existing 19-value call/test sites remain unchanged.
- `TrainerLibraryPage.tsx`: added `launcherFilters` state, remembered-filter read/write (extended `RememberedTrainerLibraryFilters`), `installedPlatformsByCatalogGameId` state built from the existing `installDiscoveryList` IPC result via a new `buildInstalledPlatformsMap()` helper (both the mount effect and `refreshInstalledList` updated), `toggleLauncherFilter`, a new "Launcher" filter UI section (8 buttons, exact ROADMAP labels), Launcher folded into `hasDerivedFilters` (so the full bounded-page candidate fetch runs when Launcher is active, same as Availability/Catalog), `resetLibraryFilters`, and `activeFilterSummary`.
- `src/types/global.d.ts`: widened the `installDiscoveryList` result's `games[].platform` union from the stale 5-value type to the real 8-value `InstallPlatform` set (this was a pre-existing type/reality mismatch — the DB and `InstalledGameRecord` already supported 8 values; only this one read-back declaration was stale). Left the `installDiscoveryPreview`/`installDiscoveryCommit` 5-value unions untouched since those correctly reflect the actual scanner/schema restriction described in §7.
- No new schema, no new tables, no new IPC channels — the existing `installDiscoveryList` channel already returned `games[]` with `catalogGameId`+`platform`; it was simply not yet consumed for this purpose.

## 9. Exact files changed
```
M  src/core/trainer-catalog/all-games-filters.ts
M  src/app/pages/TrainerLibraryPage.tsx
M  src/types/global.d.ts
M  tests/trainer-catalog-all-games-filters.test.ts
M  tests/trainer-library-filters-ui.test.mjs
```
5 paths. No `package.json` change needed — both test files were already registered in the `test` script by the prior committed slice.

## 10. Tests written and TDD red/green evidence
Added an 11-test Launcher describe block to `tests/trainer-catalog-all-games-filters.test.ts` (all 8 platform values, uninstalled-never-matches, OR within Launcher, AND with Availability, AND with Catalog, AND-composability proof, empty-selection reset, fails-safe-with-no-context, Standalone→`manual` mapping, no-steamAppId-inference, and omitting `launcher` preserves prior 19-value behavior).

- **RED**: ran `npx tsx --test tests/trainer-catalog-all-games-filters.test.ts` before implementing `matchesLauncher`/labels — 5 of the 11 new subtests failed (`ERR_TEST_FAILURE`, `5 subtests failed`), 13 pre-existing passed.
- **GREEN**: after implementing `TrainerLibraryLauncherFilter`, `TRAINER_LIBRARY_LAUNCHER_FILTER_LABELS`, and `matchesLauncher()` — 18/18 pass.

Also extended `tests/trainer-library-filters-ui.test.mjs`: updated the deferred-value assertion to remove Ubisoft Connect/Battle.net (now legitimately wired) while keeping Owned/Mode ×5/All-time classic asserted absent; added assertions for all 8 Launcher labels present, no `entry.steamAppId` reference inside `matchesLauncher`, and Launcher state wired into the remembered-filter mechanism with Reset clearing it. One self-inflicted false-positive during authoring (a `steamAppId` regex matched my own doc comment, not code) was caught and fixed by narrowing the assertion to the `matchesLauncher` function body before proceeding — noted for transparency, not hidden.

## 11. Filter composition semantics
Unchanged pattern: OR within a category, AND across categories (Availability, Catalog, Launcher, Genre). Verified by dedicated AND-composition tests against Availability and Catalog independently, plus the existing Genre AND behavior (implemented upstream via the search `categories` parameter, untouched this pass).

## 12. Persistence/reset/back-navigation behavior
Launcher selections persist through the same `trainerLibrary.filters` sessionStorage mechanism as the 19-value slice (same key, extended shape, same malformed-value-filtering read guard). Reset clears Launcher alongside Availability/Catalog/Genre/Running/Needs-re-verify. No new back-navigation mechanism was introduced or required — Launcher reuses the identical state/effect wiring already governing the other derived filters, so its predictability is inherited, not separately implemented.

## 13. Verification commands and exact results
- `npx tsc --noEmit -p tsconfig.json` — **PASS**, exit 0
- `npx tsc --noEmit -p tsconfig.electron.json` — **PASS**, exit 0
- `git diff --check` — clean, exit 0 (only pre-existing CRLF warnings on untouched baseline files)
- `npm test` — **1285/1285 PASS** + **10/10 PASS** (SQL parameter binding suite), 0 fail total
- `npm run test:live-memory` — **257/257 PASS**
- `npm run test:trainer-e2e` — 4/5 pass, 1 fail (see §14)

## 14. Trainer E2E result and fresh classification
Fresh run this pass (not inherited): 4/5 pass. Same failure as both prior closeouts — `expect(locator('.solith-top-banner__title')).toBeVisible()` timeout, `tests/trainer.e2e.test.ts:123`. Reconfirmed by intersection check, not assumed: `git status --short` on `SolithTopBanner.tsx`, `App.tsx`, `index.css`, `tests/trainer.e2e.test.ts` returned no output — none are dirty, none appear in this pass's 5-file diff. **PRE-EXISTING / UNRELATED**, freshly classified.

## 15. Verification not performed
- `npm run build:vite` / full Electron packaged build — not run (no packaging-relevant files changed; same judgment call as the 19-value slice, which also did not run a full packaged build).
- No new database/schema verification needed — no schema changed this pass.

## 16. Remaining §3.6 blocked/undecided values
- Owned — BLOCKED
- Mode ×5 (Single-player, Offline co-op, Local multiplayer, Online features present, Offline-only support) — BLOCKED
- All-time classic — BLOCKED / NEEDS OWNER DECISION

## 17. Final dirty-worktree reconciliation
73 = 68 (67 preserved baseline + 1 own prior-turn report) + 5 (this pass's files). No commit made — all 73 remain in the working tree exactly as produced.

## 18. New §3.6 completion count
**27/34.** Availability ×5 + Catalog ×4 + Genre ×10 + Launcher ×8 = 27. Remaining 7: Owned, Mode ×5, All-time classic.

## 19. Whether §3.6 can honestly be called complete
**No.** 7 of 34 ROADMAP-required filter values remain BLOCKED or NEEDS OWNER DECISION (Owned, all 5 Mode values, All-time classic). Per explicit instruction, §3.6 is not being called complete while any ROADMAP-required value remains blocked, undecided, or intentionally unwired.

## 20. Exact recommended next action
No code, schema, or evidence path currently exists to unblock Owned, Mode, or All-time classic without either (a) a new trustworthy ownership/entitlement data source, (b) new catalog-level mode-of-play metadata (none of which the ROADMAP or repository currently authorizes fabricating), or (c) an owner-supplied "classic" threshold definition backed by real populated release-age data. Recommended: hold §3.6 at 27/34, request owner input specifically on whether All-time classic should be deferred indefinitely or given an explicit age+popularity rule once `releaseDate` ingestion exists, and treat Owned/Mode as blocked pending a future evidence-source phase rather than continuing to re-trace them each pass. Once verification is reviewed and separately authorized, stage/commit/push exactly the 5 files in §9 (git actions were withheld this pass per Step 12).
