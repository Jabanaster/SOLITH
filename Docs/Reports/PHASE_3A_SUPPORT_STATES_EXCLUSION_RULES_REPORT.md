PHASE 3A SUPPORT STATES + CATALOG EXCLUSION RULES IMPLEMENTED — REVIEW REQUIRED

# Phase 3A Report — §3.1 Support States + §3.2 Catalog Exclusion Rules

## 1. Branch
`review/gate2-5-doc-audit`

## 2. Starting HEAD
`bae5473eff9dc80a734191853b36e447251bec51`

## 3. Node version
`v22.23.2`

## 4. Pre-existing dirty baseline
63 (61 original baseline + 2 prior-authorization report files, both still untracked/uncommitted)

## 5. Governing ROADMAP requirements
`ROADMAP.md` §3.1 defines six support states (Eligible, Listed, Community/Unverified, Verified, Unsupported, Excluded) and §3.2 defines catalog exclusion categories (MMOs, competitive-online-only, no-meaningful-offline-play, cloud-only, dedicated servers, demos, soundtracks, editors/tools, DLC-only, unsupported delisted products) plus the owner-selected strict whole-game exclusion policy for titles mixing offline content with anti-cheat-protected multiplayer.

## 6. Governing PROJECT_SPEC requirements
`PROJECT_SPEC.md` was searched for the classification vocabulary (eligibility, supportState, verificationStatus, anti-cheat, multiplayer, offline, campaign, unsupported, excluded, community, verified, catalog categories, game modes). It defines the live-memory-session online-session guard (per-attach runtime safety check) but does not define a catalog-level Trainer Library eligibility/exclusion vocabulary. **No conflict found** between `ROADMAP.md` and `PROJECT_SPEC.md` — they govern different layers (catalog-level listing eligibility vs. runtime live-memory-attach safety), so no stop-and-report was needed.

## 7. Existing support/eligibility architecture found
- `CanonicalGame.eligibility: CanonicalGameEligibility` (`src/core/canonical-games/types.ts`) already declared the exact six-value roadmap vocabulary (`'eligible' | 'listed' | 'community' | 'verified' | 'unsupported' | 'excluded'`) but was hardcoded to `'listed'` for every canonical game in `migration.ts` — no real classification logic existed.
- `CanonicalGame.supportState: CanonicalGameSupportState` (`'supported' | 'partial' | 'unsupported' | 'unknown'`) is a **separate, pre-existing axis** representing SOLITH trainer-completeness (derived from `hasModPack`), not roadmap §3.1's eligibility vocabulary. Left untouched this phase per the Step 4 distinction requirement.
- `TrainerCatalogEntry.verificationStatus: VerificationStatus` (`'verified' | 'community' | 'metadata-only' | 'unverified'`) is the provenance/verification axis, also pre-existing.
- No anti-cheat, multiplayer, online/offline, or catalog-exclusion-category evidence field existed anywhere in the repository. `categories: string[]` on `TrainerCatalogEntry` is pure genre tagging (Action, RPG, Strategy, etc. — confirmed by reading `catalog-genres.ts` and the full bundled catalog `bundled-community-games.ts`), carrying zero safety signal.
- `game-profiles/catalog.ts`'s `ProfileSupportStatus` (`supported`/`preview-only`/`read-only`/`blocked`/`needs-review`) is an unrelated save-editor support-matrix concept (Phase 6 territory) and was not touched or conflated with §3.1.

## 8. Final typed support-state model
Reused the existing `CanonicalGameEligibility` values by declaring a structurally identical `TrainerCatalogEligibilityState` type in the new `src/core/trainer-catalog/eligibility-classification.ts` module (not importing across the trainer-catalog/canonical-games boundary, to preserve existing dependency direction — canonical-games already depends on trainer-catalog, not the reverse). No duplicate/parallel vocabulary was created; both types carry the identical six string values.

## 9. Final exclusion-result model
```ts
interface TrainerCatalogClassificationResult {
  state: TrainerCatalogEligibilityState;
  excluded: boolean;
  reasonCodes: TrainerCatalogExclusionReasonCode[];
  evidence: TrainerCatalogEligibilityEvidence;
}
```
Produced by the pure function `classifyTrainerCatalogEligibility(evidence)`.

## 10. Support-state vs verification-state distinction
Verification (`verificationStatus: verified/community/metadata-only/unverified`) is read only **after** every exclusion check has cleared — a `verified` or `community` title can still resolve to `excluded` if exclusion evidence exists (tested explicitly: see item 27). Verification never implies safety clearance and safety exclusion never implies verification tier.

