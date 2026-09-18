# P4-8 — Persistence Convergence & Canonical Trainer Storage

**Roadmap track:** external roadmap Phase 4 (trainer-model convergence), stage P4-8. Builds on [001](001-p4-2-canonical-schema-versioning.md)/[002](002-p4-5-canonical-trainer-runtime-core.md)/[003](003-p4-7-composite-transaction-runtime.md).

## Scope

Establishes one authoritative persistence path for canonical trainer
definitions: `src/core/trainer-storage/` (new), a thin repository layer over
the existing `trainer_mod_packs` table that guarantees every definition it
returns has already been through the P4-2 migration/validation pipeline. No
destructive retirement — `games.ts`, ModPack, Recipe, and every legacy DB
column/table remain exactly as they were; this mission converges *authority*,
not physical schema.

## Persistence Source Matrix

| Source | Stores trainer semantics? | Canonical? | Read by runtime? | Writable? | Legacy? | Migration needed? | Final disposition |
|---|---|---|---|---|---|---|---|
| `trainer_mod_packs.payloadJson` (schemaVersion:1, native) | Yes | **Yes** | Yes (via repository) | Yes (`persistTrainerDefinition`) | No | N/A | **AUTHORITATIVE** |
| `trainer_mod_packs.payloadJson` (legacy ModPack-shaped, no `schemaVersion`) | Yes | No (migrated on read) | Yes (migrated) | Yes (legacy writers unchanged) | Yes | Yes — P4-2 legacy-unversioned step, on read | **LEGACY_COMPATIBILITY** |
| Bundled catalog seed (`data/trainer-catalog-seed.json`, `ensure-bundled-definitions.ts`) | Yes | No | Indirectly (written into `trainer_mod_packs` once, then read like row 1) | Read-only asset; written into DB at bootstrap | Yes (default content) | N/A (already schema.v1 when written) | **IMPORT_ONLY** |
| `src/core/cheat-system/games.ts` (`ALL_GAMES`) | Yes (presentation `GameConfig`/`CheatDefinition`) | No | Only via `LiveMemoryTrainerPage.tsx` UI, and as source material for bundled-seed generation | No (hardcoded source) | Yes | N/A — P4-4 owns retirement | **LEGACY_COMPATIBILITY** |
| `recipes` / `recipe_items` tables | No (file-scan/save-authoring semantics, not schema.v1) | No | No (unrelated to `TrainerRuntime`) | Yes (own CRUD, untouched) | Distinct legacy subsystem | N/A this mission | **REFERENCE_ONLY** |
| Personal CT-library summary/shards (`data/ct-library/...`, now userData-rooted) | No (search index over imported CT tables, not definitions themselves) | No | No (consumed by CT-import UI to pick a table) | Yes (import write path) | Yes | N/A | **REFERENCE_ONLY** |
| CT import write path (`import-definition-ct.ts` → `store.ts` upserts) | Yes | No until read | Yes indirectly (feeds `trainer_mod_packs`) | Yes | Yes | Yes, on read | **IMPORT_ONLY** |
| YAML import write path (`import-definition.ts` → `store.ts` upserts) | Yes | No until read | Yes indirectly | Yes | Yes | Yes, on read | **IMPORT_ONLY** |
| `trainer_catalog_games` (catalog/search metadata) | No — display name, executables, search text; not definition content | N/A (not a definition source at all) | No | Yes (own CRUD, untouched) | No | N/A | **DERIVED** |
| `trainer_health` | No (health-check result) | No | No | Yes (untouched) | No | N/A | **RUNTIME_STATE** |
| `cheat_toggle_state` | No (persisted UI toggle/last-known-address state) | No | No (separate from P4-5 in-memory `RuntimeFeatureState`) | Yes (untouched) | No | N/A | **RUNTIME_STATE** |
| `trainer-catalog-export-definition` IPC (YAML export) | Yes (reads an already-canonical definition) | N/A — output, not storage | N/A | N/A (export only) | No | N/A | **EXPORT_ONLY** |

## Canonical Repository

