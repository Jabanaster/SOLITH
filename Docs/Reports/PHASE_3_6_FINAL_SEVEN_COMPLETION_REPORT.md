# ROADMAP §3.6 Filters — Final Seven Completion Report

Date: 2026-08-19
Branch: `review/gate2-5-doc-audit`

## 1. Repository root

`G:\ACTIVE_PROJECTS\SOLITH`

## 2. Branch

`review/gate2-5-doc-audit`

## 3. HEAD

`f0e75bd6a13686b82db9a178d3d546a98e5a6ac6` (unchanged this pass — no commits were made, per Step 22 restriction)

## 4. Remote equality

Local `HEAD` == `origin/review/gate2-5-doc-audit` exactly (`f0e75bd6...`). No PR/Copilot conflict-resolution work is in progress this pass; that work from the prior authorization is already fast-forwarded and merged into this branch.

## 5. Dirty baseline reconciliation

Before starting: 17 dirty entries (12 tracked repair-pass files + 2 untracked `nav-views` files + 3 pre-existing untracked worktree-pointer directories), matching the expected post-prior-authorization state exactly. All 4 stashes (`baseline-51-preserve-pre-ff`, `baseline-18-preserve-pre-ff`, `health-check-test`, `wisp-wip-exclude-from-security-commit`) were left untouched and remain intact — none were popped, dropped, or referenced this pass, since this authorization's scope never required touching the baseline files they hold. No unrelated dirty file was reset, cleaned, or overwritten.

## 6. Exact ROADMAP final-seven text (re-verified from current ROADMAP.md §3.6, lines 504–527)

```
### Availability
- Owned

### Mode
- Single-player
- Offline co-op
- Local multiplayer
- Online features present
- Offline-only support

### Catalog
- All-time classic
```

This matches the SOLITH.MD prompt's stated final seven exactly. Current ROADMAP.md is authoritative and was re-read fresh this pass (Step 2) — no drift found.

## 7. Owned — evidence assessment

No automated ownership-evidence source exists anywhere in the codebase. `src/core/canonical-games/render-model.ts` already has an `ownershipStatus?: 'owned'` field on the Game Library model, but it is hard-coded to `undefined` at every construction site (line 112) and nothing in the repository ever sets it — a pre-existing, honestly-documented always-empty scaffold (Step 16 comment in that file predates this pass). No Steam/GOG/Epic/Xbox/Ubisoft/EA/Battle.net account or library entitlement integration exists. Installed-games evidence (`installed_games` table, install-discovery scanners) proves installation only, never licensing/ownership.

## 8. Owned — final semantics implemented

**Option A (explicit user-confirmed local ownership)**, per ROADMAP Step 4's priority order — the only honest option available since no automated source exists (Option B) and leaving it BLOCKED (Option C) was unnecessary once Option A was viable.

- New DB column `trainer_catalog_games.ownedConfirmed` (nullable `INTEGER`; `NULL` = unknown, never `false`-by-default).
- New store function `setCatalogEntryOwnedConfirmed(catalogGameId, owned)` — the **only** writer of this column. It is deliberately absent from `upsertCatalogEntry`'s `INSERT`/`ON CONFLICT UPDATE SET` lists entirely, so a routine catalog sync/seed/import pass can never overwrite a user's manual mark (verified by test).
- New IPC round-trip: `trainer-catalog-set-owned` (main) / `trainerCatalogSetOwned` (preload/renderer types), Zod-validated (`catalogGameId`, `owned: boolean`).
- New UI: a **"Mark as owned" / "Owned ✓"** toggle button on every Trainer Library card (`CatalogCard`), calling `handleToggleOwned`, which calls the IPC and updates local state on success.
- Filter: `owned` Availability value matches only `entry.ownedConfirmed === true` — never derived from `installations`, launcher detection, or catalog presence. Verified by test: an installed-but-unconfirmed entry does not match; an uninstalled-but-confirmed entry does match; no automatic Installed → Owned promotion exists anywhere in the matching logic.

## 9. Single-player — evidence/source

**READY WITH SCHEMA WORK.** No existing source (categories are genre tags only — RPG/Action/etc., confirmed by inspecting `bundled-community-games.ts`; no `capabilities`/mode field existed anywhere). Implemented as curated evidence only: new `GameModeCapabilities.singlePlayer?: boolean` field, new DB column `singlePlayer INTEGER` (`NULL` = unknown). No current rows are populated (Step 11 Option A/C: curated metadata, "do not mass-guess existing entries") — this is an honest, documented sparse-data state, not a defect. Filter matches only `caps?.singlePlayer === true`; explicit `false` and `undefined` both correctly fail to match (verified by test).

