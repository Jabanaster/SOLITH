# P4-13 — Canonical Execution Convergence — Evidence

Companion to the final report. Baseline: `32a584a68d680c0404165ea9b390945e7053216f` (P4-12 merge, zero drift confirmed at mission start).

## 1. Method

Independently re-confirmed all three P4-12 blockers on current master with three parallel read-only audit passes before any code change (file:line evidence, not trust in the prior audit doc), then implemented the minimum architecture change needed to close each one, with regression tests at every step.

## 2. Blocker A — GameConfig / CheatDefinition / useGameCheatSession

**Before:** every mutating action in `useGameCheatSession.ts` (`writeValue`, `startFreeze`, `tryResolveStableCheat`) called `window.electronAPI.liveMemory*` directly — raw legacy IPC, never `TrainerRuntime`. Re-confirmed by an independent read-only audit this stage with exact file:line citations (`useGameCheatSession.ts:324-383` write, `:776-827` freeze, `:936-948` hotkey — same code path as click).

**Root architectural gap found:** `TrainerRuntime.activateWriteFeature`/`proposeWriteFeature`/`activateFreezeFeature`/`proposeFreezeFeature` only accepted `type: 'toggle'|'write_once'` (write) or `'freeze'` (freeze) — every discovery-required GameConfig cheat is canonically typed `scan_unknown`/`scan_first` (no static AOB/pointer path exists for it, correctly, since none was ever fabricated), so it was structurally impossible to write/freeze a discovery-backed feature through `TrainerRuntime` at all, independent of any renderer wiring.

**Fix — canonical discovery-resolution handoff** (`src/core/trainer-runtime/runtime.ts`):
- New `TrainerRuntime.seedDiscoveredFeatureAddress(featureId, address)`: records an address a legitimate Phase 2 discovery/scan result already confirmed, for `scan_first`/`scan_unknown` features only — refuses (`UNSUPPORTED_ACTION`) any feature with a real static resolution strategy, so a compromised renderer can never redirect a canonical write via a fabricated address on an AOB/pointer-backed feature.
- Widened the write/freeze type gates to also accept `scan_first`/`scan_unknown` — but the existing `if (feature.resolution.state !== 'resolved') resolveFeatureAction(...)` guard is untouched, and `resolveFeatureAction` still fails closed (`TARGET_RESOLUTION_FAILED`) for `scan_first`/`scan_unknown` when not yet seeded. Net effect: a discovery-required feature is writable/freezable **only after** a real discovery result has been seeded — never before, never by fabrication.
- New `trainer-seed-discovered-feature` IPC channel (`electron/trainer-execution-ipc.ts`, schema in `electron/ipc-validation.ts`) exposes this to the renderer via `trainerApplicationService.seedDiscoveredFeature`.

**Bundled canonical coverage was also incomplete** — `src/core/trainer-catalog/bundled-definition-seed.ts` only mapped a pinned/first-12 subset of each game's cheats to a canonical `MemoryFeatureV1` (~16/156 curated cheats total). Fixed: every memory-backed cheat (`valueType !== 'string'`) in every curated memory-scan/hybrid game now gets a canonical `scan_unknown` feature — console-command-only cheats are explicitly excluded (never fabricated as a memory feature).

**Renderer cutover** (`src/app/hooks/useGameCheatSession.ts`): `ensureAttached` now also binds `TrainerRuntime` onto the same live-memory session via `trainerBindRuntime`. `writeValue`/`startFreeze` seed the discovered address then run the real propose → consent → confirm flow through `trainer*` IPC — **no legacy `liveMemory{Propose,IssueConsent,Confirm}Write`/`liveMemoryFreeze*` write/freeze call remains**. A `trainerBindRuntime` failure surfaces as an explicit error on the next write/freeze attempt; there is no fallback to the legacy write path (mission §18). Toggling a cheat off now genuinely rolls back the last confirmed write via `trainerRollbackFeature` (previously a no-op that just forgot local state). Freeze-stop uses `trainerDeactivateFeature`. Unbind (`trainerUnbindRuntime`) is paired with every `liveMemoryDetach`.

**Unchanged by design:** attach (`liveMemoryAttach`/`liveMemoryZeroInputPrepare`) and all discovery/scan calls (`liveMemoryScanFirstAutoMatrix`, `liveMemoryScanNext`, `liveMemoryScanFirstUnknown`, `liveMemoryScanNextFromUnknown`, `liveMemoryReadMany`) — Phase 2 research/scanner infrastructure, explicitly out of this stage's scope per mission framing.

**requiresDiscovery matrix (mission §7):** every curated memory-backed cheat now resolves through the canonical discovery-seed path above; console-command-only cheats (`valueType: 'string'`) are `LEGACY_COMPATIBILITY_ONLY_NOT_EXECUTABLE` (never were memory writes; a separate, unrelated command-execution concern, not part of this bypass). No cheat silently falls back to legacy execution on canonical failure.

## 3. Blocker B — Recipe / src/core/saves/editor.ts

