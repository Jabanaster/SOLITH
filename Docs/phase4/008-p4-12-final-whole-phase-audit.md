# P4-12 — Final Whole-Phase Convergence & Certification Audit

Baseline: `1f07ac21ca5c895fb09c3ab7087d2b0edef105eb` (origin/master at mission start, zero drift, confirmed via `git fetch`/`git log HEAD..origin/master`). This document is the evidence record for the P4-12 audit; the classification verdict itself is recorded in the final report delivered alongside this doc and in `ROADMAP.md`.

## 1. Method

Five independent read-only audit passes were run in parallel against current source (not against prior Phase 4 evidence docs, which were used only as pointer indexes, never as a source of truth):

1. Trainer-representation re-inventory (independent recount, not reusing the pre-Phase-4 "~23" figure).
2. Legacy-adapter re-audit (ModPack, GameConfig/CheatDefinition, Recipe, GameProfile, Hub, TrainerHost) plus a format-branching search.
3. Security boundary + in-process-injection isolation audit.
4. Open-defect recount + lossiness matrix + certification-semantics audit.
5. A targeted disambiguation pass resolving a direct conflict between passes 1 and 2 over `GameConfig`/`CheatDefinition`.

## 2. Representation recount (current truth, not the old "21/23" figure)

Full table in the audit transcript; summary disposition:

- **CANONICAL_DOMAIN**: `SolithDefinitionV1`/schema.v1 sub-shapes, `CanonicalTrainerRecord`/trainer-storage repository types, `TrainerRuntime` state types, `TrainerApplicationService`, `TrainerCatalogEntry` (catalog metadata, a declared separate concern from trainer definitions), `TrainerHealthRecord` (derived status cache), `DefinitionUpdateQueueRow` (quarantine side table).
- **RUNTIME_DTO**: `RuntimeStateDTO`, `CatalogDefinitionCapabilities`.
- **VIEW_MODEL**: `TrainerControl`/`ControlSafetyStatus` (fed exclusively from schema.v1), `TrainerDeckRow`.
- **ADAPTER_ONLY**: `modPackToSolithDefinition`/`solithDefinitionToModPack` (two-way, lossy, documented), `recipeToSaveFieldFeature`/`recipesToSaveFieldFeatures` (one-way, lossy-with-warning, built but **not wired into any UI**).
- **IMPORT_ONLY / EXPORT_ONLY**: CT-XML importer, UE-Dumpspace importer, PE/memory-diff research exporter.
- **REFERENCE_MODEL**: `RegistryArtifactMetadata`/`CtLibraryIndex` (metadata-only, `executableScripts:false, memoryWrites:false, processAttach:false`), `TrainerReferencePage` (static, hand-curated, non-executing).
- **DEAD**: `GameProfile`/`ProfileControl`/`game-profiles/transform.ts` (superseded, zero production callers outside tests, confirmed via `dual-read-save-controls.ts`'s explicit "Legacy game-profiles fallback removed"), `CheatToggleState` interface/`GameSession` (declared, never constructed).
- **NOT_A_TRAINER_REPRESENTATION**: `RealWorldPilotManifest`, `trainer-host/protocol.ts` RPC framing.
- **RETIREMENT_CANDIDATE, live authority (the headline finding)**:
  - `GameConfig`/`CheatDefinition`/`games.ts` + `useGameCheatSession.ts` + `cheat_toggle_state` table — see §4.
  - `Recipe`/`RecipeSchema`/`src/core/saves/editor.ts` — see §3C.
  - The dormant `upsertModPack()` write primitive (zero production callers, but not deleted — a live footgun if ever re-wired, since it bypasses `upsertDefinitionPayload`'s version-detection/migration).

**Conclusion**: the canonical *backend* (schema, persistence, runtime, application service, execution IPC) is real, singular, and well-tested. Two legacy surfaces still hold genuine, independent, live *execution* authority in the routed application, not just leftover types.

## 3. Legacy-adapter re-audit

**A) ModPack** — COMPATIBILITY-ONLY. All production writes route through `persistTrainerDefinition()`. `upsertModPack()` has zero production callers (test-only). Reads are pure projections via `solithDefinitionToModPack()`.

**B) GameConfig/CheatDefinition** — see §4; independently re-verified as a genuine live authority for the executed portion of the catalog, not merely a presentation projection.

