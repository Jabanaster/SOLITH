PHASE 3 §3.6 19-VALUE FILTER SLICE COMMITTED AND PUSHED — 15 VALUES REMAIN BLOCKED/OWNER-DECISION

# ROADMAP §3.6 19-Value Slice — Apply, Verify, Commit/Push Closeout

## Source
Patch applied from `SOLITH_PHASE_3_6_19_VALUE_SLICE.patch`, built against an isolated sandbox worktree at `29c1de829b0cd3c5ed442330dee60a58efaa4f64` (no deps, unverified there). Applied here to the real working branch with full dependencies installed.

## Branch
`review/gate2-5-doc-audit`

## Starting HEAD
`29c1de829b0cd3c5ed442330dee60a58efaa4f64`

## Pre-apply dirty state
67 = baseline noise (drifted from the prior 66, unrelated to §3.6 — confirmed zero intersection with the 6 patch paths via `git status --short` before touching anything).

## Patch apply
`git apply --check` clean, then applied for real. Post-apply dirty count: 73 = 67 baseline + 6 patch paths. Exact match.

## Full verification (with dependencies installed — the gap the sandbox build could not close)
- `npx tsc --noEmit -p tsconfig.json` — **PASS**, exit 0
- `npx tsc --noEmit -p tsconfig.electron.json` — **PASS**, exit 0
- `npm test` — **1272/1272 PASS**, 0 fail (includes the two new §3.6 test files, registered in `package.json`)
- `git diff --check` — clean, exit 0 (only pre-existing CRLF warnings on baseline files untouched by this patch)
- `npm run test:trainer-e2e` — 4/5 pass, 1 fail: `.solith-top-banner__title` not visible, `tests/trainer.e2e.test.ts:123`

## Trainer E2E failure classification
**PRE-EXISTING / UNRELATED.** Reconfirmed by checking intersection, not inherited: `git status --short` on `SolithTopBanner.tsx`, `App.tsx`, `index.css`, `tests/trainer.e2e.test.ts` returned no output — none are dirty, none appear in the §3.6 diff. Identical failure signature to the one recorded at the §3.5 closeout.

## Implemented (19/34 authorized values)
- **Availability (5):** Installed, Not installed, Has trainer/profile, Verified, Community/unverified
- **Catalog (4):** Popular, New release, Niche/deep catalog, Recently added
- **Genre (10):** RPG, Action, Strategy, Simulation, Adventure, Shooter, Survival, Racing, Sports, Puzzle

Filter semantics: OR within a category, AND across categories, non-mutating. Popular/Niche reuse the existing §3.3 projection (Niche as its owner-accepted complement; missing evidence never falsely counted as Niche). New release/Recently added match only on trustworthy `releaseDate`/`createdAt` evidence — no invented time window, since ROADMAP defines none. A pagination gap (derived filters missing matches past the first All Games page) was fixed by fetching the full bounded candidate set before filtering when Availability/Catalog filters are active.

## Deferred (15/34, unchanged from reconciliation)
- Owned (Availability) — BLOCKED, no ownership evidence source
- All 5 Mode values — BLOCKED, no distinguishing evidence
- All-time classic (Catalog) — NEEDS OWNER DECISION
- Launcher category (8 values) — NEEDS OWNER DECISION (installed-only vs. full-catalog-availability scope)

## Exact staged/committed paths
```
M  package.json
M  src/app/pages/TrainerLibraryPage.tsx
A  src/core/trainer-catalog/all-games-filters.ts
M  src/core/trainer-catalog/catalog-genres.ts
A  tests/trainer-catalog-all-games-filters.test.ts
A  tests/trainer-library-filters-ui.test.mjs
```
6 paths — exact match to the patch scope, 0 baseline-noise paths staged.

## Commit SHA
`0f2cfa731b07260d64c0b7cb5597aa70f1527fc8`

## Post-commit dirty-state reconciliation
67 — exactly the preserved baseline, unchanged.

## Push result
Success: `29c1de8..0f2cfa7 review/gate2-5-doc-audit -> review/gate2-5-doc-audit`.

## Local/remote equality
Local HEAD `0f2cfa731b07260d64c0b7cb5597aa70f1527fc8` == remote HEAD `0f2cfa731b07260d64c0b7cb5597aa70f1527fc8`. Confirmed equal.

## §3.6 status
**PARTIAL — 19/34 COMPLETE.** Evidence-backed subset implemented, verified, committed, pushed. Remaining 15 values (Owned, Mode ×5, All-time classic, Launcher ×8) require either new evidence sources or an explicit owner decision before implementation.

## Next
Resolve the 3 open items (Owned evidence question is effectively closed as BLOCKED per existing Game Library precedent; All-time classic semantics; Launcher scope) via owner decision, then implement the remaining §3.6 values in a follow-up slice.
