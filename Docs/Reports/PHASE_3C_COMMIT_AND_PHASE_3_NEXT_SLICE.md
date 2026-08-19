PHASE 3C COMMITTED AND PUSHED — NEXT PHASE 3 SLICE IDENTIFIED

# Phase 3C Commit/Push Closeout + Phase 3 Next Slice Selection

## 1. Branch
`review/gate2-5-doc-audit`

## 2. Starting HEAD
`845bb5489dcb56e562207f8f0f24cc02fe78d3fc`

## 3. Node version
`v22.23.2`

## 4. Pre-existing/non-Phase-3C dirty baseline
65 entries (the previously-reconciled 64-entry baseline plus `Docs/Reports/PHASE_3B_COMMIT_AND_PHASE_3_NEXT_SLICE.md`, added by the prior closeout and now itself baseline noise). Confirmed at Step 1 before staging: 70 dirty entries at start of this closeout = 65 baseline + 4 Phase 3C product/test paths + 1 Phase 3C report (`PHASE_3C_ALL_GAMES_FIRST_USE_REPORT.md`, written after the implementation authorization's own "69" snapshot was taken).

## 5. Exact Phase 3C path count
5

## 6. Exact Phase 3C paths
```
A  Docs/Reports/PHASE_3C_ALL_GAMES_FIRST_USE_REPORT.md
M  package.json
M  src/app/pages/TrainerLibraryPage.module.css
M  src/app/pages/TrainerLibraryPage.tsx
A  tests/trainer-library-all-games-notice.test.ts
```

## 7. Phase 3C report reviewed
`Docs/Reports/PHASE_3C_ALL_GAMES_FIRST_USE_REPORT.md` read in full (authored this session as the implementation record). Confirmed it records: exact §3.4 requirements, All Games full-eligible-catalog semantics, Popular-remains-default confirmation, the centralized exclusion boundary reuse, unsupported/unknown handling, first-use notice copy (verbatim ROADMAP text) and dismissal persistence, view-switch behavior, real-catalog counts, isolated fixture results, three-size rendered verification, accessibility results, full verification totals, and the pre-existing Trainer banner E2E classification. Used as the authoritative implementation record; not rewritten during this closeout.

## 8. Product invariant reconfirmation
Reconfirmed directly against source this closeout (not just the report):
- `useState<ViewMode>('popular')` — Popular remains the default (`src/app/pages/TrainerLibraryPage.tsx:371`).
- `store.ts:315` — `filterEligibleForTrainerLibrary(rows.map(rowToEntry))` applies unconditionally inside `searchCatalog`, so All Games uses the same Phase 3A eligible dataset as Popular; excluded entries cannot re-enter through All Games.
- `POPULAR_TRAINER_LIMIT` is only referenced when `view === 'popular'` (`TrainerLibraryPage.tsx:435`) — the All Games fetch path uses the unbounded paginated `PAGE_SIZE`, so the Popular cap never truncates All Games.
- Search calls the same `trainerCatalogSearch` IPC path for both views — no bypass of the exclusion boundary.
- `viewMode === 'all' && !allGamesNoticeDismissed` gates the notice — appears only when required.
- `ALL_GAMES_NOTICE_DISMISSED_KEY` dismissal write/read via `localStorage` — persists across sessions; distinct key from any view-mode state, so notice behavior is independent of catalog contents and of view switching within a session.
- `verificationStatus` is a separate axis from support/exclusion state throughout — `classifyTrainerCatalogEligibility` checks exclusion evidence first and independently of `verificationStatus`, so a `verified` title with anti-cheat-protected-multiplayer evidence is still excluded (reconfirmed by the Phase 3C isolated fixture: `fixture-excluded-anti-cheat` was `verified` and still absent from the eligible projection).

## 9. Trainer E2E failure classification
`PRE-EXISTING / UNRELATED`

## 10. Evidence supporting E2E classification
Reran `npm run test:trainer-e2e` this closeout: identical failure reproduced (`locator('.solith-top-banner__title')` not found, `tests/trainer.e2e.test.ts:123`), 4/5 passed — same as the Phase 3C implementation run and every prior phase closeout. `git status --short src/app/components/SolithTopBanner.tsx src/app/App.tsx src/app/styles/index.css tests/trainer.e2e.test.ts` returned no output — all four files remain untouched by Phase 3C.

## 11. Focused Phase 3C test result
6/6 PASS (`tests/trainer-library-all-games-notice.test.ts`, rerun directly via `npx tsx --test` this closeout).

## 12. Main TypeScript
PASS (`npx tsc --noEmit -p tsconfig.json`, exit 0).

## 13. Electron TypeScript
PASS (`npx tsc --noEmit -p tsconfig.electron.json`, exit 0).

## 14. `git diff --check`
Clean — exit 0. No code changed since the prior full green suite (implementation-authorization verification run), so the full 1222/257/E2E suites were not rerun for ceremony per Step 6 — only the focused Phase 3C tests, tsc (both configs), diff --check, and Trainer E2E were rerun this closeout.

## 15. Report inclusion decision
Included — matches the established `Docs/Reports/` commit convention from the Phase 2C, Phase 3A, and Phase 3B closeouts.

## 16. Exact staged paths
Identical to item 6 (5 paths) — `git diff --cached --name-status` confirmed exact `A`/`M` status match, 0 unrelated baseline paths, 0 temporary fixture files, 0 screenshots, 0 unrelated reports.

## 17. `git diff --cached --check`
Clean — exit 0.

## 18. Commit SHA
`44962a952c4816cf45951e0585c375456b392017`

## 19. Commit message
```
feat(trainers): add All Games first-use flow

Add the Phase 3C All Games Trainer Library flow.

Keep Popular as the default view while exposing the full eligible catalog
through All Games, preserving centralized exclusion rules and avoiding
Popular-limit truncation.

Add the roadmap-required first-use notice with persistent dismissal,
stable view switching, focused regression coverage, and responsive
verification without introducing sorting/filter redesign.
```

## 20. Exact committed paths
Identical to item 6 (5 paths) — verified via `git show --name-status --format=fuller HEAD`.

## 21. Post-commit dirty count
65 — exactly the reconciled non-Phase-3C baseline; verified via `git status --short | wc -l`.

## 22. Push result
Success: `845bb54..44962a9  review/gate2-5-doc-audit -> review/gate2-5-doc-audit`.

## 23. Local HEAD
`44962a952c4816cf45951e0585c375456b392017`

## 24. Remote HEAD
`44962a952c4816cf45951e0585c375456b392017`

## 25. Local/remote equality
Confirmed equal.

## 26. §3.4 final status
**COMPLETE.** All Games exposes the full eligible catalog via the centralized Phase 3A exclusion boundary, Popular remains the default view, the exact ROADMAP-specified first-use notice is implemented with persistent one-time dismissal, and no truncation occurs from the Popular cap. Verified by isolated fixture, real-catalog assessment, three-size rendered checks, and 6 focused regression tests.

## 27. Remaining Phase 3 subsection classifications
- §3.5 Sorting — **NOT IMPLEMENTED.** ROADMAP lists 10 named sort keys (Recommended, Popular now, All-time popular, Newest release, Recently added to SOLITH, Recently updated, A–Z, Installed first, Verified first, Most trainer options). Only 2 (`Installed first`, `A–Z`) exist today as the pre-existing `SortMode` in All Games. None of the other 8 are selectable.
- §3.6 Filters — **NOT IMPLEMENTED.** None of the four filter categories (Availability, Mode, Catalog, Launcher) or Genre-as-multi-select exist per the roadmap's model. The current Verification/Installed/Running/Needs-re-verify toggles and single-select Genre chips are pre-existing, narrower mechanisms, not the §3.6 model (no multi-select chips, no visible result count tied to filters, no Reset-all, no remembered filter state).
- No later Phase 3 subsections exist in `ROADMAP.md` beyond §3.6 — §3.6 is immediately followed by the Phase 3 exit gate and then `PHASE 4 — ARTWORK IDENTITY, CACHE, LEGAL SOURCING, AND BACKGROUND FETCHING`.

## 28. Phase 3 exit-gate status
**BLOCKED** on §3.5 and §3.6. The stated exit gate — *"Trainer Library discovery is useful by default and still supports full-catalog exploration"* — is substantively met by §3.1–§3.4 (Popular default, ranking, full-catalog All Games, first-use framing), but the roadmap's explicit §3.5/§3.6 requirements remain unimplemented, so the gate is not yet callable as passed.

## 29. Next unfinished subsection
§3.5 — Sorting.

## 30. Next bounded implementation slice
**§3.5 Sorting — foundation + evidence-backed sort keys only.** Scope: introduce the roadmap's named `SortMode` vocabulary in the All Games view (this project's established `SortMode` type already exists as the extension point), implementing only the sort keys backed by evidence already present in the codebase:
- `Installed first` (exists)
- `A–Z` (exists)
- `Verified first` (derivable from `verificationStatus === 'verified'`, same axis already used by the Verification filter)
- `Popular now` (derivable from the existing `catalog_demand`/`popularityMap` signal already wired for Phase 3B ranking)
- `Most trainer options` (derivable from existing `cheatCount` field)

