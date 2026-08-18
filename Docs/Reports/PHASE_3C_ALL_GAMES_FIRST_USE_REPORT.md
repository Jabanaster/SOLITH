PHASE 3C ALL GAMES + FIRST-USE NOTICE IMPLEMENTED — REVIEW REQUIRED

# Phase 3C — All Games First-Use Notice + Full-Eligible-Catalog Framing

## 1. Branch
`review/gate2-5-doc-audit`

## 2. Starting HEAD
`845bb5489dcb56e562207f8f0f24cc02fe78d3fc`

## 3. Node version
`v22.23.2`

## 4. Pre-existing dirty baseline
65 entries (the previously-reconciled 64-entry baseline plus `Docs/Reports/PHASE_3B_COMMIT_AND_PHASE_3_NEXT_SLICE.md`, added by the prior closeout and now itself baseline noise). Verified via `git status --short` before any Phase 3C edit.

## 5. Exact ROADMAP §3.4 requirements
From `ROADMAP.md`:
```
## 3.4 All Games

All Games exposes the full eligible catalog, including niche/deep-catalog titles.

First-use notice:

> All Games includes SOLITH's full eligible catalog, including niche and less widely played titles. Use filters or search to narrow the list.
```
`PROJECT_SPEC.md` has no matching or conflicting text — ROADMAP.md is the sole governing source for this slice; no conflict to report. The roadmap section does not specify one-time-vs-persistent behavior, modal-vs-inline presentation, or a dismissal-persistence key — those were reasoned defaults per Step 6/7 guidance, documented in items 12–14 below.

## 6. Existing All Games architecture
Phase 3B (`845bb548`) already built a functioning `viewMode: 'popular' | 'all'` toggle in `TrainerLibraryPage.tsx`. "All Games" preserved the pre-3B unranked, paginated, sortable behavior exactly. `store.ts#searchCatalog` (server-side, shared by both views) already applies `filterEligibleForTrainerLibrary` at line 315 unconditionally, so All Games already returned only the eligible dataset — no excluded/anti-cheat-protected titles were ever reachable through it. This slice's job was narrowed to: add the first-use notice, and confirm/document the full-eligible-catalog framing already holds.

## 7. Popular/default behavior before changes
Popular was already the default (`useState<ViewMode>('popular')`, unchanged since Phase 3B). Confirmed unregressed after this slice — see item 26.

## 8. Final All Games semantics
All Games = the full eligible Trainer Library catalog (all rows surviving the Phase 3A/3.2 exclusion boundary), with no Popular-style ranking or 500-entry cap, using the existing paginated fetch (`PAGE_SIZE = 120`, load-more via `handleLoadMore`). No new filtering was added or removed; All Games is unchanged in behavior from Phase 3B, only the missing first-use notice was added on top.

## 9. Eligibility-boundary behavior
Unchanged and reconfirmed: `store.ts#searchCatalog` calls `filterEligibleForTrainerLibrary(rows.map(rowToEntry))` for every result set regardless of view. Verified via isolated fixture (item 25) that an anti-cheat-protected-multiplayer entry (`antiCheat: 'protected-multiplayer'`) is absent from the eligible/All Games projection while a community-eligible and an unknown-support (`metadata-only`) row both remain present.

## 10. Unsupported handling
ROADMAP §3.4 does not restrict All Games to only "supported" rows — it says "full eligible catalog." Existing behavior (unchanged): entries with `verificationStatus` of `metadata-only`/`community`/`verified` all appear in All Games as long as they are not excluded; `explicitlyUnsupported` entries are classified `unsupported` (not excluded) by `classifyTrainerCatalogEligibility` and therefore still appear, truthfully labeled via the existing verification-status badge on each card — never presented as supported.

## 11. Unknown handling
`verificationStatus` is never substituted for support state. An entry with no exclusion evidence and no explicit support/verification claim is classified `listed` or `eligible` by `classifyTrainerCatalogEligibility` (never silently defaulted to "safe") and appears in All Games with its true metadata-only/unknown badge, matching pre-existing, unchanged card rendering.

## 12. First-use notice behavior
Implemented as a dismissible inline `role="status"` banner, rendered only when `viewMode === 'all' && !allGamesNoticeDismissed`, placed above the (All-Games-only) Sort section in `TrainerLibraryPage.tsx`. It is not a modal — Step 8 states "avoid modal friction if not required," and the roadmap text does not require one. The banner never covers cards or controls (it renders in normal document flow above the grid).