**C) Recipe/`src/core/saves/editor.ts`** — GENUINE, LIVE, DUPLICATED DEFINITION-AND-EXECUTION AUTHORITY. Own zod schema (`RecipeSchema`), own safety validator (`validateRecipeSafety`), own SQLite table, own path-resolution engine, own live-write execution stack (`createProposalForEdit`/`dryRunProposal`/`applyProposal`), reachable today from routed `SaveEditor.tsx`/`TrainerPage.tsx`/`DiscoveryLab.tsx`. The one-way `recipeToSaveFieldFeature()` adapter is built, tested, fail-closed and disclosure-correct (`losses[]`) — but has **zero production callers**. `DiscoveryLab.tsx` presents "Add to Library" (canonical path) and "Save Recipe" (non-canonical path) side by side on the same discovered candidate, with no cross-reference. A save-edit proposal can also be created and applied with **no `recipeId` at all** (`DiscoveryLab.tsx`'s "suggest edits" flow), i.e. completely outside any schema. Confirmed independently for the third time (P4-4, P4-10, this audit) — this is now the phase's longest-standing, most clearly disclosed open item.

**D) GameProfile/ProfileControl** — DEAD, confirmed no competing authority.

**E) Hub** — no direct trainer-definition DB write bypass found; `writeHubDefinition()` routes through `persistTrainerDefinition()`; `trustHubCertification()` forces `requiresApproval`/`requiresOfflineConfirm: true` regardless of remote claims.

**F) TrainerHost** — legitimate separate execution backend (no persisted trainer-definition concept exists inside `trainer-host/`). One disclosed, still-open hardening item: `proposeWrite()` only gates on `isPathApproved`, not schema — safe today only because the sole production caller (`TrainerControlPanel.tsx`) pre-filters on `saveField` presence from the canonical projection; a hypothetical second caller would not inherit that safety. Same conclusion P4-4 and P4-10 both reached.

**Format-branching search**: no occurrence of legacy-format-identity branching was found inside canonical business/runtime logic (`trainer-runtime/`, `trainer-application/`, `trainer-host/` execution code, live-memory feature resolution). All hits are at the designated migration/adapter/compat boundary or are downstream presentation logic. The one real "gap" is structural (Recipe never enters the canonical layer at all), not a branching-pattern violation.

## 4. GameConfig/CheatDefinition disambiguation (resolves a direct conflict between audit passes 1 and 2)

**Verdict: a genuine, independent trainer-definition-and-execution authority for the cheats that actually execute today, in every one of the 7 curated games.**

- No `CheatDefinition` in `games.ts` carries a structural address field — execution is always ID-based on the object shape. This supports the "presentation-only" reading superficially.
- But the one canonical-resolve code path in `useGameCheatSession.ts` (`tryResolveStableCheat`, calling `liveMemoryResolveDefinitionFeature`) is gated by `if (cheat.requiresDiscovery) return false`, and **every memory-backed pinned/hotkey cheat in every curated game has `requiresDiscovery: true`**. That branch is dead in practice for the cheats users actually toggle.
- The operative path is live Cheat-Engine-style value scanning (`discover`/`discoverUnknown`/`narrow*`), where `cheat.id` is used only as scan bookkeeping, never a canonical lookup. The parallel Zero-Input auto-resolve path also fails closed for the same reason (every seeded feature is typed `scan_unknown`).
- `bundled-definition-seed.ts`'s "canonical" definitions are themselves derived *from* `games.ts` (`pinnedCheatsForGame`), not validated independently against it — the dependency direction is backwards from what "canonical" implies. ~140 of 156 `CheatDefinition`s repo-wide have no corresponding `MemoryFeatureV1` at all.
- `cheat_toggle_state` persists `{gameId, cheatId, enabled, confirmedAddress, dataType}` — a user-discovered, live-scan-derived address, independent of `trainer-storage`, surviving restarts, and preferred over any fresh canonical resolve attempt.
- P4-4's own "hotkeys: canonical stable identity" claim (`006-p4-4-legacy-adapter-convergence.md` §4/§6) is correct only as a **string-identity invariant** (`cheat.id === MemoryFeatureV1.id`, regression-locked) — it does not establish that address resolution is ever exercised through the canonical path, and for every curated game today, it demonstrably is not.