Excluded from this slice, pending evidence sources not yet present anywhere in the schema: `Recommended`, `All-time popular`, `Newest release`, `Recently added to SOLITH`, `Recently updated` — these require release-date, added-to-catalog-date, or last-updated-date fields that do not exist today, mirroring the honest-permanent-tie precedent already established for Popular's `recentlyReleased`/`enduringFavorite` signals in Phase 3B. Do not fabricate proxy timestamps to unlock these keys.

## 31. Dependencies/blockers
- Depends on: §3.4's All Games view (now complete, this commit) as the only view where sorting currently applies.
- Reuses: the `catalog_demand` popularity signal and `verificationStatus`/`cheatCount` fields already present from Phase 3A/3B — no new IPC channels or schema changes required for the 5 in-scope keys.
- Blocked keys (`Newest release`, `Recently added to SOLITH`, `Recently updated`, `All-time popular`, and true `Recommended`) require a future data-model decision (adding release-date/added-at/updated-at fields to the catalog schema) — out of scope for the next slice and should be flagged to the owner rather than approximated.
- §3.6 (Filters) has no dependency on §3.5's outcome and could be sequenced independently, but §3.5 is the smaller, more self-contained slice and is selected first per roadmap dependency order.

## 32. Exact recommended next action
Authorize implementation of ROADMAP.md §3.5 (Sorting), scoped to the 5 evidence-backed sort keys listed in item 30 (Installed first, A–Z, Verified first, Popular now, Most trainer options), explicitly excluding the 5 keys requiring absent timestamp evidence, §3.6 Filters, and any Game Library/Wisp/live-memory/security-roadmap work.