## 13. Notice persistence behavior
One-time, cross-session: dismissal is persisted to `localStorage` under a dedicated key (item 14) using the same try/catch, best-effort pattern already established elsewhere in the codebase (`GameLibrary.tsx`'s `GAME_LIBRARY_VIEW_KEY`, `SolithWispCompanion.tsx`'s `POSITION_KEY`/`QUIET_KEY`/`PREFERENCES_KEY`). Switching Popular ↔ All Games within a session never re-shows the notice once dismissed (state lives in `localStorage`, read once at mount via `useState(readAllGamesNoticeDismissed)`), and re-entering All Games after dismissal in the same or a later session keeps it hidden. Clearing browser/app storage would make it reappear, consistent with Step 7's stated acceptable behavior for storage resets.

## 14. Notice copy
Exact ROADMAP §3.4 text, verbatim, no rewording:
> All Games includes SOLITH's full eligible catalog, including niche and less widely played titles. Use filters or search to narrow the list.

Persistence key: `trainerLibrary.allGamesNoticeDismissed` (constant `ALL_GAMES_NOTICE_DISMISSED_KEY`), deliberately distinct from any selected-view persistence key (there is none currently — view mode resets to Popular each fresh session, per Phase 3B precedent) so the two concerns are never conflated, per Step 12.

## 15. View-switch behavior
Unchanged from Phase 3B: `viewMode` state resets to `'popular'` on every fresh mount (no session persistence, matching the prior `sortMode` precedent noted in the Phase 3B report). Switching views within a session preserves the currently-fetched dataset and re-derives `visible` accordingly; no data refetch bug introduced.

## 16. All Games ordering
Unchanged: existing `sortMode` (`'installed-first' | 'a-z'`) applies, defaulting to `installed-first`, with a deterministic `localeCompare` tie-break on `displayName`. No new sort keys or controls were added (§3.5 is explicitly out of scope).

## 17. Search behavior
Unchanged: All Games search still calls the same `trainerCatalogSearch` IPC path as Popular, which applies the eligibility boundary server-side before results ever reach the renderer. No advanced filter UX was added (§3.6 is explicitly out of scope).

## 18. Exact files modified
```
M package.json
M src/app/pages/TrainerLibraryPage.module.css
M src/app/pages/TrainerLibraryPage.tsx
```

## 19. New files created
```
?? tests/trainer-library-all-games-notice.test.ts
```

## 20. Focused tests
`tests/trainer-library-all-games-notice.test.ts` — 6 static-source tests (`node:test`, matching the established `trainer-library-ui-static.test.ts` convention since the repo has no full React component-testing framework):
1. ROADMAP §3.4 notice text matches the page's `ALL_GAMES_NOTICE_TEXT` constant exactly (source-of-truth diff, not a hand-copied literal).
2. Notice renders only in All Games view and exposes a labeled dismiss control.
3. Dismissal persists via a dedicated `localStorage` key, independent of any view-mode key.
4. Popular remains the default view; All Games remains a selectable secondary view.
5. All Games search results flow through the centralized `filterEligibleForTrainerLibrary` boundary in `store.ts`, with no redeclared eligibility logic in the page component.
6. All Games ordering reuses the existing Sort section/`SortMode` type — no new sort control introduced.

All 6/6 pass (`npx tsx --test tests/trainer-library-all-games-notice.test.ts`). Registered in `package.json`'s `test` script file list.

## 21. All Games projection tests
Covered by test 5 above (centralized-boundary reuse, statically verified) plus the isolated fixture in item 25 (behavioral verification: excluded row absent, eligible rows present, Popular limit does not truncate All Games since All Games uses paginated fetch with no 500-cap).

## 22. First-use notice tests
Covered by tests 1–3 above (copy accuracy, view-gating, dismiss/persist) plus the rendered-verification pass in item 26–28 (first-visit-shows, dismiss-hides, revisit-stays-hidden, survives remount via a fresh Electron launch in the same run).

