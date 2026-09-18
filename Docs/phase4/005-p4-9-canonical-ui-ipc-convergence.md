# P4-9 — Canonical UI / IPC Convergence

## Baseline

- Starting master (after PR #49 merge + docs-SHA-record follow-up): `204407af484a5dee9f89b6674cb22224346c40c9`
- Branch: `feature/solith-phase4-trainer-model`
- Worktree: `G:\ACTIVE_PROJECTS\solith-phase4-trainer-model`
- PR #49 status at mission start: **MERGED** (P2-6 through P2-9 all certified — the DO THIS.MD mission text was written slightly before this landed; confirmed live via `gh pr view 49` before any work began)

## Scope decision (read this before the rest of the doc)

The pre-implementation audit found three independent write/execution pipelines for trainer content:

1. `src/core/trainer-runtime` (P4-5 lifecycle) + `src/core/trainer-runtime/transaction.ts` (P4-7 composite) — fully built, fully tested, **zero production callers**.
2. `electron/live-memory-ipc.ts`'s propose-write / confirm-write / freeze-start / freeze-stop / rollback channels — the actual live, working, real-process-tested execution pipeline, calling `MemoryManager`/`LiveMemorySession` directly.
3. `electron/main.ts`'s `trainer-host-*` channels — a third, save-file-field-scoped propose/approve/rollback pattern (`TrainerHostSupervisor`), schema.v1-blind.

Cutting (2) over to be driven by (1) is what mission §11/§12 ask for. Investigating it (`TrainerRuntime.bind()` calls `capabilities.attach()`, which is `LiveMemorySession.attach()`) showed that a safe cutover requires the runtime to bind against the **same already-attached session** a game is live on, not re-attach — `live-memory-attach` already gates the initial attach with fingerprint/consent, and `TrainerRuntime.bind()` performs its own compatibility-check-then-attach sequence with no session-reuse seam today. Building that safely, and proving it against a real game process, is substantial dedicated work in its own right, not a mechanical "point IPC at the existing runtime" change.

Given that risk profile and the mission's own constraints (§29 "no big-bang UI rewrite", §30 preserve existing workflows), **this stage does not cut over live single-action write/freeze/rollback execution, and does not add new composite-transaction IPC**. That is a deliberate, disclosed scope boundary, not a silent gap — see "Runtime IPC" / "Transaction IPC" below and the Final Classification's honest accounting of it. What *is* delivered this stage is the **definition-side** convergence mission §9/§10/§16/§17/§18 ask for, plus the application-service boundary (§7) — the reads and writes trainer-facing IPC does when it stores or retrieves a trainer's canonical definition, which is where the audit found real, confirmed bugs (not just architectural untidiness).

## UI / IPC Audit

Full producer/consumer inventory performed by a dedicated research pass (Explore agent) across `electron/*-ipc.ts`, `electron/main.ts`, and `src/app/`. Key findings:

- **Reads had NOT fully converged** despite P4-8 (contrary to what a cursory check would suggest): `trainer-catalog-get-definition`, `live-memory-attach`'s inline definition fetch, and `export-catalog-definition.ts` all still called the pre-P4-8 `getDefinitionPayload()`/`getModPackForGame()` (`ORDER BY syncedAt DESC LIMIT 1`, no migration, no deterministic conflict resolution) instead of the canonical repository.
- **Writes had NOT converged at all**: every actual definition-writing path (`import-definition.ts`, `import-definition-ct.ts` ×2 sites, `import-definition-dumpspace.ts`, `definition-promotion.ts`, `sync/hub-client.ts`) called `upsertDefinitionPayload` directly, bypassing `persistTrainerDefinition`'s validate→transaction→verify-readback guarantee and its per-source packId convention.
- **A confirmed, live functional defect**: `resolveSaveEditControlsDualRead()`'s default `loadDefinition` only ever serves the 3 bundled test definitions (its own doc comment says Electron/SQLite callers must inject the real loader via `deps`). Both `trainer-catalog-get-trainer-controls` and `trainer-deck-get` called it with **no `deps`**, so every non-bundled real catalog game silently got empty save-edit controls.
- **A confirmed packId-collision defect**: every direct `upsertDefinitionPayload` writer used the bundled convention's `${id}-pack` packId regardless of source. Importing a YAML/CT/Dumpspace definition for a game that already had a bundled row silently overwrote that row instead of coexisting (P4-8's `persistTrainerDefinition` already solved this correctly for callers that used it — these callers didn't).
- **A confirmed promotion defect**: `promoteDefinitionToVerified()` wrote to a hardcoded `${id}-pack` with `sourceProvider: 'promotion'` — not a real `ModPackSourceProvider`, unranked by `source-priority.ts`, and for a non-bundled-sourced definition this created a second orphan row instead of updating the one being promoted.

Disposition matrix (abridged — full channel-by-channel detail in the audit transcript this doc is derived from):

| Channel | Before | After | Disposition |
|---|---|---|---|
| `trainer-catalog-get-definition` | LEGACY-READ | CANON (via `trainerApplicationService`), + provenance + typed `errorReason` | CONVERGED |
| `live-memory-attach` (definition fetch only) | LEGACY-READ, inline ModPack/V1 discrimination | CANON (`loadCatalogDefinition`) | CONVERGED |
| `export-catalog-definition.ts` | LEGACY-READ | CANON | CONVERGED |
| `trainer-catalog-get-trainer-controls` | BROKEN-LEGACY (bundled-only) | CANON (`deps.loadDefinition` injected) + provenance | CONVERGED, defect fixed |
| `trainer-deck-get` | BROKEN-LEGACY (bundled-only) | CANON (`deps.loadDefinition` injected) | CONVERGED, defect fixed |
| `import-definition.ts` (YAML import write) | LEGACY-WRITE, collision risk | `persistTrainerDefinition` | CONVERGED, defect fixed |
| `import-definition-ct.ts` (2 write sites) | LEGACY-WRITE, collision risk | `persistTrainerDefinition` | CONVERGED, defect fixed |
| `import-definition-dumpspace.ts` | LEGACY-WRITE, collision risk | `persistTrainerDefinition` | CONVERGED, defect fixed |
| `definition-promotion.ts` | LEGACY-WRITE, cross-source packId bug | `persistTrainerDefinition`, re-targets canonical winning row's own source | CONVERGED, defect fixed |
| `live-memory-resolve-definition-feature` | already CANON (P4-8) | unchanged | KEEP |
| `live-memory-list-controls`/`resolve-control` | already CANON | unchanged | KEEP |
| `trainer-catalog-sync-hub` (hub-client.ts) | LEGACY-WRITE, own transaction + hub-authoritative certLevel/updatedAt metadata `persistTrainerDefinition` doesn't accept yet | unchanged | **DEFERRED** — converging would require extending the P4-8 `SaveTrainerDefinitionInput` contract to accept a certLevel/updatedAt override, which risks the already-certified P4-8 write contract; not done this stage, disclosed here rather than silently left |
| propose-write/confirm-write/freeze-start/freeze-stop/rollback (`live-memory-ipc.ts`) | direct `MemoryManager`/`LiveMemorySession` | unchanged | **DEFERRED** — see Scope decision above |
| `trainer-host-*` (`main.ts`) | `TrainerHostSupervisor`, schema.v1-blind save-file-field pipeline | unchanged | **DEFERRED** — same reasoning, third independent pipeline, out of this stage's safe scope |
| `get-recipes`/`create-recipe`/`delete-recipe` + `TrainerPage.tsx`/`Recipes.tsx` | legacy `gameId`-keyed system, no `catalogGameId`/schema.v1 coupling at all | unchanged | **NOT TOUCHED** — pending a product decision on whether this UI stays; flagged, not silently ignored |
| CT library, canonical-games, cheat-toggle, hotkeys, overlay, research/structure/typed-view/inference/memory-map/watchlist IPC | non-trainer-definition or Phase-2-owned | unchanged | KEEP / PHASE2_OUT_OF_SCOPE |

## Application Service

- Module: `src/core/trainer-application/` (`service.ts` + `index.ts`)
- Responsibilities: `getTrainer`, `listTrainers`, `saveTrainer`, `removeTrainer` — thin forwarding to the P4-8 repository, no persistence logic of its own
- Repository dependency: `src/core/trainer-storage` (`getCanonicalTrainerDefinition`/`listCanonicalTrainerDefinitions`/`persistTrainerDefinition`/`removeCanonicalTrainerDefinition`) — direct pass-through
- Runtime dependency: **none this stage** (see Scope decision)
- Transaction dependency: **none this stage** (see Scope decision)
- Consumed by: `electron/trainer-catalog-ipc.ts`'s `trainer-catalog-get-definition` and `trainer-catalog-get-trainer-controls` handlers

## Definition IPC

**Read**: IPC handler → `loadCatalogDefinition()`/`trainerApplicationService.getTrainer()` → `getCanonicalTrainerDefinition()` (P4-8) → migration-on-read + source-priority conflict resolution → typed `StorageResult`. `trainer-catalog-get-definition` now additionally returns `provenance` and a typed `errorReason` alongside the existing string `error` (additive — no existing renderer contract broken).

**Write**: import/promotion module → `persistTrainerDefinition(rawInput, { sourceProvider, sourceId? })` (P4-8) → migrate/validate → `BEGIN IMMEDIATE TRANSACTION` → upsert → `COMMIT` (or `ROLLBACK` on failure) → re-read the specific row just written and re-migrate it (verify-readback) → typed `StorageResult<CanonicalTrainerRecord>`. Every converged writer now uses this path; none construct or write a `trainer_mod_packs` row directly anymore.

## Runtime IPC

**Not converged this stage.** Single-action trainer execution (write/freeze/rollback) continues to route through `electron/live-memory-ipc.ts`'s existing propose/confirm/freeze/rollback channels, calling `MemoryManager`/`LiveMemorySession` directly — unchanged, untouched, still the live real-process-tested path. See "Scope decision" for why cutting this to `TrainerRuntime` was not attempted.

## Transaction IPC

**Not built this stage**, for the same reason — no UI currently triggers multi-action composite features, and a new channel bound to a real process would require the same session-reuse work as Runtime IPC to be meaningful rather than dead code.

## Renderer Types

| Type | Classification | Notes |
|---|---|---|
| `TrainerCatalogEntry` | domain | canonical, imported directly, no duplication |
| `SolithDefinitionV1` | domain | canonical schema, imported directly |
| `TrainerDeckRow` | view model | derived purely from `SolithDefinitionV1` via `buildTrainerDeckRows`, legitimate projection |
| `TrainerControl` | view model | derived from `SolithDefinitionV1` via `solithDefinitionToTrainerControls`, legitimate projection |
| `ModPack`/`ModPackCheat` | legacy compatibility | still actively produced for `GameConfig`/`CheatDefinition` (legacy cheat-system engine) — role unchanged this stage, not retired (mission §19) |
| `TrainerItem` | legacy compatibility | drives the legacy recipes stack (`TrainerPage.tsx`), untouched |
| `RecipeItem` (`Recipes.tsx`) | legacy duplicate of `TrainerItem` | flagged, not touched — see "Legacy Leakage" |
| `TrainerDefinitionProvenance` (new) | domain | new canonical type, surfaced to two IPC responses and one renderer page this stage |

## Legacy Leakage

Remaining, explicitly not addressed this stage:

- **`store.ts`'s `parseModPackPayload()`** (`ModPack` vs `SolithDefinitionV1` discrimination) is still a public, directly-reachable helper (`mod-pack-loader.ts`, `install-discovery/match.ts`), not exclusively internal to the P4-2/P4-8 migration pipeline. Narrowing its visibility is a larger refactor than this stage's write/read-path convergence and was not attempted.
- **`hub-client.ts`'s sync writer** still calls `upsertDefinitionPayload` directly with its own transaction and hub-authoritative `certLevel`/`updatedAt` metadata that `persistTrainerDefinition` does not currently accept. Converging it requires extending the P4-8 write contract — deferred rather than done under time pressure against an already-certified module.
- **The legacy recipes stack** (`TrainerPage.tsx`, `Recipes.tsx`, `get-recipes`/`create-recipe`/`delete-recipe`) has zero `catalogGameId`/schema.v1 coupling and visually competes with the canonical Trainer Library/Deck. Not touched — this is a product decision (keep vs. deprecate), not a mechanical convergence, and mission §29 forbids a big-bang rewrite.
- **`trainer-host-*` IPC** (`TrainerHostSupervisor`) remains a third, schema.v1-blind save-file-field execution pipeline, parallel to both `live-memory-ipc.ts`'s pipeline and the still-unwired `TrainerRuntime`. Not touched.

## Provenance / Conflict UI

`trainer-catalog-get-definition` and `trainer-catalog-get-trainer-controls` now return `provenance` (`sourceProvider`, `certLevel`, `migratedFromLegacy`, `conflictingSources`). `CatalogTrainerControlsPage.tsx` shows one minimal note line when a definition has a non-empty `conflictingSources` — source provider, cert level, and how many other versions were not used and where they came from. No new management UI was built (mission §14: "minimum useful presentation is enough"); no conflict is silently hidden.

## Certification Display

`certLevel` is displayed exactly as the canonical repository returns it (the winning row's own `cert_level`, never escalated from a shadowed row — this guarantee already existed in P4-8's `pickPreferredRow`/`buildProvenance` and is unchanged). No renderer-side inflation logic was added or found.

## Error Contract

`trainer-catalog-get-definition`'s typed `TrainerStorageFailureReason` (`NOT_FOUND`/`INVALID_PAYLOAD`/`UNSUPPORTED_SCHEMA_VERSION`/`MIGRATION_FAILED`/`VALIDATION_FAILED`/`STORAGE_READ_FAILED`/`STORAGE_WRITE_FAILED`/`VERIFY_FAILED`) is now surfaced via the additive `errorReason` field rather than collapsed into the existing string `error`. Every converged writer (`import-definition.ts`, `import-definition-ct.ts`, `import-definition-dumpspace.ts`) returns `persisted.error.message` in its existing `errors: string[]` outcome shape on a repository write failure, instead of throwing or silently succeeding.

## Preload Boundary

Not modified this stage — no new IPC channels were added, only response payloads on existing channels gained additive optional fields (`provenance`, `errorReason`). `electron/preload.ts` was read (to confirm no channel-name changes were needed) but not edited.

## Phase 2 Isolation

- Live-memory files changed: **1** — `electron/live-memory-ipc.ts`, narrowly: only the inline definition-fetch block inside the `live-memory-attach` handler (replacing a duplicated `getDefinitionPayload`/`getModPackForGame` fallback with `loadCatalogDefinition`), matching the exact precedent already set by P4-8's conversion of the sibling `live-memory-resolve-definition-feature` handler in the same file. No write/freeze/consent/rollback/scanner/watchlist/memory-map/typed-view/inference code in this file was touched.
- Watchlist files changed: **0**
- Memory-map files changed: **0**
- Hotkey files changed: **0**
- PR #49 collision: **none** — checked before every commit (`git log HEAD..origin/master`, `git diff --name-status HEAD...origin/master`); PR #49 merged before this mission began, and the one subsequent master commit (`204407a`, a docs-only ROADMAP.md update) was merged in cleanly with zero file overlap.

## Tests

New: `test:trainer-application` (`tests/trainer-application-ipc-convergence.test.ts`) — 5/5 pass:
- `trainerApplicationService` forwards correctly (save/get/list/remove + typed `NOT_FOUND`)
- YAML-import packId-collision fix (bundled row survives, surfaced as a conflicting source)
- Promotion cross-source packId fix (updates the same row, not a new `'promotion'`-sourced one)
- Source-scan regression lock for both `resolveSaveEditControlsDualRead` `deps` fixes

Regression (all re-run against the converged tree):

| Suite | Result |
|---|---|
| `test:trainer-storage` | 34/34 |
| `test:trainer-application` | 5/5 |
| `test:trainer-runtime` | 32/32 |
| `test:trainer-transaction` | 36/36 |
| `test:trainer-catalog` | 206/206 |
| `test:definitions` | 124/124 |
| `test:trainer-schema` | 36/36 |
| `test:v2-lifecycle` | 56/56 |
| `test:cheat-toggle` | 27/27 |
| `test:game-profile` | 49/49 |
| `test:v1` | 200/200 + 10/10 (two sub-invocations) |
| `verify:schema-v1-boundaries` | PASS |

`test:trainer-host` not run (requires a native build step unrelated to this stage's changes — no `trainer-host-*` files were touched).

## Builds

- Root TS (`npx tsc --noEmit`): PASS
- Electron TS (`npx tsc -p tsconfig.electron.json --noEmit`): PASS
- Vite (`npm run build:vite`): PASS (renderer changed — `CatalogTrainerControlsPage.tsx`, `global.d.ts`)
- Electron (`npm run build:electron`): PASS, 33/33 output-verifier checks passed (main-process IPC handlers changed — `trainer-catalog-ipc.ts`, `trainer-deck-ipc.ts`, `live-memory-ipc.ts`)

## Scope

- P4-4 started: NO
- Phase 2 modified: NO (one narrow, precedent-consistent definition-read fix inside `live-memory-ipc.ts`; no write/freeze/consent/watchlist/memory-map/scanner/typed-view/inference code touched)
- Hotkeys modified: NO
- Phase 5 started: NO
- Phase 6 started: NO
- Destructive retirement: NO (no legacy path was deleted; ModPack/`games.ts`/Recipe/CT/recipes-UI all preserved as-is)
