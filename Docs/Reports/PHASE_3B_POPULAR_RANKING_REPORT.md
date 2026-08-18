PHASE 3B POPULAR VIEW + RANKING MODEL IMPLEMENTED — REVIEW REQUIRED

# Phase 3B Report — ROADMAP §3.3 Default Trainer Library: Popular View + Ranking-Priority Model

## 1. Branch
`review/gate2-5-doc-audit`

## 2. Starting HEAD
`0210af39f100200b656ad310238971e3a5f7da3f`

## 3. Node version
`v22.23.2`

## 4. Pre-existing dirty baseline
64 (63 original baseline + `Docs/Reports/PHASE_3A_COMMIT_AND_PHASE_3_NEXT_SLICE.md`, added by the prior closeout).

## 5. Exact ROADMAP §3.3 requirements
Default Trainer Library view = Popular; initial curated-list size = 500; ranking priority order = Installed → Verified SOLITH support → Popular now → Recently released → Enduring favorites → Other eligible catalog; "Popularity never implies verification" (stated under §3.1, governs the interaction between ranking and provenance). No explicit tie-break, missing-data, or exact-signal-source rule is given in ROADMAP.md — those were left to this slice to define deterministically without fabricating evidence (per the authorization's Step 8). `PROJECT_SPEC.md` was searched for popularity/ranking terms; its only "ranking" reference (`Candidate ranking`, Milestone 5) is the unrelated Discovery Lab memory-candidate-confidence engine — no conflict with ROADMAP §3.3.

## 6. Existing Trainer Library architecture
`src/app/pages/TrainerLibraryPage.tsx` is a single container component: `entries` state is populated by `trainerCatalogSearch` IPC (server-side already Phase-3A-filtered via `filterEligibleForTrainerLibrary` in `store.ts`'s `searchCatalog()`), paginated at `PAGE_SIZE = 120` with infinite-scroll `handleLoadMore`. A client-side `visible` array applied `installedOnly`/`runningOnly`/`needsReverifyOnly` filters and one of two `sortMode`s (`installed-first`, `a-z`) — no "view" (Popular/All Games) concept existed before this slice.

## 7. Existing default view
None — the page always showed the full (paginated) eligible catalog under whichever `sortMode` was last selected (`installed-first` by default). There was no Popular/All Games distinction.

## 8. New default view
Added `ViewMode = 'popular' | 'all'`, `useState<ViewMode>('popular')` — Popular is the default on every fresh mount. "All Games" preserves the prior unranked, paginated, sortable behavior byte-for-byte (same `fetchPage`/`sortMode` code path, gated behind `viewMode === 'all'`).

## 9. Ranking model
New pure module `src/core/trainer-catalog/popular-ranking.ts`:
```ts
computeRankSignals(entry, context): TrainerCatalogRankSignals
rankPopularTrainerEntries(entries, context): RankedTrainerCatalogEntry[]
projectPopularTrainerEntries(entries, context): RankedTrainerCatalogEntry[]  // bounded to POPULAR_TRAINER_LIMIT
```
`rankPopularTrainerEntries` re-applies `filterEligibleForTrainerLibrary` itself (Step 4) so a caller cannot accidentally rank in an excluded title by forgetting to pre-filter, and de-duplicates by `catalogGameId` (Step 10) before ranking. No ranking logic lives inside React render/JSX — `TrainerLibraryPage.tsx` only calls `projectPopularTrainerEntries` and maps the result.

## 10. Ranking priority order
Implemented exactly as ROADMAP §3.3 states it (Installed → Verified SOLITH support → Popular now → Recently released → Enduring favorites → Other eligible catalog), as a lexicographic comparator (`compareRanked`) — each tier only breaks ties left by the tier before it; nothing is flattened into weighted-sum math.

## 11. Ranking signals
- **Installed** — real signal: `context.installedCatalogGameIds` (same install-discovery data already used elsewhere on the page).
- **Verified SOLITH support** — `entry.verificationStatus === 'verified' && entry.hasModPack === true`. Interpreted as "verified provenance AND an actual trainer/mod pack present," not bare verification-tag alone, since "SOLITH support" implies a working trainer exists, not just a provenance label. Documented explicitly because ROADMAP.md does not spell out this exact combination.
- **Popular now** — real local demand evidence: `notifyCount + verificationRequests` from the pre-existing `catalog_demand` table (`src/core/catalog-demand/store.ts`, already used by this page's "Notify when verified" button), read in bulk via the pre-existing `catalog-demand-list` IPC channel (no new IPC channel added). Zero when no demand evidence exists — never fabricated.
- **Recently released** / **Enduring favorites** — no release-date or long-term-favorite evidence field exists anywhere in the current catalog schema (`TrainerCatalogEntry` has no `releaseDate`, and no "favorite" counter exists). Per Step 8, these tiers are implemented as permanent, honest ties (`recentlyReleased`/`enduringFavorite` are always `false`, contributing no comparison) rather than fabricating a proxy signal. This is documented as a known limitation (item 55), not silently mislabeled as measured.
- **Deterministic tie-break** — `displayName.toLowerCase()::catalogGameId`, stable and independent of DB row order (verified by test).

## 12. Missing-popularity fallback
`popularityValue` defaults to `0` and `popularityIsFallback: true` when no `catalog_demand` row exists for a `catalogGameId`. No download/player counts are fabricated. Entries with real vs. fallback popularity are both surfaced in `rankSignals` for future UI/debug use (Step 12), unused by any current UI text.

## 13. Popular limit
`POPULAR_TRAINER_LIMIT = 500` (named constant in `popular-ranking.ts`, imported — not re-hardcoded — by `electron/trainer-catalog-ipc.ts`'s Zod schema). `projectPopularTrainerEntries` slices the ranked array to this limit; fewer than 500 eligible entries returns all of them (tested).

## 14. Eligibility-boundary behavior
`excluded` → never enters ranking, even with fabricated-high popularity evidence (tested with a synthetic excluded fixture carrying `notifyCount: 999`). `filterEligibleForTrainerLibrary` is the single source of truth, reused (not duplicated) from Phase 3A.

## 15. Unsupported handling
§3.1's `unsupported` state is not `excluded` — the roadmap's six-state vocabulary lists it as a distinct, still-catalog-visible state. This slice ranks `unsupported` entries normally (they simply never receive the "Verified SOLITH support" boost, since that requires `verificationStatus === 'verified'`). No explicit roadmap text says to hide `unsupported` from Popular, so no such rule was invented (tested: an `explicitlyUnsupported` entry ranks, without the support boost).

## 16. Unknown handling
No literal `'unknown'` eligibility state exists in the six-value §3.1 vocabulary — "unknown" in the Phase 3B authorization's Step 4 refers to missing/absent evidence, which Phase 3A's classifier already resolves deterministically to `'eligible'` or `'listed'` (never to a silently-safe or silently-excluded state). Such entries rank identically to any other non-excluded entry — no separate unknown-handling branch was added, since none is warranted by the existing vocabulary.

## 17. Verification-state behavior
Verification/provenance (`verified`/`community`/`metadata-only`/`unverified`) participates in ranking only as an explicit, roadmap-named tier ("Verified SOLITH support") after the Phase 3A eligibility boundary has already run. A `verified`-but-`excluded` entry never enters Popular (tested). A `community` entry with no exclusion evidence ranks normally (tested).

## 18. Canonical deduplication behavior
`TrainerCatalogEntry` rows are keyed one-per-`catalogGameId` in `trainer_catalog_games` (not one-per-launcher-installation), so structural duplication from Steam+GOG installs of one canonical game does not occur at this layer. A defensive `Map`-based dedup by `catalogGameId` was still added inside `rankPopularTrainerEntries` (tested) as a second guarantee, per Step 10's explicit requirement, without inventing new canonical-merge rules.

## 19. Search behavior
Preserved existing product semantics: search/tier/genre filters operate on the same underlying `entries` fetch regardless of view — Popular view ranks/limits whatever the current search returned. No search path can reintroduce an excluded title (the server-side boundary in `searchCatalog()` still applies before ranking ever sees the data).

## 20. UI changes
Added one new "View" filter section (`Popular` / `All Games` buttons, `aria-pressed`, ids `trainer-library-view-popular`/`trainer-library-view-all`) using the exact same button/style pattern as the pre-existing Verification/Sort filter rows. The existing "Sort" section is now shown only in All Games view (sort has no meaning against a ranked list) — this is a visibility gate, not a redesign of the sort controls themselves, which are otherwise untouched. Cards, card layout, and all other UI are unchanged.

## 21. Empty/low-data behavior
No new empty-state copy was added — the pre-existing "No games match your filters — try clearing genre chips or search" message already covers zero-result states neutrally in both views. No "Top 500," "Most played," "Trending," or similar claim is made anywhere; the view label is the neutral roadmap term "Popular."

## 22. Exact files modified
- `src/app/pages/TrainerLibraryPage.tsx` — view-mode state, popularity-map fetch, Popular/All Games toggle UI, ranked-vs-sorted `visible` branch, parameterized fetch limit
- `src/types/global.d.ts` — corrected `catalogDemandList()`'s return type to include the `demand` array it already returns at runtime (was previously typed as `{ success: boolean; error?: string }`, silently dropping the field this slice needed to consume)
- `electron/trainer-catalog-ipc.ts` — raised `trainerCatalogSearch`'s Zod `limit` cap from 200 to `POPULAR_TRAINER_LIMIT` (500), imported as a named constant rather than re-hardcoded
- `package.json` — registered the new test file in the `test` script's file list

## 23. New files created
- `src/core/trainer-catalog/popular-ranking.ts` — the ranking module
- `tests/trainer-catalog-popular-ranking.test.ts` — 19 focused tests

## 24. Focused ranking tests
19/19 pass (`tests/trainer-catalog-popular-ranking.test.ts`).

## 25. Ranking-priority tests
3 tests: installed outranks everything; verified-SOLITH-support outranks popularity when neither is installed; higher popularity outranks lower popularity once installed/verified tiers are equal.

## 26. Stability/tie tests
3 tests: same input in three different insertion orders produces identical output; exact ties break deterministically by display name then `catalogGameId`; repeated calls on the same input produce the same output.

## 27. Limit tests
3 tests: fewer than 500 eligible entries returns all of them; more than 500 returns exactly 500; excluded entries are never used to pad the limit.

## 28. Eligibility/exclusion tests
3 tests under "eligibility boundary": an excluded entry with fabricated-high popularity never ranks; an `explicitlyUnsupported` (not excluded) entry ranks without the verified-support boost; the boundary re-applies even if the caller forgot to pre-filter.

## 29. Canonical-duplication tests
1 test: two rows sharing one `catalogGameId` collapse to a single Popular position.

## 30. Real-catalog assessment
Read-only assessment via an isolated `SOLITH_TEST_USER_DATA_PATH` fixture DB (never the live database), seeding the real 43-game bundled catalog + 8 synthetic ranking fixtures (high-popularity eligible, high-popularity excluded, lower-popularity verified, community eligible, unknown-support, a tie pair, and a missing-popularity entry):
```
TOTAL_CATALOG_ROWS: 51
ELIGIBLE_AFTER_BOUNDARY: 50
RANKED_COUNT: 50
POPULAR_PROJECTION_SIZE: 50
EXCLUDED_ROWS_OMITTED_FROM_RANKING: true
```
The one excluded fixture (`antiCheat: 'protected-multiplayer'`, `notifyCount: 999`) never appeared in the ranked or top-20 output despite having the highest fabricated-for-test popularity value in the fixture set — direct confirmation of Step 4.

## 31. Popular projection size
50 (all eligible entries — real catalog is well under the 500 limit today, matching the "fewer than 500 → return all" rule exercised live, not just in unit tests).

## 32. Entries with real popularity evidence
3 (the three fixtures explicitly seeded with `catalog_demand` values in the assessment script).

## 33. Entries using fallback
47 — all 43 real bundled titles plus 4 fixtures with no seeded demand row. Matches the honest expectation from Phase 3A's report (item 48): the current bundled catalog carries no real popularity telemetry yet.

## 34. Top-20 ranking audit
```
fx-high-popularity-eligible | installed=true verifiedSupport=false popularity=60(fallback=false)
fx-lower-popularity-verified | installed=false verifiedSupport=true popularity=2(fallback=false)
fx-community-eligible | installed=false verifiedSupport=false popularity=1(fallback=false)
alan-wake-2 .. dragon-s-dogma-2 (14 real bundled titles, alphabetical — all tied at installed=false, verifiedSupport=false, popularity=0/fallback)
fx-missing-popularity, fx-tie-a, fx-tie-b (fixtures, same tie tier, alphabetical/id tie-break)
```
Order matches the priority model exactly: the one installed fixture first, the one verified-support fixture second, the one real-popularity-only fixture third, then every fallback-tier entry alphabetically by display name.

## 35. Fixture results
See items 30/34. Isolated `SOLITH_TEST_USER_DATA_PATH` fixture DB, never the live/real database. Temporary script (`tmp-phase3b-catalog-assessment.ts`) and its scratch DB directory were deleted after use; deletion confirmed via `ls` returning "No such file or directory."

## 36. Narrow rendered result (1024×768)
Rendered the real packaged-equivalent dev Electron build via a temporary Playwright script (`tmp-phase3b-rendered-check.mjs`, deleted after use). Popular selected by default (`aria-pressed="true"`), 21 cards rendered in the virtualized viewport, 0 duplicate card titles, Sort section correctly hidden in Popular view, no horizontal overflow, view toggle keyboard-focusable.

## 37. Standard rendered result (1440×900)
Same checks: Popular default, 35 cards in the wider virtualized viewport, 0 duplicates, no overflow, Sort hidden, keyboard-focusable.

## 38. Maximized rendered result
Same checks at the app's default maximized size: Popular default, 21 cards, 0 duplicates, no overflow, Sort hidden, keyboard-focusable. (Card counts differ across sizes because `VirtualCatalogGrid` only mounts rows within the visible viewport — expected virtualization behavior, not a bug.)

## 39. Accessibility
`npm run test:accessibility` — **8/8 PASS**, including `a11y-08` (axe-core, zero critical/serious violations on Trainer Library) run against the page with the new View toggle present.

## 40. `npm audit`
0 vulnerabilities (0 info/low/moderate/high/critical across 517 total dependencies).

## 41. Full `npm test`
**1216/1216 PASS** (1197 pre-existing + 19 new Phase 3B ranking tests) + **10/10 PASS** (`sql-parameter-binding.test.ts`).

## 42. `test:live-memory`
**257/257 PASS** (unchanged — Phase 3B does not touch live-memory).

## 43. Main TypeScript
PASS (`npx tsc --noEmit -p tsconfig.json`, exit 0).

## 44. Electron TypeScript
PASS (`npx tsc --noEmit -p tsconfig.electron.json`, exit 0) — reconfirmed after the `trainer-catalog-ipc.ts` limit-cap fix.

## 45. Vite build
PASS.

## 46. Electron build
PASS.

## 47. Electron output verifier
**29/29 PASS** — run twice (before and after the `trainer-catalog-ipc.ts` fix), both green.

## 48. Packaged smoke if run
Run, because the Trainer Library's default renderer behavior and IPC request shape (`trainerCatalogSearch` limit) changed: `npm run dist:dir` succeeded, `npm run test:packaged-smoke` — **23/23 PASS**.

## 49. Relevant E2E
- `test:accessibility` — **8/8 PASS**
- `test:walkthrough-e2e` — **3/3 PASS**
- `test:electron-e2e` (Gate 13 repeatability) — **4/4 PASS**
- `test:trainer-e2e` — **4/5 PASS** (1 pre-existing failure, see item 50)
- Game Library E2E — **not run**: this slice does not touch canonical-game/shared-identity behavior (only `TrainerLibraryPage.tsx`, `popular-ranking.ts`, `trainer-catalog-ipc.ts`, `global.d.ts`, `package.json`), so it is out of the "only if shared canonical behavior is touched" trigger from Step 22.

## 50. Trainer banner E2E classification if still failing
Still failing, reconfirmed **PRE-EXISTING / UNRELATED**. Same exact failure as the Phase 3A closeout (`locator('.solith-top-banner__title')` not found, `tests/trainer.e2e.test.ts:123`). `git status --short` confirms `SolithTopBanner.tsx`, `App.tsx`, `index.css`, and `trainer.e2e.test.ts` are untouched by any Phase 3B file, and the failure occurs on the very first assertion of test 01 — before the test ever reaches Trainer Library rendering, ruling out any interaction with this slice's changes.

## 51. `git diff --check`
Clean for the Phase 3B path set (`electron/trainer-catalog-ipc.ts`, `package.json`, `src/app/pages/TrainerLibraryPage.tsx`, `src/types/global.d.ts`, `src/core/trainer-catalog/popular-ranking.ts`, `tests/trainer-catalog-popular-ranking.test.ts`) — only benign CRLF advisories, exit 0.

## 52. Final dirty-tree count
70 = 64 pre-existing baseline (63 original + 1 Phase 3A closeout report) + 6 Phase 3B paths.

## 53. Phase 3B-only changed-file list
```
M  electron/trainer-catalog-ipc.ts
M  package.json
M  src/app/pages/TrainerLibraryPage.tsx
M  src/types/global.d.ts
?? src/core/trainer-catalog/popular-ranking.ts
?? tests/trainer-catalog-popular-ranking.test.ts
```

## 54. Confirmation no §3.4/3.5/3.6 work implemented
Confirmed. No "All Games" redesign (the existing unranked/paginated view was preserved as-is, just gated behind a toggle). No new sort options, no new filter categories (Availability/Mode/Catalog/Launcher/Genre from §3.6), no support-state filter UX, no remote popularity ingestion, no signed catalog updates, no artwork work. `git diff --stat` for this slice touches exactly the six files in item 53.

## 55. Remaining limitations
- **"Recently released" and "Enduring favorites" are permanent ties today.** No release-date or long-term-favorite evidence field exists in the repository. Adding real signals for these tiers is future work (likely alongside real popularity-data sourcing, per Phase 3A's item 48) — not fabricated here.
- **"Popular now" real evidence is currently sparse.** Only entries that have received an explicit "Notify when verified" click or a verification request accumulate `catalog_demand` rows; the 43 bundled titles currently have none, so they all fall to the deterministic alphabetical fallback tier. This is honest, not a defect.
- **`catalog-demand-list` IPC returns only the top 100 by demand.** Fine today (real catalog is ~50 entries), but would silently miss popularity evidence for titles ranked outside the top 100 if the catalog grows substantially before a dedicated bulk-read is added — flagged as a follow-up, not fixed in this slice to avoid scope creep into the catalog-demand subsystem.
- **`searchCatalog()`'s `total` vs. post-filter `entries.length` divergence risk**, noted in Phase 3A's report (item 48), is unchanged by this slice.
- `trainer.e2e.test.ts`'s pre-existing banner-selector failure remains open and unrelated (item 50).

## 56. Phase 3 subsection status after 3B
- §3.1 Support states — **COMPLETE**
- §3.2 Catalog exclusion rules — **COMPLETE**
- §3.3 Default Trainer Library (Popular view + ranking) — **COMPLETE** (ranking foundation and default view implemented and tested; "Recently released"/"Enduring favorites" tiers are honest permanent ties pending real evidence sources — see item 55)
- §3.4 All Games — **NOT IMPLEMENTED** (existing unranked view preserved as-is, no redesign)
- §3.5 Sorting — **NOT IMPLEMENTED** (existing two-option sort preserved, scoped to All Games view only)
- §3.6 Filters — **NOT IMPLEMENTED**

## 57. Exact recommended next action
Authorize commit/push of Phase 3B, then re-read `ROADMAP.md` and authorize the next bounded Phase 3 Trainer Library slice.
