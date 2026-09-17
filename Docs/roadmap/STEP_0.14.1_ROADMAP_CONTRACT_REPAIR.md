# Step 0.14.1 — Roadmap-as-Runtime-Contract Repair

## Exact original failure

The Step 0.14 canonical roadmap rewrite (commit `239fd88`) removed the old `ROADMAP.md`'s §3.4/§3.5/version-baseline content. Three pre-existing tests parsed that content as if it were a runtime/product contract rather than documentation, and failed identically on both `fast` and `Windows native and Electron gate` CI jobs: 1778/1781 pass, 3 fail.

## Why roadmap-parsing was brittle

At the time these tests were written (Phase 3 implementation), `ROADMAP.md` was the live specification being implemented against, so pointing a test at "the roadmap's own words" was a reasonable proxy for "the approved copy." That coupling stopped being safe the moment `ROADMAP.md`'s own purpose changed from *living spec* to *periodically-reconstructed canonical roadmap* (Step 0.14) — a document that is explicitly expected to be rewritten wholesale as phases complete and get re-planned. A test that derives its expected value by regexing a document with that lifecycle is not testing product truth; it is testing document-sync luck.

## Per-test forensic findings and repair

### 1. `tests/trainer-library-all-games-notice.test.ts`

- **Real product contract**: the exact first-use "All Games" notice copy shown to users matches the approved wording (not garbled, not silently altered).
- **Does the behavior still exist?** Yes — `ALL_GAMES_NOTICE_TEXT` in `src/app/pages/TrainerLibraryPage.tsx:50-51`, rendered live at line 1749. Unchanged.
- **Old source of truth**: `ROADMAP.md` §3.4 prose, extracted by regex.
- **New source of truth**: a literal, regression-locked expected string (`EXPECTED_ALL_GAMES_NOTICE_TEXT`) inside the test itself, compared directly against the production constant.
- **Coverage preserved?** Yes — this is the same exact-string comparison as before, minus the indirection through a second document. The other 4 tests already in this file (dismissible, localStorage persistence, Popular-as-default, deterministic ordering) were never roadmap-coupled and were untouched.

### 2. `tests/trainer-library-sort-ui.test.ts`

- **Real product contract**: every one of the product's defined "All Games" sort modes has a working, correctly labeled button; no sort mode is silently unwired.
- **Does the behavior still exist?** Yes — `AllGamesSortMode` (the type union) and `ALL_GAMES_SORT_MODE_LABELS` (`Record<AllGamesSortMode, string>`) in `src/core/trainer-catalog/all-games-sorting.ts`.
- **Old source of truth**: a bullet count parsed from `ROADMAP.md` §3.5, plus a hand-duplicated `modeToLabel` object hardcoded in the test (which happened to already match the real registry).
- **New source of truth**: `ALL_GAMES_SORT_MODE_LABELS`, imported directly from `all-games-sorting.ts`. This is strictly stronger than either the old roadmap-derived count or the old hardcoded duplicate: `ALL_GAMES_SORT_MODE_LABELS` is typed as `Record<AllGamesSortMode, string>`, so the TypeScript compiler itself now refuses to build if a sort mode is ever added to `AllGamesSortMode` without a label — a class of drift the old test could not catch at all.
- **Actual supported keys** (10, unchanged): `recommended`, `popular-now`, `all-time-popular`, `newest-release`, `recently-added`, `recently-updated`, `a-z`, `installed-first`, `verified-first`, `most-trainer-options`.
- **Coverage preserved?** Yes, and strengthened (compiler-enforced completeness added). The per-key UI-wiring assertions (`setSortMode('${mode}')`, label presence) are unchanged.

### 3. `tests/version-consistency.test.ts`

- **Real product contract**: every actual version-bearing product surface (package.json, package-lock.json, README's install snippet, CHANGELOG's latest entry, the packaged installer's `productName`/`appId`/NSIS artifact naming, `index.html`'s title/meta, `.nvmrc`/`engines.node`) states the same version as `package.json`.
- **Does the behavior still exist?** Yes for every surface except `ROADMAP.md`. `package.json` remains the single authoritative version source.
- **Old source of truth for the removed assertions**: a "Current Baseline (Solith X.Y.Z)" line hand-maintained inside `ROADMAP.md`.
- **New source of truth**: none needed — `ROADMAP.md` is a planning document, not a version-bearing product surface, and requiring it to mirror `package.json` made it a second hand-maintained copy of the version, which is the exact anti-pattern this test suite exists to prevent everywhere else. The canonical Step 0.14 roadmap deliberately identifies its baseline by certified git SHA instead (`ROADMAP.md` §3; `38-step-0.14-roadmap-source-reconciliation.md`).
- **Additional surfaces inspected per the mission's instruction**: Electron's `app.getVersion()` (`electron/main.ts:175,179,776`) and the Settings → About UI (`src/app/pages/settings/sections/AboutSection.tsx`) both resolve the version dynamically at runtime from the packaged app's own metadata via IPC — neither holds a separate literal, so neither can drift from `package.json` by construction and neither needs (or can meaningfully receive) a static string-match assertion.
- **Coverage preserved?** Yes — every other assertion in the test (package.json/package-lock.json/README/CHANGELOG/index.html/.nvmrc/engines/build metadata) is untouched and still exactly as strict.

## Verification results

| Check | Result |
|---|---|
| 3 focused tests | 13/13 pass (the 3 repaired tests plus the 10 sibling tests already in those 2 files) |
| Related Trainer Library / sorting / version suites (`trainer-catalog-all-games-sorting`, `-schema`, `-filters`, `-eligibility-classification`, `-popular-ranking`, `release-artifacts`, `dependency-security-overrides`) | 126/126 pass |
| Renderer typecheck (`npx tsc --noEmit`) | 0 errors |
| Electron typecheck (`npx tsc --project tsconfig.electron.json --noEmit`) | 0 errors |
| `build:vite` | Success (pre-existing chunk-size warnings only, unrelated to this change) |
| `build:electron` | 29/29 verification checks pass |
| Full suite (`npm test`) | 1781/1781 + 10/10 pass, 0 fail — identical count to the pre-repair baseline |
| `npm audit` | 0 vulnerabilities (info/low/moderate/high/critical) |

Test count did not change (still 1781 + 10) — this was a content repair of 3 existing tests, not an addition or removal of test cases.

## Changed files

- `tests/trainer-library-all-games-notice.test.ts`
- `tests/trainer-library-sort-ui.test.ts`
- `tests/version-consistency.test.ts`

`ROADMAP.md` was **not modified**. No production behavior was changed — the only non-test change under consideration (importing an already-exported registry into a test) required no source edits, since `ALL_GAMES_SORT_MODE_LABELS` was already exported from `all-games-sorting.ts`.