## 11. Strict anti-cheat whole-game exclusion rule
Implemented exactly as specified: `antiCheat: 'protected-multiplayer'` (offline/campaign content sharing a title with anti-cheat-protected multiplayer) excludes the entire game via reason code `anti-cheat-protected-multiplayer`; `antiCheat: 'protected-online-only'` excludes via `protected-online-only`. `antiCheat: 'unknown'` or the field being absent contributes **no** exclusion reason and is never treated as a safe/supported default — it simply does not, on its own, exclude a title lacking any other exclusion evidence.

## 12. Evidence/source precedence
Order: identity-ambiguity check → catalog exclusion flags → anti-cheat status → explicit-unsupported flag → verification status → catalog-link absence (`'eligible'` default). Exclusion checks (identity-ambiguity, exclusion flags, anti-cheat) always run first and independently of verification/provenance, per Step 4/12.

## 13. Unknown/missing-evidence behavior
Absent `antiCheat`, `catalogExclusionFlags`, `explicitlyUnsupported`, or `identityAmbiguous` fields behave identically to their explicit `'unknown'`/`false`/empty-array equivalents (unit-tested — item 26). No evidence never resolves to `'verified'` or `'supported'` by default; the true no-evidence fallback (no catalog link at all) resolves to `'eligible'`, the roadmap's least-specific non-excluded state.

## 14. Conflict/ambiguity behavior
`evidence.identityAmbiguous: true` routes to `state: 'excluded'`, `reasonCodes: ['identity-ambiguous']` — conflicting trusted evidence is never resolved by picking the more permissive state (Step 11).

## 15. Canonical-game integration
`buildCanonicalGameForGroup` (`src/core/canonical-games/migration.ts`) now calls `classifyTrainerCatalogEligibility` exactly once per canonical game group, using the group's linked trainer-catalog entry (if any). Classification is never computed per launcher installation. Verified via test: two installations (Steam + GOG) of the same canonical game receive one shared classification, and the excluded state is verified identical regardless of which single launcher installation (Epic) is present.

## 16. Trainer-catalog integration
`catalogGameId`, `verificationStatus`, mod-pack/source metadata, and the Phase 1.7 identity-collision review path (`identity-review.ts`, `upsertCatalogEntryWithIdentityReview`) were not modified. No catalog IDs were mass-rewritten. New evidence fields (`antiCheat`, `offlinePlayAvailable`, `catalogExclusionFlags`, `explicitlyUnsupported`) were added as purely additive optional fields on `TrainerCatalogEntry`.

## 17. Catalog exclusion boundary
Applied at the query/result layer in `src/core/trainer-catalog/store.ts`'s `searchCatalog()` — the single function every current UI path (Trainer Library page, via the `trainer-catalog-search` IPC channel) uses to retrieve catalog entries. `filterEligibleForTrainerLibrary()` runs on every result set before it is returned, so excluded titles cannot re-enter through search, category filters, or verification-status filters (all of which funnel through this one function). `getCatalogEntry()` (single-ID lookup, used for admin/detail paths, not list rendering) intentionally still returns the raw entry unfiltered.

## 18. Data-retention behavior for excluded rows
No catalog rows are deleted or mutated by classification. `catalog_exclusion` evidence is stored as ordinary optional columns on the existing `trainer_catalog_games` row; an excluded title's full record remains queryable via `getCatalogEntry()` for future rule changes or review — only its presence in `searchCatalog()` result sets is suppressed.

## 19. Reason codes
`anti-cheat-protected-multiplayer`, `protected-online-only`, `mmo`, `competitive-online-only`, `no-meaningful-offline-play`, `cloud-only`, `dedicated-server`, `demo`, `soundtrack`, `editor-tool`, `dlc-only`, `unsupported-delisted`, `explicitly-unsupported`, `identity-ambiguous` — all derived directly from `ROADMAP.md` §3.2's exclusion list plus the authorization's Step 14 examples. No speculative reasons were added. A title can carry multiple reason codes simultaneously (array).

## 20. User-facing label mapping
`ELIGIBILITY_STATE_LABELS` (six states) and `describeExclusionReason(code)` (per-reason-code human text) added to `eligibility-classification.ts`, reusable by later Phase 3 slices. No filters/sorting UI was built against this mapping in this slice.

## 21. Existing Trainer Library integration changes
None required to the renderer. `TrainerLibraryPage.tsx` retrieves entries exclusively through `trainerCatalogSearch` → `searchCatalog()`, which is now filtered at the source — no entry the UI ever receives can be an excluded title, so no badge/label change was needed to avoid misrepresenting an excluded title as supported. Documented per Step 20's explicit allowance rather than inventing visual work.