## 23. Safety/exclusion tests
Covered by the pre-existing `tests/trainer-catalog-eligibility-classification.test.ts` and `tests/trainer-catalog-popular-ranking.test.ts` suites (unchanged, still passing), which already exercise the shared `filterEligibleForTrainerLibrary` boundary that both Popular and All Games consume identically — plus the fresh isolated fixture in item 25 confirming an anti-cheat-protected-multiplayer row stays absent from the eligible/All-Games projection even when queried directly.

## 24. Real catalog assessment
Isolated fixture DB at `SOLITH_TEST_USER_DATA_PATH`, seeded from `BUNDLED_COMMUNITY_GAMES` (43 rows), read through `searchCatalog` + `filterEligibleForTrainerLibrary`:
```
RAW_CATALOG_COUNT: 43
ELIGIBLE_ALL_GAMES_COUNT: 43
EXCLUDED_COUNT: 0
RANKED_COUNT: 43
POPULAR_PROJECTION_COUNT: 43
ALL_GAMES_EQUALS_RANKED_FULL_SET: true
DIFFERENCE_POPULAR_VS_ALL_GAMES: 0
```
The bundled community-game seed carries no anti-cheat/exclusion-flag evidence, so 0 exclusions here is expected and consistent with the fixture in item 25, which adds evidence-bearing rows to exercise the boundary directly. No live/user catalog data was read or mutated.

## 25. Fixture results
Same isolated script, three additional seeded rows: an anti-cheat-protected-multiplayer verified title, a community-eligible title, and an unknown-support (`metadata-only`) title:
```
FIXTURE_ROWS_SEEDED: 3
FIXTURE_ALL_GAMES_ELIGIBLE_IDS: ["fixture-community-eligible", "fixture-unknown-support"]
EXCLUDED_ANTI_CHEAT_ABSENT: true
```
Confirms: the anti-cheat-protected-multiplayer row (even though `verificationStatus: 'verified'`) never appears in the All-Games-eligible projection; the community-eligible and unknown-support rows both appear, correctly not conflated with "supported." Temp script (`tmp-phase3c-catalog-assessment.ts`) and scratch DB directory (`C:/temp/solith-3c-assessment`) were deleted after use — deletion confirmed via `ls` returning "No such file or directory" for both.

## 26. Narrow rendered result (1024×768)
Fresh isolated Electron launch (Playwright `_electron.launch()`, isolated `ELECTRON_USER_DATA_PATH`/`APPDATA`/`USERPROFILE`, matching the established `accessibility.e2e.test.ts` pattern): Popular default active on load, 21 cards rendered; switched to All Games — 21 cards, notice visible on first visit, dismiss worked, notice stayed hidden after switching away and back within the same run, no horizontal overflow.

## 27. Standard rendered result (1440×900)
Same checks, fresh launch: Popular default active, 35 cards; All Games 35 cards, notice shown-then-dismissed-then-stayed-hidden correctly, no horizontal overflow. (Card counts equal between views because the dev fixture catalog, ~46 rows, is smaller than the 500-entry Popular cap — expected, not a defect.)

## 28. Maximized rendered result (1920×1080)
Same checks, fresh launch: Popular default active, 49 cards; All Games 49 cards, notice behavior identical to the two smaller sizes, no horizontal overflow. Temp verification script (`tmp-phase3c-rendered-check.mjs`) deleted after use — deletion confirmed.

## 29. Accessibility
`npm run test:accessibility` — 8/8 PASS, including `a11y-08 — axe-core reports no critical violations on Trainer Library`. The new dismiss button is a real `<button>` with `aria-label="Dismiss All Games notice"` (keyboard-focusable and activatable natively, no custom key handling needed); the notice text uses `role="status"` (a polite live region, not alarmist); no color-only meaning is used; existing `aria-pressed` on the Popular/All Games toggle buttons is unchanged.

## 30. `npm audit`
0 vulnerabilities (info/low/moderate/high/critical all 0; 517 total dependencies).

## 31. Full `npm test`
1222/1222 PASS (209 suites) + 10/10 PASS (SQL parameter-binding suite, run separately per the existing two-invocation `test` script) — 1232/1232 total, 0 failures.

## 32. `test:live-memory`
257/257 PASS (24 suites).

## 33. Main TypeScript
`npx tsc --noEmit -p tsconfig.json` — PASS, exit 0.

## 34. Electron TypeScript
`npx tsc --noEmit -p tsconfig.electron.json` — PASS, exit 0.