This is a real Phase 4 blocker: `useGameCheatSession` reuses P4-10's untouched legacy consent/guard IPC for write *mechanics* (by design — Phase 2 surfaces were deliberately left on that path), but its address *targeting* never touches canonical data for the overwhelming majority of the catalog.

## 5. Security boundary + injection isolation

All nine checked invariants **PASS** with file:line evidence (unknown schema/action/capability fail closed; malformed target fails closed; stale-PID re-verified at every mutation point, not just at attach; protected targets blocked by two independent mechanisms; execution IPC schemas are `.strict()` zod and carry only canonical IDs, never raw addresses; consent is a real, single-use, hash-bound, expiring token with no legacy bypass on the freeze path; no transaction-wide consent bypass in `CompositeTransactionRuntime` — every composite action carries and is checked against its own approval).

In-process-injection isolation: **PASS**. No import of `src/core/in-process-script/` exists anywhere in `trainer-runtime/`, `trainer-application/`, `trainer-execution-ipc.ts`, or the `LiveMemorySession`/`MemoryManager` modules those layers wrap (grepped directly, not inferred from existing tests). `electron/live-memory-ipc.ts` does import `in-process-script` but only inside separate, pre-existing Phase 2 hook/injector IPC handlers, structurally disjoint from the canonical execution path. Existing regression tests only source-text-check two files (`action-executor.ts`, `transaction.ts`); this audit's manual import-graph trace closes that coverage gap for `capabilities.ts`, `feature-runtime.ts`, `trainer-application/*`, and `trainer-execution-ipc.ts` as well — no new test was added since the trace itself, not a missing assertion, was the actual verification method the mission asked for.

## 6. Open-defect recount, lossiness matrix, certification semantics

**Confirmed CLOSED** (re-verified against current source, not just docs): unknown-future-schema-version fail-closed; ModPack write-path convergence (P4-4, chronologically after the P4-9 doc that first flagged it); legacy game-profiles fallback removal; `BEST_EFFORT` composite-transaction mode is correctly unimplemented-and-rejected (no product requirement exists for it).

