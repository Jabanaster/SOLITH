# P4-4 — Legacy Adapter Convergence — Evidence

Branch: `feature/solith-phase4-trainer-model`. Baseline HEAD at mission start:
`e1260f57ee28d940ebab1f33b22c9cdbd051a719` (== `origin/master`, zero drift,
confirmed via `git fetch --all --prune` + `git log HEAD..origin/master`).
PR #49 (Phase 2 P2-6 through P2-9) already MERGED at this point — the
GameConfig/CheatDefinition and hotkey convergence sections this mission
required were previously blocked on that merge; the blocker is gone.

## 1. Scope

Mission: converge SOLITH's remaining legacy trainer representations behind
explicit compatibility adapters so canonical `SolithDefinitionV1` definitions
are the only internal domain authority. Legacy formats may remain for
compatibility/import/export/historical/transitional UI — not as competing
truth models. No destructive deletion this stage; retirement candidates only.

## 2. Re-audited legacy representation inventory

Re-audited current master directly (file:line evidence), not the old
23-representation count. Full per-representation evidence (producers,
consumers, classification) is preserved in the four parallel audit
transcripts this mission ran; the table below is the resulting disposition.

| Legacy Representation | Producers | Consumers | Persistence | Runtime Use | UI Use | Canonical Equivalent | Final Disposition |
|---|---|---|---|---|---|---|---|
| `ModPack`/`ModPackCheat` conversion functions (`mod-pack-adapter.ts`) | many import/promotion sites | `store.ts` read paths | transient | narrow (install-match) | none directly | `SolithDefinitionV1` | ADAPTER_ONLY |
| `ModPack` via `remoteTrainerToModPack`+community sync write | `sync/remote-sync.ts`, `sync/index.ts` | — | **was** direct JSON row | narrow | none | `SolithDefinitionV1` | **CONVERGED this stage** (was RETIREMENT_CANDIDATE) |
| `getModPackForGame()` conflict resolution | `store.ts` | `install-discovery/match.ts`, `mod-pack-loader.ts` | read-only | yes | indirect (via GameConfig) | `pickPreferredRow` | **CONVERGED this stage** (was naive `syncedAt LIMIT 1`) |
| `parseModPackPayload()` | `store.ts` (module-private) | `getModPack`/`getModPackForGame` only | n/a | n/a | n/a | n/a | Already non-exported — P4-9's flagged leakage confirmed already closed |
| `GameConfig` (catalog-driven, `mod-pack-loader.ts`) | `modPackToSolithDefinition`-adjacent projection | cheat-session UI/runtime | projection, not persisted | yes (session/hotkey UX) | yes | `SolithDefinitionV1` | VIEW_MODEL |
| `GameConfig`/`CheatDefinition` (`ALL_GAMES`, `games.ts`) | static literals | seeds `bundled-definition-seed.ts`, cheat UI | no (seed source) | indirect | yes | `SolithDefinitionV1` (seed target) | RETIREMENT_CANDIDATE (file's own header already documents this; seeding relationship locked with a regression test this stage) |
| `CheatDefinition` (`cheat-system/types.ts`) | `games.ts`, `mod-pack-loader.ts` | `useGameCheatSession.ts`, hotkey slots | no | yes | yes | `MemoryFeatureV1` | RUNTIME_DTO — `cheat.id === MemoryFeatureV1.id` invariant now locked by regression test (was previously unenforced) |
| `CheatDefinition`/`PALWORLD_CHEATS` (`live-memory/palworld-cheats.ts`) | itself | **none** (zero importers found) | no | no | no | n/a | RETIREMENT_CANDIDATE — dead code, safe to delete on owner authorization |
| Persisted hotkey key-bindings (`trainerHotkeyBindings`, action→accelerator) | `electron/trainer-hotkeys.ts` | `globalShortcut` registration | yes (settings table) | yes | yes | n/a (key-binding, not feature identity) | Unaffected — this table never stored feature identity to begin with |
| Hotkey slot→feature targeting (`cheat-hotkey-slots.ts`) | derived live from `games.ts` | `useGameCheatSession.ts` dispatch | not persisted separately | yes | yes | `MemoryFeatureV1.id` | **RESOLVED (locked this stage)** — see §4 |
| `TrainerControl` (`trainer-host/trainer-control-schema.ts`) | `definition-to-trainer-controls.ts` | `TrainerControlPanel.tsx`, TrainerHost IPC | n/a | yes | yes | itself is canonical | RUNTIME_DTO, no change needed |
| `TrainerHostSupervisor` propose/approve/rollback RPC | `electron/main.ts`, `trainer-host/*` | save-edit UI | n/a | yes | yes | field validated against `SaveFieldFeatureV1.mapping` only at the one-shot UI-build step | LEGITIMATE_SEPARATE_BACKEND (RPC/file-IO mechanics) but **DEFER_TO_RUNTIME_IPC_CUTOVER** for wiring canonical-definition validation into the write call site itself — this is exactly P4-10's stated scope (`TrainerApplicationService → TrainerRuntime` execution IPC), not safely re-doable as a side effect of this stage |
| `Recipe`/`RecipeSchema`/`RecipeItem` (`src/core/recipes/`) | `DiscoveryLab.tsx` "Create Recipe", `Recipes.tsx` | `TrainerPage.tsx`, `src/core/saves/editor.ts` | own SQLite table | yes (real live-write execution) | yes | `SaveFieldFeatureV1` (partial overlap) | RETIREMENT_CANDIDATE — confirmed genuine duplicated definition authority (see §5); one-way adapter built this stage, UI convergence deferred (see §5) |
| `TrainerItem` (recipe-derived UI DTO) | `src/core/recipes/index.ts` | `TrainerPage.tsx`, `ApplyDialog.tsx`, `TrainerCard.tsx` | no (transient) | yes | yes | `TrainerControl` plays the equivalent canonical role | RUNTIME_DTO, retire together with `Recipe` |
| `src/core/saves/editor.ts` (SaveEdit/Proposal/operation state machine) | `electron/main.ts` (`parse-save`/`create-proposal-for-edit`/`apply-proposal`) | `SaveEditor.tsx` | own tables (proposals/backups) | yes (real live-write execution) | yes | none — a fourth, independent save-edit stack discovered this stage | RETIREMENT_CANDIDATE — tied to Recipe; flagged as a new finding not named explicitly in the mission text but squarely in scope |
| `GameProfile`/`ProfileControl` (`game-profiles/`) | `game-profiles/catalog.ts` (bundled support-matrix metadata) | `support-matrix.ts` (compliance report), dead `transform.ts` | in-memory catalog, no DB | **no** (execution path already dead — `dual-read-save-controls.ts`'s `loadStardewProfileControls()` is `@deprecated`, always returns `[]`) | no (report only) | none needed for support-matrix fields | RETIREMENT_CANDIDATE (control-execution path) / NOT_A_TRAINER_REPRESENTATION (support-matrix fields — legitimate, no canonical equivalent, kept) |
| `hub-client.ts` direct write (`writeHubDefinition`) | Solith Hub sync | catalog/definition read paths | **was** raw `upsertDefinitionPayload` + manual transaction | yes | yes | `SolithDefinitionV1` via `persistTrainerDefinition` | **CONVERGED this stage** (was RETIREMENT_CANDIDATE) |
| `HubDefinitionSchema`/`HubSyncResponseSchema` (wire contracts) | Solith Hub backend | `hub-client.ts` | n/a | n/a | n/a | n/a | EXTERNAL_FORMAT — legitimate wire contract, unchanged |

## 3. ModPack / hub write-path convergence

Two direct, non-canonical writers of `trainer_mod_packs` were found and
converged this stage:

1. **Community sync** (`src/core/trainer-catalog/sync/index.ts`,
   `remote-sync.ts`) previously called `upsertModPack()`, writing
   `JSON.stringify(ModPack)` directly — a real `ModPack`-shaped row that only
   became canonical lazily, on read, via `migrateRow()`'s legacy-unversioned
   migration path. Now: `remoteTrainerToModPack()` still builds the scrape
   transport shape (unchanged, its own tested contract), then
   `modPackToSolithDefinition()` compiles it to `SolithDefinitionV1`, and the
   result is written through `persistTrainerDefinition()` — validate →
   transaction → verify-read-back → source-suffixed packId
   (`${id}-pack-${sourceProvider}`), the exact contract every other P4-9-era
   writer already has.

2. **Hub sync** (`src/core/trainer-catalog/sync/hub-client.ts`,
   `writeHubDefinition()`) previously ran its own `db.run('BEGIN')` transaction,
   its own `upsertDefinitionPayload()` call keyed by the opaque hub record id
   as `packId`, and no post-write verification. `persistTrainerDefinition()`'s
   `SaveTrainerDefinitionInput` gained three new optional fields —
   `syncedAt`, `certLevel`, `remoteUpdatedAt` — used only when a caller has a
   remote-authoritative source of truth (currently only this one). Every
   other existing caller is unaffected (fields omitted, defaults unchanged
   byte-for-byte). `writeHubDefinition()` now calls `persistTrainerDefinition()`
   directly; the packId convention changes from the opaque hub record id to
   the deterministic `${id}-pack-solith-hub` scheme. `trustHubCertification()`
   (forces `requiresApproval`/`requiresOfflineConfirm: true` regardless of
   remote claims) is unchanged, so certification is never inflated by this
   convergence.

3. **`getModPackForGame()`** (`store.ts`) previously picked
   `ORDER BY syncedAt DESC LIMIT 1` — "whichever row happened to sync most
   recently." Now uses `listModPackRowsForGame()` + the same
   `pickPreferredRow()` conflict-resolution the canonical repository uses
   (`user > ct-import > solith-hub > community listings > bundled`), so a
   stale community re-sync can no longer outrank a user's own edit for the
   two production callers (`install-discovery/match.ts` fingerprint
   disambiguation, `mod-pack-loader.ts` → `GameConfig` for the renderer).

## 4. Hotkey canonical identity (§7/§8)

**Investigated conclusion differs from the initial parallel-audit verdict.**
The audit pass first classified hotkey targeting as **UNRESOLVED** (slot→cheat
via array index, no persisted stable-id binding). Deeper investigation found:
`cheat-hotkey-slots.ts`'s `cheatsForHotkeySlots()` and
`bundled-definition-seed.ts`'s `pinnedCheatsForGame()` select from the
**identical static source** (`game.pinnedCheatIds` / `game.cheats`, both
hardcoded in `games.ts`, never user-persisted) using the **identical**
pinned-or-first-12 algorithm. That means the cheat occupying hotkey slot N is,
by construction, always the same cheat whose `id` seeds the canonical
`MemoryFeatureV1.id` for that game — there is no scenario today where a
hotkey resolves to the wrong canonical feature, because both the slot
assignment and the canonical seed read the same array in the same order.

Revised verdict: **RESOLVED-BY-CONSTRUCTION**, not a persisted-and-needing-
migration binding (there is no separate persisted slot→feature table to
migrate — the only persisted hotkey state is the action→accelerator keymap,
which carries no feature identity at all). What was missing was an
*enforced* invariant, not a working mechanism. This stage adds two
regression locks (`tests/p4-4-legacy-adapter-convergence.test.ts`):

- Every hotkey-slot-addressable cheat id has a matching canonical
  `MemoryFeatureV1.id` in that game's bundled definition, for every curated
  memory-scan/hybrid game.
- `cheatsForHotkeySlots()`'s output order matches the pinned/first-12
  selection exactly, for every curated game — so a future edit to
  `cheat-hotkey-slots.ts` or `bundled-definition-seed.ts` that silently
  breaks the shared-selection coupling fails a test immediately instead of
  drifting unnoticed.

No new binding schema, no persisted migration, and no hotkey UI changes were
needed — existing conflict detection (`trainer-hotkeys.test.ts`,
`trainer-hotkey-bindings.test.ts`, part of `test:definitions`) is untouched
and still green.

## 5. Recipe / TrainerItem convergence — adapter built, UI convergence deferred

Confirmed (independent audit, file:line evidence): `Recipe` is a genuine
parallel definition authority. The **same** `DiscoveryLab.tsx` candidate can
become either a `Recipe` row (`src/core/recipes/index.ts:289`, "Create
Recipe" button) or a canonical `SolithDefinitionV1.saveEditor.saveFields[]`
entry ("Add to Library" button) — two independently-persisted, independently
live-write-executing stacks (`src/core/saves/editor.ts`'s `applyProposal()`
vs `src/core/trainer-host/write-save-field.ts`), with no cross-reference
between a `recipes.id` and any `SolithDefinitionV1.id`.

**Built this stage**: `src/core/recipes/canonical-adapter.ts` —
`recipeToSaveFieldFeature()` / `recipesToSaveFieldFeatures()`, a pure,
one-way `Recipe → SaveFieldFeatureV1` adapter. Classification:
**LOSSY_WITH_WARNING** — `SaveFieldFeatureV1` has no equivalent for the
majority of `Recipe`'s fields (`source`, `target`, `risk`, `requiresBackup`,
`confidence`, `adapterId`/`adapterVersion`, `targetStrategy`,
`minimum`/`maximum`/`allowedValues`/`step`, `validationRules`,
`preconditions`, timestamps, etc.) — every one is reported in the result's
`losses` array, never silently dropped. A `Recipe` with no usable field path
fails closed (`recipe_has_no_field_path`) rather than fabricating a mapping.
Batch conversion collects per-recipe failures without aborting the batch.

**Deliberately not done this stage**: wiring this adapter into
`DiscoveryLab.tsx`'s "Create Recipe" button, `Recipes.tsx`, or
`TrainerPage.tsx` — i.e. actually retiring the second live execution path.
That is a real UI/execution-surface change (removing or rerouting a button
users click today, on a stack this audit newly discovered has its *own*
backup/risk/apply state machine, `src/core/saves/editor.ts`, distinct from
TrainerHost's) and deserves its own dedicated, tested stage rather than a
blind cutover appended to an already-large convergence pass. This mirrors
P4-9's own precedent (the deferred `TrainerRuntime`/session-reuse cutover,
now P4-10) — the deferral is disclosed, not silently dropped from scope.

## 6. GameConfig / CheatDefinition canonical projection (§6)

`useGameCheatSession.ts` (the real, live cheat-execution hook) already
resolves live-memory addresses via
`liveMemoryResolveDefinitionFeature({ catalogGameId, featureId: cheat.id })`
— i.e. `GameConfig`/`CheatDefinition` govern *what* appears in the UI and
*which* slot/hotkey it occupies, while the *address resolution* is already
canonical, keyed by `cheat.id` treated as a canonical `MemoryFeatureV1.id`.
That equality (`cheat.id === MemoryFeatureV1.id`) was true by construction
(both seeded from the same `games.ts` literals via
`bundled-definition-seed.ts`) but previously unenforced. This stage adds a
regression test (§4 above) that locks it directly. `games.ts`'s own header
already documents `ALL_GAMES` as non-authoritative for execution
("Phase 4: capability execution is schema.v1-only... Do NOT add new titles
here as the execute SoT") — that stays a `RETIREMENT_CANDIDATE`, unchanged
this stage (no code moved, no behavior changed, only the invariant proved).

## 7. GameProfile / ProfileControl (§11)

Confirmed already effectively retired: `dual-read-save-controls.ts`'s
`loadStardewProfileControls()` is explicitly `@deprecated` and always returns
`[]` — no live save-edit resolution reads `GameProfile`/`ProfileControl`
anymore. `game-profiles/transform.ts`'s `profileControlToTrainerControl()`
adapter is dead code (no caller outside its own tests). The
`GameProfileCatalogEntry` support-matrix fields (`supportStatus`,
`parserStatus`, `evidenceLevel`, `localOnly`/`offlineOnly`/`singlePlayerOnly`)
are legitimate compliance/reference metadata with no canonical equivalent and
are retained as-is (`NOT_A_TRAINER_REPRESENTATION`). A regression test
confirms the dead adapter still type-checks/executes standalone (an inert,
safe compatibility shape, not a dangling reference to something already
removed).

## 8. Trainer Host boundary (§17)

`TrainerHostSupervisor`'s propose/approve/rollback RPC pipeline
(`electron/main.ts`, `src/core/trainer-host/*`) is confirmed
**schema.v1-blind at the write call site** — it operates purely on
`{gameId, filePath, field, currentValue, newValue}` strings; canonical
`SaveFieldFeatureV1` identity (id, dataType, mapping) is only consulted once,
at the one-shot `definition-to-trainer-controls.ts` UI-build step, and never
carried through to the actual write RPC. The process/RPC/file-IO mechanics
themselves are a legitimate, intentionally separate execution backend per
the mission's own target diagram (§17) — the gap is that nothing currently
prevents `trainer-host-propose-write` from being invoked with a `field`
string that was never validated against any `SaveFieldFeatureV1.mapping`.

**Disposition: DEFER_TO_RUNTIME_IPC_CUTOVER.** Closing this gap means
threading canonical-definition awareness through the write RPC boundary
itself — exactly the kind of live-IPC surface change P4-10 (§8 of the
completion-sequence prompt: "Route canonical trainer execution through
`TrainerApplicationService → TrainerRuntime`... for writes") is explicitly
staged to do, with its own session-ownership and IPC-trust design work. Two
regression tests are added this stage instead: `solithDefinitionToTrainerControls()`
correctly dispatches a canonical save field to the save backend (mission test
26), and a `memoryFeatures` entry — even given an id that collides with a
real save field's id — never appears among TrainerHost-dispatchable controls,
because `solithDefinitionToTrainerControls()` structurally never reads
`memoryFeatures` at all (mission test 27). This proves the memory/save-field
split is real and enforced at the one layer that currently has canonical
awareness, without attempting the riskier write-call-site change out of
scope for this stage.

## 9. Retirement ledger (§20 — no destructive deletion performed)

| Legacy Component | Remaining Consumers | Adapter Exists | Runtime Needed? | Safe Retirement Candidate? | Delete Now? |
|---|---:|---:|---:|---:|---:|
| `remoteTrainerToModPack`+`upsertModPack` direct write | 0 (converged to `persistTrainerDefinition` this stage) | Yes (`modPackToSolithDefinition`) | No | Yes | NO |
| `hub-client.ts` manual transaction/write | 0 (converged this stage) | Yes (`persistTrainerDefinition`) | No | Yes | NO |
| `ALL_GAMES`/`games.ts` static configs | `bundled-definition-seed.ts` (seed source), cheat-session UI/hotkeys | Yes (`bundled-definition-seed.ts`) | Yes, until UI is re-pointed at canonical definitions directly | Yes, pending a UI-layer follow-up | NO |
| `CheatDefinition`/`PALWORLD_CHEATS` (`live-memory/palworld-cheats.ts`) | 0 | n/a | No | Yes | NO |
| `game-profiles/transform.ts` (`profileControlToTrainerControl`, `loadTrainerControls`) | 0 (tests only) | n/a (dead) | No | Yes | NO |
| `Recipe`/`RecipeSchema`/`TrainerItem` + `src/core/saves/editor.ts` | `DiscoveryLab.tsx`, `Recipes.tsx`, `TrainerPage.tsx` | Yes, one-way, built this stage (`canonical-adapter.ts`) | Yes — still the only live execution path for these UI surfaces | Pending UI convergence stage (not this one) | NO |
| `TrainerHostSupervisor` write-call-site (no canonical validation) | live TrainerHost RPC | Partial (UI-build step only) | Yes | Pending P4-10 | NO (not a deletion candidate — this is the live execution backend) |

## 10. Certification semantics (§13)

No new certification-inflation path was introduced. Hub convergence
(`persistTrainerDefinition`) uses the hub's own `certLevel` verbatim
(`L0_Community`/`L3_Certified`, unchanged from before) and
`trustHubCertification()` still forces `requiresApproval`/
`requiresOfflineConfirm: true` regardless of remote claims — verified by a
new test (`Hub write convergence`, mission tests 22-25). Community-sync
ModPack rows keep `verificationStatus: 'community'` end to end (verified by
the "no certification inflation" assertion in the ModPack write-path test).
`definition-promotion.ts`'s cross-source-safe promotion (fixed in P4-9,
re-verified green this stage via the full `test:trainer-application` suite)
is unchanged.

## 11. Tests added this stage

`tests/p4-4-legacy-adapter-convergence.test.ts` (new, `npm run
test:p4-4-legacy-adapters`) — 12 tests across 9 describe blocks: ModPack
sync write-path convergence, lossy-field reporting, `getModPackForGame`
conflict resolution, GameConfig/CheatDefinition canonical-id invariant,
hotkey slot/canonical-seed coupling invariant, GameProfile dead-adapter
lock, Recipe adapter (valid mapping / fail-closed / warnings / batch
partial-failure), Trainer Host memory/save-field boundary, hub write
convergence (provenance/certification/timestamps).

`tests/hub-sync.test.ts` — one existing assertion updated
(`getDefinitionSyncMetadata` now looked up by the new deterministic
`${id}-pack-solith-hub` packId instead of the opaque hub record id); all 8
tests in the file still pass.

## 12. Regression evidence

| Suite | Result |
|---|---|
| `npx tsc --noEmit` (root) | Clean |
| `npx tsc -p tsconfig.electron.json --noEmit` | Clean |
| `tests/p4-4-legacy-adapter-convergence.test.ts` | 13/13 |
| `tests/hub-sync.test.ts` (+ p4-4 file together) | 21/21 combined |
| `npm run test:trainer-catalog` | 206/206 |
| `npm run test:definitions` | 124/124 |
| `npm run test:trainer-storage` | 34/34 |
| `npm run test:trainer-application` (P4-9 regression) | 5/5 |
| `npm run test:game-profile` | 49/49 |
| `npm run test:install-discovery` | 126/126 |
| `npm run test:v1` | all green (exit 0, two chained suites) |
| `npm test` (full project regression suite) | see final report |

## 13. Scope discipline

No files touched outside: `src/core/trainer-storage/{types,repository}.ts`,
`src/core/trainer-catalog/{store,sync/index,sync/hub-client}.ts`,
`src/core/definitions/mod-pack-adapter.ts`, `src/core/recipes/canonical-adapter.ts`
(new), `package.json`, `tests/hub-sync.test.ts`,
`tests/p4-4-legacy-adapter-convergence.test.ts` (new), this doc. No Phase 2
scanner/memory-map/inference/hotkey-IPC internals touched. No hotkey UI
changed. No Recipe/ModPack/CT/`games.ts` files deleted. No big-bang UI
rewrite.
