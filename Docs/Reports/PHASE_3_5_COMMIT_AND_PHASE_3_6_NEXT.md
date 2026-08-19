PHASE 3 §3.5 SORTING COMMITTED AND PUSHED — §3.6 FILTERS NEXT

# ROADMAP §3.5 Sorting Commit/Push Closeout

## Branch
`review/gate2-5-doc-audit`

## Starting HEAD
`44962a952c4816cf45951e0585c375456b392017`

## Pre-commit dirty state
79 = 66 preserved baseline + 13 §3.5 paths. Reconciled and confirmed exact match before staging.

## §3.5 reread
Unchanged, 10 keys, no conflict. All 10 confirmed still mapped in the implementation.

## Diff review
`git diff --check`: clean. Exact 13 §3.5 paths confirmed via `git status --short` (excluding the 66-entry baseline/evidence noise). No §3.6 content, no debug code, no generated artifacts, no temp files present in the diff.

## Product invariants reconfirmed directly from source
- `all-games-sorting.ts:92` — `rankPopularTrainerEntries(entries, rankingContext).map(...)` — Recommended delegates to the existing §3.3 model verbatim.
- `all-games-sorting.ts:31/40` — `allTimePopularityByCatalogGameId` is a distinct map/context field from `popularityByCatalogGameId`; two independent signals.
- `store.ts:160` — `createdAt` intentionally absent from the `ON CONFLICT ... DO UPDATE SET` list — INSERT-only, confirmed unchanged.
- `contentUpdatedAt` advances only via `hasMeaningfulCatalogChange()` — unchanged since implementation.
- All sorting confirmed non-mutating (`.slice()` first) and deterministic (name tie-break throughout).
- Unknown/malformed timestamps confirmed sorting last via `compareByTimestampDesc`/`Date.parse` NaN guard.
- All 10 UI sort buttons confirmed wired in `TrainerLibraryPage.tsx`.
- No §3.6 Filters code present anywhere in the diff.

## Trainer E2E failure classification
`PRE-EXISTING / UNRELATED`

## Evidence supporting E2E classification
Reran `npm run test:trainer-e2e` this closeout: identical failure (`locator('.solith-top-banner__title')`, `tests/trainer.e2e.test.ts:123`), 4/5 passed. `git status --short` on `SolithTopBanner.tsx`, `App.tsx`, `index.css`, `trainer.e2e.test.ts` returned no output — none intersect the §3.5 diff.

## Focused §3.5 verification
No code changed since the last full green run (39/39) reported in the implementation pass — prior results reconfirmed applicable per Step 5. This closeout independently reran tsc (both configs), `git diff --check`, and Trainer E2E rather than the full suite, since no source changed.

## Main TypeScript
PASS (`npx tsc --noEmit -p tsconfig.json`, exit 0).

## Electron TypeScript
PASS (`npx tsc --noEmit -p tsconfig.electron.json`, exit 0).

## `git diff --check`
Clean, exit 0 (both pre-stage and staged).

## Exact staged paths
```
M  electron/preload.ts
M  electron/trainer-catalog-ipc.ts
M  package.json
M  src/app/pages/TrainerLibraryPage.tsx
M  src/core/database/index.ts
A  src/core/trainer-catalog/all-games-sorting.ts
M  src/core/trainer-catalog/definition-feedback-store.ts
M  src/core/trainer-catalog/store.ts
M  src/core/trainer-catalog/types.ts
M  src/types/global.d.ts
A  tests/trainer-catalog-all-games-sorting-schema.test.ts
A  tests/trainer-catalog-all-games-sorting.test.ts
A  tests/trainer-library-sort-ui.test.ts
```
13 paths — exact match to intended scope, 0 baseline-noise paths staged.

## Commit SHA
`29c1de829b0cd3c5ed442330dee60a58efaa4f64`

## Commit message
```
feat(trainers): complete All Games sorting (10/10)

Complete ROADMAP §3.5 Sorting: all 10 keys are now functional and
independently distinguishable.

Add Recommended (delegates to the existing §3.3 ranking model), All-time
popular (new lifetime positive-feedback signal, distinct from the Popular
now catalog_demand signal), Newest release, Recently added to SOLITH, and
Recently updated (new releaseDate/createdAt/contentUpdatedAt columns via
additive, idempotent migration).

createdAt is INSERT-only; contentUpdatedAt advances only on a meaningful
catalog content change, not every sync/seed/import upsert. Unknown or
malformed timestamp/date evidence sorts last, never fabricated. All
sorting remains non-mutating and deterministic.
```

## Exact committed paths
Identical to the staged list above — verified via `git show --name-status --format=fuller HEAD`.

## Post-commit dirty-state reconciliation
66 — exactly the preserved baseline, verified via `git status --short | wc -l`.

## Push result
Success: `44962a9..29c1de8  review/gate2-5-doc-audit -> review/gate2-5-doc-audit`.

## Local/remote equality
Local HEAD `29c1de829b0cd3c5ed442330dee60a58efaa4f64` == remote HEAD `29c1de829b0cd3c5ed442330dee60a58efaa4f64`. Confirmed equal.

## §3.5 status
**COMPLETE.** All 10 sort keys functional, independently distinguishable per ROADMAP semantics (Popular now vs. All-time popular use distinct signals), unknown/malformed evidence sorts safely without fabrication, migration additive/idempotent, committed source matches the verification evidence.

## Exact next ROADMAP subsection
**§3.6 Filters** — not implemented this pass. Four filter categories (Availability, Mode, Catalog, Launcher) plus Genre-as-multi-select, with UX requirements (multi-select, visible chips, result count, Reset, remembered filter state, predictable back navigation, no hidden active filters) remain unimplemented. This is the last unfinished Phase 3 subsection before the Phase 3 exit gate.