**Confirmed (4th independent audit, after P4-4/P4-10/P4-12):** `Recipe` has its own schema/table/validator/execution stack, reachable from `DiscoveryLab.tsx`/`SaveEditor.tsx`/`TrainerPage.tsx`. A working, independent, *already-live* canonical path also exists: `SaveFieldFeatureV1 → saveFieldToTrainerControl → CatalogTrainerControlsPage.tsx → TrainerHost`.

**Key finding this stage:** `Recipe.gameId` is the user's own game-library entry UUID (`games` table), a different identity space from `catalogGameId` used by canonical `SolithDefinitionV1`/`persistTrainerDefinition` (the curated trainer catalog). Auto-converting every created Recipe into a persisted canonical definition would require inventing new cross-identity-space infrastructure (mapping an arbitrary user game to a `catalogGameId`, or a new per-user-game definition store) — this is Phase 6 Trainer Creator territory, which the mission explicitly forbids starting (§16). Per mission's own escape valve ("if broadening would be substantial, document for re-certification"), this full auto-convergence is disclosed here rather than force-implemented.

**What was fixed (safe, minimal, per mission §14):**
- `src/core/saves/editor.ts` is now backend-only — the `getRecipeById`/`validateRecipeSafety` recipe-safety gating that lived inside `createProposalForEdit`/`dryRunProposal`/`applyProposal` was removed entirely. It moved to a new caller-layer helper, `src/core/recipes/recipe-safety-gate.ts` (`assertRecipeSafeForProposal`), invoked by `electron/main.ts`'s `create-proposal-for-edit`/`apply-proposal` IPC handlers *before* calling into `editor.ts` — identical behavior (a bad `recipeId` is refused at exactly the same two points), one layer higher. `editor.ts` now has zero imports from `src/core/recipes`.
- `DiscoveryLab.tsx`'s `handleCreateRecipe` gained an explicit doc comment disclosing Recipe's identity-space scope and pointing to this document — matching mission §16's "store it as legacy/source data only, not authoritative trainer state" framing.

**Remaining, disclosed gap:** DiscoveryLab's "Save Recipe" flow still writes only to the `recipes` table, not also to a canonical `SaveFieldFeatureV1`. `recipeToSaveFieldFeature()`/`recipesToSaveFieldFeatures()` (`src/core/recipes/canonical-adapter.ts`) remain built, tested, and still uncalled in production. Closing this fully requires the cross-identity-space design work named above — recommended as a dedicated follow-up, not attempted here.

## 4. Blocker C — Canonical execution IPC has no renderer consumer

**Before:** all 14 `trainer-*` channels existed and were tested end-to-end at the backend layer, but had zero call sites in `src/app`, and — a stricter gap the reconfirmation audit found this stage — **zero TypeScript declarations** in `src/types/global.d.ts` at all (a call would not even have typechecked).

**Fixed:** all 14 original wrappers plus the new `trainerSeedDiscoveredFeature` are now declared on `Window.electronAPI` in `global.d.ts`, and `useGameCheatSession.ts` is a real production consumer of 10 of them (`trainerBindRuntime`, `trainerUnbindRuntime`, `trainerSeedDiscoveredFeature`, `trainerProposeWriteFeature`, `trainerIssueWriteConsent`, `trainerConfirmWriteFeature`, `trainerProposeFreezeFeature`, `trainerIssueFreezeConsent`, `trainerConfirmFreezeFeature`, `trainerDeactivateFeature`, `trainerRollbackFeature` — 11 total). `trainerGetRuntimeState`/`trainerExecuteComposite`/`trainerCancelComposite`/`trainerGetTransactionState` remain unconsumed — no production UI currently needs runtime-state polling or multi-feature atomic transactions; wiring them is straightforward follow-on work once such UI exists, not a structural gap.

Source-scan regression proof added: `tests/p4-13-canonical-execution-convergence.test.ts`'s "source-scan" suite reads `useGameCheatSession.ts` and asserts (a) every canonical wrapper name is referenced, (b) no legacy mutation call (`liveMemoryProposeWrite(`, `liveMemoryConfirmWrite(`, `liveMemoryFreezeStart(`, etc.) remains, (c) the Phase 2 discovery/attach calls are still present (proving Phase 2 wasn't accidentally touched).

## 5. TrainerHost write RPC boundary (mission §15)