## 22. Real catalog classification counts
Read-only assessment run against an isolated `SOLITH_TEST_USER_DATA_PATH` fixture DB (never the live/real database), seeding the full real bundled catalog (43 games from `BUNDLED_COMMUNITY_GAMES`) plus 7 synthetic evidence fixtures covering every rule branch (single-player-only, offline+protected-multiplayer, protected-online-only, unknown-safety, explicit-unsupported, verified-but-excluded/MMO, community-otherwise-eligible):

```
TOTAL_CATALOG_GAMES: 50
STATE_COUNTS: {"eligible":0,"listed":0,"community":45,"verified":1,"unsupported":1,"excluded":3}
```
All 43 real bundled games classify `community` (their actual `verificationStatus`) with zero exclusion evidence — expected and correct, since **no anti-cheat/exclusion evidence exists anywhere in the current bundled catalog data** (confirmed by direct inspection of `bundled-community-games.ts`). This is not a defect; it is the honest, evidence-driven outcome Step 8 explicitly permits.

## 23. Reason-code counts
```
REASON_CODE_COUNTS: {"anti-cheat-protected-multiplayer":1,"protected-online-only":1,"explicitly-unsupported":1,"mmo":1}
AMBIGUOUS_OR_CONFLICTING: 0
```
Each count traces to exactly the synthetic fixture designed to trigger it — no unexpected exclusions occurred among the 43 real bundled titles.

## 24. Exact files modified
- `src/core/trainer-catalog/types.ts` — added `AntiCheatStatus`, `CatalogExclusionFlag` types and four optional evidence fields on `TrainerCatalogEntry`
- `src/core/trainer-catalog/store.ts` — persist/read the four new evidence columns; apply `filterEligibleForTrainerLibrary` in `searchCatalog()`
- `src/core/canonical-games/migration.ts` — replaced hardcoded `eligibility: 'listed'` with real `classifyTrainerCatalogEligibility` output
- `src/core/database/index.ts` — additive idempotent `ALTER TABLE trainer_catalog_games ADD COLUMN` for `antiCheat`, `offlinePlayAvailable`, `catalogExclusionFlagsJson`, `explicitlyUnsupported` (same pattern as the existing `optionalGameColumns`/`trainer_mod_packs` migrations)
- `package.json` — added the new test file to the `test` script's file list

## 25. New files created
- `src/core/trainer-catalog/eligibility-classification.ts` — the classification module
- `tests/trainer-catalog-eligibility-classification.test.ts` — 27 focused tests

## 26. Focused classification tests
9 basic-state/unknown-evidence tests — all pass (see item 8/13).

## 27. Anti-cheat exclusion tests
6 tests covering: offline-only not excluded, offline+protected-multiplayer excludes entire game, protected-online-only excludes, unknown status not silently supported, field-absent equivalence, plus 10 parameterized catalog-exclusion-flag tests (one per §3.2 category) — all pass.

## 28. Canonical/multi-launcher tests
3 tests: Steam+GOG same classification (one canonical game, two installations, no duplicate eligibility records), excluded classification identical regardless of which single launcher installation exists, no-catalog-link defaults to `'eligible'` — all pass.

## 29. Verification-state separation tests
2 tests: verified provenance does not grant automatic safety clearance (still excludable), community provenance does not imply automatic unsupported/excluded — both pass.

## 30. Eligible-dataset exclusion tests
2 tests: excluded game omitted from `filterEligibleForTrainerLibrary` output; an excluded game cannot re-enter by wrapping the filter (double-filter idempotence) — both pass. Plus 1 identity-ambiguity conflict test.

## 31. Fixture results
See item 22/23 — isolated `SOLITH_TEST_USER_DATA_PATH` fixture DB, never the live/real database. Temporary script (`tmp-phase3a-catalog-assessment.ts`) and its scratch DB directory were both deleted after use and deletion confirmed via `ls` returning "No such file or directory."

## 32. Rendered verification if applicable
Not applicable — no renderer code was changed (see item 21). Documented per Step 20 rather than inventing visual work.

## 33. Accessibility checks if applicable
Not strictly required since no renderer changed, but run anyway as a safety regression check: `npm run test:accessibility` — **8/8 PASS**, including axe-core against Trainer Library specifically.

## 34. `npm audit`
0 vulnerabilities (0 info/low/moderate/high/critical across 517 total dependencies).

## 35. Full `npm test`
**1197/1197 PASS** (1170 pre-existing + 27 new Phase 3A tests) + **10/10 PASS** (`sql-parameter-binding.test.ts`, run as a separate `&&`-chained step in the same script).

## 36. `test:live-memory`
**257/257 PASS**.