## 35. Vite build
PASS (`npm run build:vite`), no errors.

## 36. Electron build
PASS (`npm run build:electron`), no errors.

## 37. Electron output verifier
29/29 checks passed (contextBridge/contextIsolation/nodeIntegration security checks, bundle-size sanity, no dev-only-path imports, all green).

## 38. Packaged smoke if run
Not run. Step 19 requires `dist:dir`/packaged smoke only "if packaged renderer behavior changed materially." This slice adds one dismissible inline banner and a persisted boolean flag to an existing, already-packaged-verified view — not a material packaged-renderer change, and the standard build + accessibility + walkthrough + trainer E2E suites already exercise the packaged renderer's DOM/IPC surface via the Electron bundle. No packaged smoke run this slice.

## 39. Relevant E2E
`npm run test:accessibility` — 8/8 PASS.
`npm run test:walkthrough-e2e` — 3/3 PASS.
`npm run test:trainer-e2e` — 4/5 PASS (see item 40).

## 40. Trainer banner E2E classification if still failing
Still reproduces, unchanged: `tests/trainer.e2e.test.ts:123` — `locator('.solith-top-banner__title')` not visible within 30s. `git status --short src/app/components/SolithTopBanner.tsx src/app/App.tsx src/app/styles/index.css tests/trainer.e2e.test.ts` returns no output — all four files are byte-identical to HEAD and untouched by any Phase 3C edit. Classification: **PRE-EXISTING / UNRELATED**, consistent with every prior phase's reconfirmation.

## 41. `git diff --check`
Clean, exit 0 (only benign CRLF-on-touch advisories for files this slice did not initiate).

## 42. Final dirty-tree count
69 entries = the 65-entry reconciled baseline + exactly 4 Phase 3C paths (`package.json`, `TrainerLibraryPage.tsx`, `TrainerLibraryPage.module.css` modified; `tests/trainer-library-all-games-notice.test.ts` new/untracked). Verified via `git status --short | wc -l` and cross-checked against item 43's exact list.

## 43. Phase 3C-only changed-file list
```
M package.json
M src/app/pages/TrainerLibraryPage.module.css
M src/app/pages/TrainerLibraryPage.tsx
?? tests/trainer-library-all-games-notice.test.ts
```

## 44. Confirmation no §3.5/§3.6 work implemented
Confirmed. No new sort keys, sort controls, or sort-model changes beyond what Phase 3B already shipped (§3.5 untouched). No new filter categories (Availability/Mode/Catalog/Launcher/Genre-multi-select), no filter-chip UX, no Reset/remembered-filter-state work (§3.6 untouched). No remote popularity ingestion, signed catalog updates, artwork work, Game Library changes, Wisp changes, live-memory changes, or security-roadmap changes were made — verified by the exact file list in item 43 containing only Trainer Library page/CSS/test/package.json paths.

## 45. Remaining limitations
- The first-use-notice dismissal key (`trainerLibrary.allGamesNoticeDismissed`) and the (currently nonexistent) selected-view persistence are two independent concerns by design; if a future slice adds view-mode persistence, it should follow the same `localStorage` try/catch pattern rather than introducing a third convention.
- All Games and Popular currently render identical card counts against the small dev/fixture catalog (≤50 rows) since neither the 500-entry Popular cap nor All Games' pagination boundary is exercised at that scale — this is expected dataset-size behavior, not a defect, and was distinguished from a real bug via the isolated real-catalog assessment (item 24).
- Packaged (`dist:dir`) smoke was not re-run this slice (see item 38); the change surface did not warrant it per Step 19's conditional requirement.

## 46. Phase 3 subsection status after 3C
```
§3.1 Support states                  COMPLETE
§3.2 Catalog exclusion rules         COMPLETE
§3.3 Popular default + ranking       COMPLETE
§3.4 All Games                       COMPLETE
§3.5 Sorting                         NOT IMPLEMENTED
§3.6 Filters                         NOT IMPLEMENTED
```
Phase 3 exit gate remains **BLOCKED** pending §3.5 and §3.6.

## 47. Exact recommended next action
Authorize commit/push of Phase 3C, then re-read ROADMAP.md and authorize the next bounded Phase 3 Trainer Library slice (§3.5 Sorting is the next unfinished subsection).