`host-supervisor.ts`'s `proposeWrite` previously trusted its params (`gameId`/`filePath`/`field`/`currentValue`/`newValue`) as plain typed `string`s with no runtime validation at the boundary — safe today only by its one caller's construction (confirmed unchanged from P4-12's finding). Added `validateWriteRpcParams` directly in `host-supervisor.ts` (no dependency on `electron/ipc-validation.ts`, since this is a plain `src/core` module) — non-empty/bounded-length checks on all five fields, checked before the approved-path gate and before anything is sent to the child process RPC channel. Three new regression tests in `tests/trainer-host/host-supervisor.test.ts`.

## 5a. int64 IPC precision (mission §19)

`requestedValue`/`value` on the canonical write/freeze IPC schemas stay plain `number` everywhere — that mirrors the pre-existing, untouched Phase 2 write primitives (`MemoryManager.proposeWrite`/`proposeFreeze`, `LiveWriteProposal`/`FreezeProposal` in `src/core/live-memory/types.ts`), which are explicitly out of this stage's scope. Fully exact int64 transport end-to-end would require changing those Phase 2 signatures too. What was fixed: an optional decimal-string sibling (`requestedValueBigint`/`valueBigint`) on `TrainerProposeWriteFeatureSchema`, `TrainerProposeFreezeFeatureSchema`, and both composite-transaction action schemas — mirroring the established `LiveMemoryScanFirstSchema.targetValueBigint` convention — validated and round-tripped exactly through the IPC schema layer (`tests/p4-13-trainer-execution-int64.test.ts`, 6/6). It is not yet threaded into the runtime dispatch call. Disclosed, not silently skipped.

## 5b. ModPack conversion-loss reporting (mission §20)

Fixed, no schema/migration change needed. `migrateLegacyUnversionedToV1` now returns `modPackConversionLosses(legacyPack)` instead of a hardcoded `[]`; `TrainerDefinitionProvenance`/`SaveTrainerDefinitionInput` gained an additive, optional `conversionWarnings?: string[]`; both real ModPack→canonical call sites (`legacy-unversioned-migration.ts` and `trainer-catalog/sync/index.ts`) now compute and surface it. The legacy-unversioned path re-derives warnings fresh from the stored raw ModPack JSON on every read — no persistence gap. The sync-write call site's warnings are attached only to that write's own returned record, not to later independent reads of the same row, because `persistTrainerDefinition` stores the already-converted `SolithDefinitionV1`, not the original ModPack — making that durable needs a new `trainer_mod_packs` column and migration, disclosed as out of scope here rather than force-implemented. `tests/p4-4-legacy-adapter-convergence.test.ts` +2 tests, 15/15 pass.

## 5c. Certification fail-open edge hardening (mission §21)

Reproduced and fixed at the writer, not by flipping the global fail-open default. Traced every `hasModPack: true` writer: all but one (`trainer-catalog/sync/index.ts`) always write the `trainer_mod_packs` row (supplying `cert_level` via a correlated subquery) *before* claiming `hasModPack: true`. `sync/index.ts` did it backwards — it set `hasModPack: true` on the identity-review catalog write, then called `persistTrainerDefinition` afterward, and `continue`d past a persist failure — so a persist failure could leave an orphaned catalog row with `hasModPack: true` and an unresolvable `certLevel`, exactly the condition `requiresCommunityExecutionApproval(undefined)`'s fail-open default would silently trust. Fixed by reordering: the identity-review write now claims `hasModPack: false`; a follow-up `upsertCatalogEntry` flips it to `true` only after `persistTrainerDefinition` has actually succeeded. `requiresCommunityExecutionApproval(undefined)`'s own fail-open default was deliberately left unchanged — flipping it would force the community-approval prompt onto nearly the entire curated `CheatDefinition` catalog (only 3 entries in `games.ts` ever set `certLevel`), a real UX regression unrelated to the actual bug. `tests/community-trust.test.ts` +3 tests (documents the intentional default, reproduces the now-fixed orphan condition, proves the fix holds under a simulated persist failure), 6/6 pass.

## 6. Retirement candidates (mission §33, no deletion — owner authorization required)

| Item | Status after P4-13 |
|---|---|
| `GameConfig`/`CheatDefinition` | Compatibility/view-model presentation layer — no longer live execution authority. Its own file header already flags it as such. |
| `useGameCheatSession` | Canonical UI orchestration — real mutation now goes exclusively through `trainer*` IPC. |
| `Recipe` | Import/authoring compatibility shape for user-added-game save editing — not authoritative trainer state; identity-space mismatch with canonical definitions is now explicitly documented. |
| `src/core/saves/editor.ts` | Save backend — pure file-edit mechanics, no Recipe-semantic code. |
| `TrainerHost` | Save execution backend — canonical definitions/dispatch, now with boundary-level param validation. |

## 7. Not attempted this stage (disclosed, not silently skipped)

- **Full Recipe → canonical-definition auto-persistence per user-added game** — requires new cross-identity-space infrastructure (§3 above); Phase 6 Trainer Creator territory.
- **Packaged/real-game execution proof** — this environment has no real game process or interactive display available to exercise a packaged Electron instance end-to-end against a live game. Build + electron-output-verifier (33/33) + full unit/integration regression are the verification actually performed. See final report's Packaged Runtime Proof / Real-Game Proof sections for the explicit disposition.
- **`trainerGetRuntimeState`/`trainerExecuteComposite`/`trainerCancelComposite`/`trainerGetTransactionState`** renderer wiring — no current UI need; the channels are canonical, tested, and typed, just unconsumed.