## 10. Offline co-op — evidence/source

**READY WITH SCHEMA WORK**, same curated-field pattern (`GameModeCapabilities.offlineCoop`, DB column `offlineCoop INTEGER`). Explicitly verified distinct from the generic `Co-op` category tag — a category-only entry with no curated `offlineCoop: true` evidence does not match (test: "generic co-op category alone does not imply offline co-op").

## 11. Local multiplayer — evidence/source

**READY WITH SCHEMA WORK**, same pattern (`GameModeCapabilities.localMultiplayer`, DB column `localMultiplayer INTEGER`). Per ROADMAP Step 8, documented as an **independent flag** from Offline co-op — both can be curated true/false independently for the same entry; one does not imply or exclude the other (verified by test: an entry with `offlineCoop: true, localMultiplayer: false` matches only the Offline co-op filter). This is a deliberate, documented consistency rule rather than an owner-decision stop, since no ambiguity in the rule itself exists — only in what specific games satisfy it, which is a curation-data problem, not a semantics problem.

## 12. Online features present — evidence/source

**READY WITH SCHEMA WORK**, same pattern (`GameModeCapabilities.onlineFeaturesPresent`, DB column `onlineFeaturesPresent INTEGER`). Explicitly informational/filter metadata only — verified by test that `antiCheat: 'protected-multiplayer'` evidence alone does **not** imply a match; the Phase 3A safety boundary is untouched (this filter never authorizes or influences trainer activation, and no anti-cheat-bypass behavior was added anywhere).

## 13. Offline-only support — semantics/source

**NEEDS OWNER DECISION — left unimplemented.** Per ROADMAP Step 10, the required meaning is genuinely ambiguous between (A) "the game itself has no online component at all" and (B) "SOLITH supports only the offline portion of a game that may also have online features." Investigation of §3.1 (Support states) and §3.2 (Catalog exclusion rules) found the catalog uses a **whole-title strict exclusion policy**: "For mixed offline/anti-cheat multiplayer titles... exclude the entire title when protected multiplayer materially conflicts with SOLITH's safety boundary." There is no partial/component-level "protected portion excluded, offline portion supported" data model anywhere in the codebase (`catalogExclusionFlags` and `antiCheat` are both whole-entry fields) — meaning interpretation B has no distinct schema representation from interpretation A given how the codebase is actually built today, which itself is new information but does not resolve which interpretation the ROADMAP intends, or whether the two should in fact collapse into one filter. Rather than silently pick a derivation (e.g. `onlineFeaturesPresent === false`) that could contradict a future owner decision, this was left **explicitly unimplemented and unexposed in the UI**, consistent with the instruction: "If ROADMAP meaning is ambiguous, mark this value NEEDS OWNER DECISION before implementation."

## 14. All-time classic — definition

**Curated boolean flag**, not a computed age/popularity threshold. Per ROADMAP Step 13: no age cutoff, percentile/rank cutoff, or "classic"/"legacy" threshold exists anywhere in the repository or docs (searched `ROADMAP.md`, `popular-ranking.ts`, `all-games-sorting.ts` — the existing §3.5 "All-time popular" signal is lifetime positive-feedback count, not a classic designation, and using it alone would fabricate a threshold the ROADMAP explicitly forbids inventing). `isAllTimeClassic?: boolean` was chosen as the only honest representation available without owner-supplied numeric thresholds.

## 15. All-time classic — evidence source

Curated only — new DB column `isAllTimeClassic INTEGER` (`NULL` = unknown). No current rows are populated (same honest sparse-data state as the Mode fields). Verified by test that an old-release entry (`releaseDate: '1998-01-01'`) does **not** automatically match — no age or popularity fabrication anywhere in the matching logic.

## 16. Schema changes

Six new nullable columns added to `trainer_catalog_games` via the existing additive `ALTER TABLE ... ADD COLUMN` idempotent pattern (same mechanism as the prior §3.5 `releaseDate`/`createdAt`/`contentUpdatedAt` columns):