- module: `src/core/trainer-storage/` (`repository.ts`, `source-priority.ts`, `types.ts`, `errors.ts`, `index.ts`)
- API: `getCanonicalTrainerDefinition(catalogGameId)`, `listCanonicalTrainerDefinitions()`, `persistTrainerDefinition(rawInput, {sourceProvider, sourceId?})`, `removeCanonicalTrainerDefinition(catalogGameId)` — all return a typed `StorageResult<T>`, never a bare throw for an expected record-level failure.
- stored representation: unchanged — still `trainer_mod_packs.payloadJson` (no new table). The repository is orchestration, not a new store.
- validation: every read and write runs the payload through `migrateTrainerDefinition()` (P4-2). A value typed `SolithDefinitionV1` at the call site is still re-validated on write (defense in depth — TS types don't prove real zod validity).
- migration: automatic, on read, via the existing P4-2 pipeline — no duplicate version-detection logic.

Owns no SQL beyond the transaction wrapper in `persistTrainerDefinition`; every raw read/write still goes through `trainer-catalog/store.ts`'s existing `trainer_mod_packs` primitives (`upsertDefinitionPayload`, plus two new additive functions: `listModPackRowsForGame`, `listCatalogGameIdsWithDefinitions`, `removeDefinitionsForGame`). Does **not** touch `trainer_catalog_games` — a definition repository is not a catalog-metadata repository (mission §10).

## Source of Truth

**Canonical trainer definition content is sourced from `trainer_mod_packs.payloadJson` rows resolved through `src/core/trainer-storage/`'s repository, which always applies the P4-2 migration/validation pipeline. ModPack/Recipe/`games.ts`/bundled-seed representations are compatibility, import, or reference inputs only — never read directly by a canonical consumer.** `TrainerCatalogEntry`/`trainer_catalog_games` is catalog *metadata* (search/display), never treated as the definition itself.

## Legacy Sources

- **ModPack**: role changed from potential source-of-truth to compatibility/import representation where read (`store.ts`'s `parseModPackPayload`/`modPackToSolithDefinition` remain for callers outside the new repository — e.g. `mod-pack-loader.ts`'s `GameConfig` chain — untouched, since that output shape is still legitimately needed and converting it is P4-4's job). Not retired.
- **`games.ts`**: untouched. Classified `LEGACY_COMPATIBILITY` / presentation source. Still feeds `LiveMemoryTrainerPage.tsx` and bundled-seed generation, as before.
- **Recipe**: untouched. Its own subsystem (file-scan/save-authoring), not a trainer-definition input today. No live UI redirect performed.
- **CT**: P4-8 only stores canonical definitions the existing certified CT import already produces; no CT semantics/execution changed. Personal CT-library path defect (§19) fixed narrowly (see below) — CT script execution/registry semantics untouched.
- **bundled seed**: untouched write path (`ensure-bundled-definitions.ts`); now read back through the canonical repository like any other row.

## Migration-on-Read

`getCanonicalTrainerDefinition`/`listCanonicalTrainerDefinitions` always call `migrateTrainerDefinition(JSON.parse(row.payloadJson))` — never a raw cast. Unknown future `schemaVersion` fails closed as `UNSUPPORTED_SCHEMA_VERSION`; malformed/legacy-invalid input fails closed as `INVALID_PAYLOAD`; schema-invalid versioned input fails closed as `VALIDATION_FAILED`. Nothing is silently deleted, reinterpreted, or rewritten by a read.

Two real production read paths now go through this pipeline for the first time: `src/core/definitions/load-catalog-definition.ts`'s `loadCatalogDefinition()` (shared by the Trainer Deck panel, save-edit dual-read, and live-memory dual-read control listing) and `electron/live-memory-ipc.ts`'s `live-memory-resolve-definition-feature` handler (previously a second, duplicated inline read with no migration at all — now calls the same `loadCatalogDefinition()`).

## Write Path

`persistTrainerDefinition(rawInput, {sourceProvider, sourceId?})`:
1. **validate** — `migrateTrainerDefinition(rawInput)`; any failure aborts before any DB access (zero mutation).
2. **serialize** — `JSON.stringify(definition)`.
3. **transaction** — `db.run('BEGIN IMMEDIATE TRANSACTION')` → `upsertDefinitionPayload(...)` → `db.run('COMMIT')`; any thrown error triggers `db.run('ROLLBACK')` and a typed `STORAGE_WRITE_FAILED`.
4. **read-back verification** — re-reads the *specific row just written* (by `packId`, not "whichever row currently wins reads") and re-runs it through the same migration/validation; a parse or validation failure on the just-written bytes surfaces `VERIFY_FAILED` rather than trusting the write call's return value.

`packId` is `${definition.id}-pack` for `sourceProvider: 'bundled'` (preserves the exact convention `ensure-bundled-definitions.ts` already writes directly) and `${definition.id}-pack-${sourceProvider}` for every other source — so a user's local edit never silently overwrites a pre-existing bundled/hub row at the same `catalogGameId` (§21/§30).

## Provenance

Persisted/derived per record: `sourceType` (coarse bucket derived from `sourceProvider`), `sourceProvider` (existing column, unchanged), `sourceId` (new, additive, nullable `trainer_mod_packs.sourceId TEXT` column — a CT sha256 / hub record id / yaml filename when known, `NULL` otherwise, never fabricated), `certLevel` (existing `cert_level` column), `migratedFromLegacy` (derived fresh from the migration outcome — never persisted redundantly, so it can never go stale), `syncedAt`/`updatedAt` (existing columns, see timestamp convergence below), and `conflictingSources` (every other `trainer_mod_packs` row for the same game that was **not** selected — always surfaced, never hidden).

## Certification Convergence

No new enum introduced. `cert_level`/`HubCertificationLevel` (`'L0_Community' | 'L3_Certified'`) — already the DB-persisted certification signal — is read as-is into `provenance.certLevel`; the existing derivation (`sourceProvider === 'bundled' ? 'L3_Certified' : 'L0_Community'`, unchanged) still governs new writes. No certification is ever escalated by the repository — the winning row's own `cert_level` is returned verbatim, never inherited from a shadowed row. The other four certification-adjacent representations found in the codebase audit (`CertificationLevel` L0–L4, `VerificationStatus`, `CanonicalGameEligibility`, `TrainerHealthStatus`) are distinct axes (definition-authored trust level, catalog-listing eligibility, health-check result) — re-auditing confirmed no genuine duplicate needing merging beyond `cert_level` itself; a broader unification of all five is out of this mission's scope (would touch Phase 3/definition-authoring surfaces well beyond persistence).

## Timestamp Convergence

`trainer_mod_packs` carries three timestamp columns with three **genuinely distinct** meanings, confirmed by re-reading their write sites — not accidental duplicates:
- `updatedAt` (TEXT, camelCase) — canonical "last locally modified" time, written on every upsert. **This is the one `provenance.updatedAt` exposes as the repository's canonical timestamp.**
- `updated_at` (INTEGER, snake_case) — the Hub sync protocol's own version counter (`getMaxHubDefinitionUpdatedAt()`), unrelated to local modification time. Left untouched; not read by the repository.
- `syncedAt` (TEXT, ISO) — last successful sync-from-source time, exposed separately as `provenance.syncedAt`.

`trainer_catalog_games`'s three timestamps (`updatedAt`/`createdAt`/`contentUpdatedAt`) were re-audited and found similarly non-duplicate by design (unconditional last-write / set-once-on-insert / set-only-on-meaningful-change) — no convergence needed there; this mission does not touch that table.

## Conflict Semantics

When more than one `trainer_mod_packs` row exists for a `catalogGameId` (source-priority.ts): deterministic priority `user > ct-import > solith-hub > community-listing providers > bundled` (formalizing behavior `hasUserAuthoredDefinition()` already informally implied), tie-broken by `syncedAt` within the same tier. The winner is returned; every other row is surfaced via `provenance.conflictingSources` — never silently dropped. No new community-sync/merge logic was built.

## Corrupt/Unsupported Records

A malformed-JSON, schema-invalid, or future-version row for one game surfaces a typed per-record `StorageResult` failure and is collected in `listCanonicalTrainerDefinitions()`'s `failures` array — it never aborts or throws out of the whole list call.

## Runtime-State Separation

`CanonicalTrainerRecord`/`SolithDefinitionV1` never carries PID/address/rollback-reference/freeze-worker/lifecycle-state fields (proved by a regression test asserting their absence from the serialized definition). `cheat_toggle_state` and Phase 2 watchlist/memory-map tables are untouched and never referenced from `src/core/trainer-storage/` (source-text-scan regression test).

## Personal CT-library path defect (§19)

Re-audited and confirmed still present: `electron/ct-library-ipc.ts` resolved its base directory from `fileURLToPath(import.meta.url)` (the compiled module's own location — the app install/resources tree in a packaged build), not `app.getPath('userData')`. Fixed narrowly: now resolves via `getAppPaths()` (`src/shared/app-paths.ts`, the same resolver already used for the SQLite DB path, with dev/test env-var fallbacks), memoized per process. All five read/write call sites in that file updated. **Not** attempted: automatic migration of a personal library previously written under the old install-dir path — recorded as a known follow-up rather than expanded into broad CT-directory-migration work, per mission §19's explicit "record and defer" allowance.

## Phase 2 Boundary

- P2 production files changed: NO
- watchlist state touched: NO
- hotkey state touched: NO
- PR #49 status: OPEN, unmerged, untouched by this mission throughout
- collisions: NONE (zero drift at every checkpoint)

## Tests

`test:trainer-storage` (new) 34/34 · `test:trainer-catalog` 206/206 (204 baseline + 2 new CT-library path-fix regression tests) · `test:definitions` 124/124 · `test:trainer-schema` 36/36 · `test:trainer-runtime` 32/32 · `test:trainer-transaction` 36/36 · `test:v2-lifecycle` 56/56 · `test:cheat-toggle` 27/27 · `test:game-profile` 49/49 · `test:v1` 210/210 · `verify:schema-v1-boundaries` PASS · `test:trainer-host` **NOT RUN** (native build, out of scope).

## Scope

- P4-4 started: NO
- Phase 2 implementation modified: NO
- hotkey system modified: NO
- Phase 3 reopened: NO
- Phase 5 started: NO
- destructive retirement: NO — no table, column, or file deleted; `sourceId` is the only DB change and is purely additive.