**Confirmed still open, honestly disclosed across 2-3 independent stages, acceptable to carry forward**: TrainerHost write-call-site schema-blindness (safe today only by the one caller's construction); Recipe/save-edit convergence (§3C); `games.ts`/`ALL_GAMES` static-config retirement (regression-locked against wrong-feature dispatch even though not yet retired).

**Found this audit, not previously disclosed, and fixed in this stage**:
- **YAML export silently zeroed the fingerprint/certification fields.** `export-yaml.v1.ts` hardcoded `executableHashPrefixes: []` regardless of the real definition's value, and never emitted `targetSHA256`, `targetMetadata`, or `certificationLevel` (top-level or per-feature) at all. Because `verifyDefinitionFingerprint()` treats an empty `executableHashPrefixes` + absent `targetSHA256` as `status: 'skipped'`, a definition round-tripped through the real "Trainer Library → Export/Share YAML" feature silently **disabled the executable-drift ("Patch Day Drift") safety check** on re-import, with no warning surfaced anywhere. The YAML importer (`compile-yaml.v1.ts`) already parses these fields generically (it round-trips the full `SolithDefinitionV1Schema`, no per-field hand-rolling) — this was purely an exporter defect, not a format limitation. **Fixed**: `export-yaml.v1.ts` now emits `targetSHA256` (if present), the real `executableHashPrefixes` list, top-level `certificationLevel` (if present), a full `targetMetadata` block (if present), and per-feature `certificationLevel` (if present). New regression test (`tests/definitions-export.v1.test.ts`, "fingerprint/certification fields survive a canonical -> YAML -> canonical round trip") proves full fidelity through a real `serializeDefinitionToYaml` → `compileYamlToDefinition` round trip. `test:definitions` 125/125 (was 124/124), root `tsc --noEmit` clean.

**Found this audit, disclosed but NOT fixed this stage** (judged too large/risky for an audit-scoped mission, or genuinely low current risk):
- **ModPack-conversion loss is computed but never surfaced.** `modPackConversionLosses()` (`mod-pack-adapter.ts`) is unit-tested in isolation but never called from either production ModPack→canonical call site; `migrateLegacyUnversionedToV1()` hardcodes `warnings: []`; and even if it were called, `TrainerDefinitionProvenance` has no field to carry the result. Lower severity than the YAML bug (dropped fields are descriptive metadata — `description`/`tags`/`notes`/`trainerTitle`/`platform` — not a safety fingerprint), but still an undisclosed silent loss. Wiring it correctly requires a new field on `TrainerDefinitionProvenance`/`CanonicalTrainerRecord`, a persistence-layer schema touch outside this audit's minimal-fix remit. Recommend for the next Phase-4-continuation stage.
- **Canonical → ModPack direction** also drops fields (`safety.*`, `targetSHA256`, `targetMetadata`, `provenanceNotes`, feature-type distinctions collapsed to a boolean) with no loss-report function at all (asymmetric with the reverse direction). Same disposition as above.
- **int64 precision over the new execution IPC.** `trainer-execution-ipc.ts`/`ipc-validation.ts` type write/freeze values as plain `number` (`z.number().finite()`), while `MemoryDataType` includes `int64` (up to ~9.2×10^18, past `Number.MAX_SAFE_INTEGER`). The Phase 2 scanner code in the same file explicitly avoids this class of bug (BigInt-as-decimal-string). Currently low real-world risk **because this channel has zero renderer consumers today** (see §7) — but it is a real latent contract defect that will surface the moment the UI is wired to it. Recommend fixing as part of that wiring work, not in isolation.
- **Certification fail-open edge case, unconfirmed reachability.** `requiresCommunityExecutionApproval(undefined)` returns `false` (fail-open for an unknown cert level) rather than `true`. No live code path was found where `hasModPack === true` and `certLevel === undefined` simultaneously (every writer that sets `hasModPack: true` also unconditionally writes a real `cert_level`). Flagged, not fixed — recommend a schema-level `NOT NULL` constraint or explicit `'unknown'` sentinel to close the theoretical gap rather than relying on "every current writer happens to set it."

**Certification semantics — otherwise clean.** No legacy boolean inflates canonical certification (`featureToCheat()` always sets legacy `verified: false` regardless of real `certificationLevel`, deliberately not derived from canonical trust). `pickPreferredRow()`'s conflict resolution is documented and tested as content-specificity ordering, never trust escalation. Regression-tested: `tests/trainer-storage.test.ts` 22-24.

## 7. Execution IPC — the second headline finding

P4-10 built `electron/trainer-execution-ipc.ts` (14 channels), the `TrainerApplicationService` execution methods, and 29 passing unit/integration tests proving the backend chain `TrainerApplicationService → TrainerRuntime → shared LiveMemorySession` works correctly in isolation. **This audit found zero renderer call sites for any of these channels.** `grep`ing all of `src/app` for `trainerBindRuntime`/`trainerProposeWriteFeature`/`trainerExecuteComposite`/etc. (the `preload.ts` wrapper names) returns nothing. The one real, live write/freeze hook in the shipped application, `useGameCheatSession.ts`, still calls the pre-P4-10 legacy `window.electronAPI.liveMemoryProposeWrite`/`liveMemoryIssueWriteConsent`/`liveMemoryConfirmWrite`/`liveMemoryFreeze*` primitives directly — never `TrainerRuntime`.

This does not mean P4-10's own certification was dishonest — its scope was explicitly the backend/IPC-handler cutover ("execution IPC cutover for write/freeze/deactivate/rollback/feature-activation/runtime-state," never claiming a UI rewiring), and its own touched-files list (`007-p4-10-runtime-session-reuse-execution-ipc.md`) confirms zero `src/app/` files were touched, consistent with that scope. But it does mean the phase's own stated objective — "route canonical trainer execution IPC through" the authoritative session, end to end from the renderer — is not yet true in the running application. The canonical runtime exists, is correct, and is thoroughly tested; it has no real caller yet.

## 8. Overall verdict

Per the mission's own §15 framework (Recipe: "acceptable Phase 4 boundary" vs "still a competing trainer-definition authority") and by direct extension to the newly-confirmed `GameConfig`/`useGameCheatSession` finding: both are **(B) — still competing authorities**, not acceptable boundaries, confirmed independently and (for Recipe) three times across three separate stages. Combined with the execution-IPC UI gap in §7, Phase 4's own stated objective — one canonical trainer model *and runtime* actually driving the live application — is not yet fully realized, even though every individual canonical component (schema, migration, persistence, runtime, application service, execution IPC backend, composite transactions) is independently real, correct, and well-tested.

**PHASE 4 — NOT COMPLETE.** See the final report for the itemized blocker list and recommended next stage.