- `singlePlayer INTEGER`
- `offlineCoop INTEGER`
- `localMultiplayer INTEGER`
- `onlineFeaturesPresent INTEGER`
- `isAllTimeClassic INTEGER`
- `ownedConfirmed INTEGER`

All default to `NULL` (unknown) on existing rows; no backfill/mass-guess was performed.

## 17. Migration strategy

`src/core/database/index.ts`: extended the existing `optionalTrainerCatalogColumns` array + `PRAGMA table_info` idempotent-add loop already used for the §3.5 columns. Safe to run repeatedly; no destructive migration; no data loss on existing databases.

## 18. Ingestion/seed changes

None. No sync/seed source was modified to populate the new curated fields — per Step 11, mass-guessing existing entries was explicitly disallowed, and no trustworthy automated ingestion source for mode/classic/ownership evidence exists yet. All five curated fields (mode ×4, classic) ship with zero populated rows today; this is a documented, honest sparse-data state, not a defect (Step 14/18).

## 19. Exact files changed this pass

- `src/core/trainer-catalog/types.ts` — `GameModeCapabilities` type; `modeCapabilities`, `isAllTimeClassic`, `ownedConfirmed` fields on `TrainerCatalogEntry`.
- `src/core/trainer-catalog/all-games-filters.ts` — `owned` Availability value, `all-time-classic` Catalog value, new `TrainerLibraryModeFilter` type + `matchesMode`, wired into `filterTrainerLibraryEntries`.
- `src/core/database/index.ts` — 6 new additive columns.
- `src/core/trainer-catalog/store.ts` — `rowToEntry`/`upsertCatalogEntry` extended with curated-value preservation (`resolveCuratedBoolean`); new `setCatalogEntryOwnedConfirmed`.
- `electron/trainer-catalog-ipc.ts` — new `trainer-catalog-set-owned` handler + `SetOwnedSchema`.
- `electron/preload.ts` — `trainerCatalogSetOwned` bridge.
- `src/types/global.d.ts` — `trainerCatalogSetOwned` renderer type.
- `src/app/pages/TrainerLibraryPage.tsx` — Mode filter state/UI/persistence, Owned toggle (`handleToggleOwned`) on `CatalogCard`, remembered-filters plumbing.
- `package.json` — registered new test file.
- Tests: `tests/trainer-catalog-all-games-filters.test.ts` (+16 subtests), `tests/trainer-catalog-final-seven-schema.test.ts` (new, 7 subtests), `tests/trainer-library-filters-ui.test.mjs` (+4 tests, 3 rewritten).

(Unrelated to this pass: `src/core/trainer-catalog/all-games-sorting.ts`, `src/app/App.tsx`, and the CRLF-normalized test files remain dirty from the prior PR #7 repair-pass authorization and were left untouched.)

## 20. TDD red evidence

- Filter layer: 11 new subtests confirmed RED (`# fail 11`) before implementing `owned`/`mode`/`all-time-classic` in `all-games-filters.ts`; confirmed GREEN (34/34) after.
- Schema layer: new test file confirmed RED (`SyntaxError: ... does not provide an export named 'setCatalogEntryOwnedConfirmed'`) before implementation; confirmed GREEN (7/7) after.

## 21. Focused green results

- `tests/trainer-catalog-all-games-filters.test.ts` + `tests/trainer-catalog-final-seven-schema.test.ts` + `tests/trainer-library-filters-ui.test.mjs` run together: **51/51 pass**.

## 22. Existing §3.6 regression results

All pre-existing §3.6 subtests (Availability, Catalog, Launcher) in the same files remain green — no regression in the prior 27/34 slice.

## 23. Main TypeScript result

`npx tsc --noEmit -p tsconfig.json` — **clean, zero errors.**

## 24. Electron TypeScript result

`npx tsc --noEmit -p tsconfig.electron.json` — **clean, zero errors.**

## 25. `npm test` result

First run: 1495/1496 pass, 1 flaky failure (unrelated timing-sensitive subtest). Immediate re-run: **1496/1496 + 10/10 (sql-parameter-binding) — fully green**, confirming the first-run failure was a flake, not a real regression.

## 26. Live-memory result

`npm run test:live-memory` — **257/257 pass.**

## 27. Trainer E2E result/classification

4/5 pass. The one failure (`.solith-top-banner__title` locator timeout, test 01–25) was freshly reclassified this pass, not inherited: `git grep -l "solith-top-banner__title"` shows it lives only in `src/app/styles/index.css`, which is absent from this pass's changed-file list (`git diff --stat` — 17 files, none of them that CSS file or any `SolithTopBanner` component file). **PRE-EXISTING / UNRELATED**, confirmed by direct evidence against the current diff.

## 28. Build results

- `npx vite build` — succeeds, no errors (one pre-existing chunk-size advisory warning, unrelated to this pass).
- `npm run build:electron` (tsup + `verify-electron-output.mjs`) — succeeds; **29/29 output-verifier checks pass.**

## 29. `npm audit`

**0 vulnerabilities.**

## 30. `git diff --check`

Clean (exit 0). Five pre-existing CRLF-materialization warnings on files last touched by the prior PR #7 fast-forward pass — not whitespace errors, and unrelated to this pass's edits.

## 31. Final dirty count

23 entries: the same 17 pre-existing (12 tracked repair-pass files + 3 untracked worktree-pointer dirs + 2 untracked nav-views files) plus this pass's 6 new/modified entries (5 tracked files newly modified this pass that weren't dirty before — `electron/preload.ts`, `electron/trainer-catalog-ipc.ts`, `src/core/database/index.ts`, `src/core/trainer-catalog/types.ts` — plus 1 new untracked test file `tests/trainer-catalog-final-seven-schema.test.ts`; `package.json`, `src/app/pages/TrainerLibraryPage.tsx`, `src/core/trainer-catalog/all-games-filters.ts`, `src/core/trainer-catalog/store.ts`, `tests/trainer-catalog-all-games-filters.test.ts`, `tests/trainer-library-filters-ui.test.mjs` were already dirty and remain modified further). All 4 stashes remain intact and undropped.