## 37. Main TypeScript
PASS (`npx tsc --noEmit -p tsconfig.json`, exit 0).

## 38. Electron TypeScript
PASS (`npx tsc --noEmit -p tsconfig.electron.json`, exit 0).

## 39. Vite build
PASS.

## 40. Electron build
PASS.

## 41. Electron output verifier
**29/29 PASS**.

## 42. Packaged smoke if run
Run because the catalog-search data path (reachable via the existing `trainer-catalog-search` IPC channel) was modified: `npm run dist:dir` succeeded, `npm run test:packaged-smoke` — **23/23 PASS**.

## 43. Relevant E2E
- `test:walkthrough-e2e` — **3/3 PASS**
- `test:electron-e2e` (Gate 13 repeatability) — **4/4 PASS**
- Game Library E2E (`game-library-launcher-identity.e2e.test.ts` + `game-library-responsive.e2e.test.ts`) — **6/6 PASS** (regression check, unrelated to this phase's scope but confirmed unaffected)
- `trainer-catalog-search.test.ts` (genre/verification filter combinations) — **3/3 PASS**, confirming the new exclusion filter does not alter existing filter behavior when no exclusion evidence is present
- `trainer.e2e.test.ts` — **1 failure** (see item 48; pre-existing, unrelated to this phase)

## 44. `git diff --check`
Clean — no output (only benign CRLF-conversion advisories were present and are excluded from this check's failure criteria).

## 45. Final dirty-tree count
70 = 63 pre-existing (61 baseline + 2 prior-authorization reports) + 7 Phase 3A paths.

## 46. Phase 3A-only changed-file list
```
M  package.json
M  src/core/canonical-games/migration.ts
M  src/core/database/index.ts
M  src/core/trainer-catalog/store.ts
M  src/core/trainer-catalog/types.ts
?? src/core/trainer-catalog/eligibility-classification.ts
?? tests/trainer-catalog-eligibility-classification.test.ts
```
(Plus this report file itself, once written.)

## 47. Confirmation no Popular/All Games/ranking/filter UI was implemented
Confirmed. No changes were made to `TrainerLibraryPage.tsx`'s rendering, sorting, filtering UI, or the Trainer Library grid/layout. No ranking, Popular list, All Games redesign, or new filter controls exist anywhere in the diff. `git diff --stat` for this phase touches only the seven files listed in item 46, none of which are UI-layout files except the non-visual store/migration/type modules.

## 48. Remaining limitations
- **No real anti-cheat/multiplayer/exclusion evidence exists in the current bundled catalog.** The classification foundation is fully implemented and tested, but until a future phase sources real per-game anti-cheat/online-mode data (curated manually or via a trusted provider — likely alongside Phase 5's ranking/catalog pipeline), the entire current 43-game bundled catalog will classify `community`/`verified`/`listed` with zero exclusions, which is the correct, honest behavior given the evidence available today — not a defect.
- **`searchCatalog()`'s `total` count is computed via `SELECT COUNT(*)` before the exclusion filter applies**, so `total` and `entries.length` could theoretically diverge once real exclusion evidence exists and pagination is in play. Currently a no-op risk (no persisted evidence causes any exclusion today), but noted as a follow-up for whichever future slice first populates real exclusion data — likely wants SQL-level filtering or a corrected count.
- **`trainer.e2e.test.ts` has one pre-existing failure** (`.solith-top-banner__title` selector not found — confirmed via `git status --short` that neither `SolithTopBanner.tsx`, `index.css`, nor `trainer.e2e.test.ts` were touched by this or any prior phase in this session; the class simply does not exist in current source, only `__full`/`__canvas`/`__backdrop`/`__shade`/`__brand`/`__emblem`/`__copy` do). This is a stale test/component drift issue unrelated to Phase 3A and out of this authorization's scope — flagged for a future authorization, not fixed here to avoid scope creep.
- `CanonicalGameSupportState` (`supported`/`partial`/`unsupported`/`unknown`) remains untouched, still derived solely from `hasModPack` — intentionally out of scope per the Step 4 axis-separation requirement.

## 49. Phase 3 status after this slice
§3.1 (Support states) and §3.2 (Catalog exclusion rules) classification foundation: **implemented and verified**. §3.3 (Default Popular view + ranking), §3.4 (All Games), §3.5 (Sorting), §3.6 (Filters UI) remain **not started** — this slice deliberately did not touch them, per the authorization's explicit scope boundary (Step 22).

## 50. Exact recommended next action
Authorize commit/push of Phase 3A, then re-read `ROADMAP.md` and begin the next bounded Phase 3 Trainer Library slice.