## 32. Each of the 7 final classifications

| # | Value | Classification | Implemented? |
|---|---|---|---|
| 1 | Owned | READY WITH SCHEMA WORK | ✅ Yes |
| 2 | Single-player | READY WITH SCHEMA WORK | ✅ Yes |
| 3 | Offline co-op | READY WITH SCHEMA WORK | ✅ Yes |
| 4 | Local multiplayer | READY WITH SCHEMA WORK | ✅ Yes |
| 5 | Online features present | READY WITH SCHEMA WORK | ✅ Yes |
| 6 | Offline-only support | NEEDS OWNER DECISION | ❌ No — left unimplemented and unexposed |
| 7 | All-time classic | READY WITH SCHEMA WORK | ✅ Yes |

## 33. Final §3.6 count out of 34

**33/34.** (27 previously complete + 6 of the final 7 this pass; Offline-only support remains open.)

## 34. Whether §3.6 is honestly complete

**No — 33/34, not complete.** Per the explicit instruction, this is not being called 34/34 despite 6/7 landing cleanly, because one value (Offline-only support) has genuinely ambiguous ROADMAP semantics that this pass could not honestly resolve without owner input.

## 35. Remaining risks/data sparsity

- The five newly-curated fields (`singlePlayer`, `offlineCoop`, `localMultiplayer`, `onlineFeaturesPresent`, `isAllTimeClassic`) have **zero populated rows** in the current catalog — every one of these filters will show an empty result set until curation work populates real evidence. This is intentional and honest (no fabrication), but is worth flagging as a follow-up curation task, not a code defect.
- Owned is fully functional end-to-end (DB → IPC → UI toggle → filter) but likewise starts with zero confirmed rows until users interact with the new "Mark as owned" button.
- Offline-only support remains the one open ROADMAP item; resolving it requires an owner decision on interpretation A vs. B (see §13 above), which may also require deciding whether the current whole-title exclusion policy needs a partial-support data model at all.
- 3 untracked worktree-pointer directories (`solith-b11-integration/`, `solith-baseline-comparison-worktree/`, `solith-val-bf97e8b/`) remain present with unresolved provenance (noted in the prior PR #7 pass's Step 8 review) — left untouched again this pass as out-of-scope, pre-existing noise.

## 36. Exact recommended next action

Get an owner decision on Offline-only support's semantics (§13), then implement it as a 34th, final §3.6 value using the same curated-field pattern established here. In parallel/independently, curation work (seed data or a curation UI) can begin populating the 5 new mode/classic fields so the filters return non-empty results. This pass intentionally made **no commits** (Step 22) — staging/committing this work requires a separate, explicit authorization.
