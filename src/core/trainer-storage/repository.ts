import db from '../database/index.js';
import { migrateTrainerDefinition } from '../definitions/migrations/migrate-trainer-definition.js';
import { LEGACY_UNVERSIONED, type MigrationFailureReason } from '../definitions/migrations/types.js';
import type { SolithDefinitionV1 } from '../definitions/schema.v1.js';
import {
  listCatalogGameIdsWithDefinitions,
  listModPackRowsForGame,
  removeDefinitionsForGame,
  upsertDefinitionPayload,
  type TrainerModPackRow,
} from '../trainer-catalog/store.js';
import { storageError, type TrainerStorageError, type TrainerStorageFailureReason } from './errors.js';
import { pickPreferredRow, sourceTypeForProvider } from './source-priority.js';
import {
  fail,
  ok,
  type CanonicalTrainerRecord,
  type SaveTrainerDefinitionInput,
  type StorageResult,
  type TrainerDefinitionListResult,
  type TrainerDefinitionProvenance,
} from './types.js';

/**
 * Canonical trainer-definition persistence boundary (P4-8). Every definition
 * this module returns has already been version-detected, migrated (via the
 * P4-2 pipeline), and schema-validated — no caller of this module needs to
 * ask "is this a ModPack or a SolithDefinitionV1?" afterward (mission §6).
 *
 * This is a thin orchestration layer over the EXISTING trainer_mod_packs
 * read/write primitives in trainer-catalog/store.ts — it owns no SQL of its
 * own beyond the transaction wrapper in `persistDefinition()`, and it does
 * not touch trainer_catalog_games (catalog metadata is a separate concern;
 * mission §10/§5 — a definition repository is not a catalog-metadata
 * repository).
 */

function migrationFailureToStorageReason(reason: MigrationFailureReason): TrainerStorageFailureReason {
  switch (reason) {
    case 'UNKNOWN_FUTURE_VERSION':
      return 'UNSUPPORTED_SCHEMA_VERSION';
    case 'MALFORMED':
    case 'LEGACY_INPUT_INVALID':
      return 'INVALID_PAYLOAD';
    case 'SCHEMA_VALIDATION_FAILED':
      return 'VALIDATION_FAILED';
    default:
      return 'MIGRATION_FAILED';
  }
}

function buildProvenance(winner: TrainerModPackRow, conflicts: TrainerModPackRow[], migratedFromLegacy: boolean): TrainerDefinitionProvenance {
  return {
    sourceType: sourceTypeForProvider(winner.sourceProvider),
    sourceProvider: winner.sourceProvider,
    sourceId: winner.sourceId,
    certLevel: winner.certLevel,
    migratedFromLegacy,
    syncedAt: winner.syncedAt,
    updatedAt: winner.updatedAt,
    conflictingSources: conflicts.map((c) => ({ packId: c.packId, sourceProvider: c.sourceProvider, syncedAt: c.syncedAt })),
  };
}

function migrateRow(row: TrainerModPackRow): StorageResult<{ definition: SolithDefinitionV1; migratedFromLegacy: boolean }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payloadJson);
  } catch (err) {
    return fail(storageError('INVALID_PAYLOAD', `Stored payload for packId "${row.packId}" is not valid JSON.`, err));
  }

  const migration = migrateTrainerDefinition(parsed);
  if (migration.success === false) {
    return fail(
      storageError(
        migrationFailureToStorageReason(migration.reason),
        migration.errors.join('; ') || `Migration failed for packId "${row.packId}".`,
        migration,
      ),
    );
  }

  return ok({ definition: migration.definition, migratedFromLegacy: migration.sourceVersion === LEGACY_UNVERSIONED });
}

/** Resolves the single canonical record for a game from all its persisted rows (mission §6/§7/§21). */
export function getCanonicalTrainerDefinition(catalogGameId: string): StorageResult<CanonicalTrainerRecord> {
  let rows: TrainerModPackRow[];
  try {
    rows = listModPackRowsForGame(catalogGameId);
  } catch (err) {
    return fail(storageError('STORAGE_READ_FAILED', `Failed to read persisted rows for "${catalogGameId}".`, err));
  }

  if (rows.length === 0) {
    return fail(storageError('NOT_FOUND', `No persisted trainer definition found for catalog game "${catalogGameId}".`));
  }

  const { winner, conflicts } = pickPreferredRow(rows);
  const migrated = migrateRow(winner);
  if (migrated.success === false) return migrated;

  return ok({
    catalogGameId,
    packId: winner.packId,
    definition: migrated.value.definition,
    provenance: buildProvenance(winner, conflicts, migrated.value.migratedFromLegacy),
  });
}

/**
 * Every persisted canonical definition, one per catalog game. A corrupt or
 * unsupported-version record for one game is collected in `failures` and
 * does NOT abort the rest of the list (mission §23 — a bad record must never
 * crash the whole catalog).
 */
export function listCanonicalTrainerDefinitions(): StorageResult<TrainerDefinitionListResult> {
  let catalogGameIds: string[];
  try {
    catalogGameIds = listCatalogGameIdsWithDefinitions();
  } catch (err) {
    return fail(storageError('STORAGE_READ_FAILED', 'Failed to list catalog game ids with persisted definitions.', err));
  }

  const records: CanonicalTrainerRecord[] = [];
  const failures: TrainerDefinitionListResult['failures'] = [];
  for (const catalogGameId of catalogGameIds) {
    const result = getCanonicalTrainerDefinition(catalogGameId);
    if (result.success === false) {
      failures.push({ catalogGameId, error: result.error });
      continue;
    }
    records.push(result.value);
  }

  return ok({ records, failures });
}

/**
 * Validates, serializes, and persists a trainer definition inside a DB
 * transaction, then re-reads the specific row just written and re-migrates
 * it to prove the persisted bytes round-trip into an equivalent canonical
 * definition (mission §22: validate -> serialize -> transaction -> verify
 * read-back). Accepts raw, untrusted input — a caller that already holds a
 * typed `SolithDefinitionV1` may pass it directly; it is re-validated here
 * regardless (defense in depth — a value can satisfy the TS type without
 * having passed real zod validation).
 */
export function persistTrainerDefinition(rawInput: unknown, input: SaveTrainerDefinitionInput): StorageResult<CanonicalTrainerRecord> {
  const migration = migrateTrainerDefinition(rawInput);
  if (migration.success === false) {
    return fail(
      storageError(
        migrationFailureToStorageReason(migration.reason),
        migration.errors.join('; ') || 'Trainer definition failed validation.',
        migration,
      ),
    );
  }

  const definition = migration.definition;
  // 'bundled' keeps the exact packId convention ensure-bundled-definitions.ts
  // already writes directly (`${id}-pack`), so a bundled write through this
  // repository still lands on the same single canonical bundled row. Every
  // other source gets its own source-suffixed packId so that, e.g., a user's
  // local edit never silently overwrites a pre-existing bundled/hub row at
  // the same catalogGameId (mission §21/§30: no silent overwrite) — reads
  // then pick the highest-priority row deterministically (source-priority.ts)
  // and surface every other one via provenance.conflictingSources.
  const packId = input.sourceProvider === 'bundled' ? `${definition.id}-pack` : `${definition.id}-pack-${input.sourceProvider}`;
  const payloadJson = JSON.stringify(definition);
  const syncedAt = new Date().toISOString();

  try {
    db.run('BEGIN IMMEDIATE TRANSACTION');
  } catch (err) {
    return fail(storageError('STORAGE_WRITE_FAILED', 'Failed to start persistence transaction.', err));
  }

  try {
    upsertDefinitionPayload(
      packId,
      definition.id,
      payloadJson,
      definition.safety.verificationStatus,
      input.sourceProvider,
      syncedAt,
      undefined,
      input.sourceId ?? null,
    );
    db.run('COMMIT');
  } catch (err) {
    try {
      db.run('ROLLBACK');
    } catch {
      // The original write error is the one worth reporting; a failed
      // rollback-of-a-failed-write does not change the fact that nothing
      // should be trusted as committed here.
    }
    return fail(storageError('STORAGE_WRITE_FAILED', `Failed to persist trainer definition "${definition.id}".`, err));
  }

  return verifyPersistedWrite(definition.id, packId);
}

/** Re-reads the exact row just written (not "whichever row currently wins") and proves it round-trips. */
function verifyPersistedWrite(catalogGameId: string, packId: string): StorageResult<CanonicalTrainerRecord> {
  let rows: TrainerModPackRow[];
  try {
    rows = listModPackRowsForGame(catalogGameId);
  } catch (err) {
    return fail(storageError('VERIFY_FAILED', `Read-back failed for "${catalogGameId}" after write.`, err));
  }

  const written = rows.find((r) => r.packId === packId);
  if (!written) {
    return fail(storageError('VERIFY_FAILED', `Row "${packId}" was not found on read-back immediately after a successful write.`));
  }

  const migrated = migrateRow(written);
  if (migrated.success === false) {
    return fail(storageError('VERIFY_FAILED', `Just-written row "${packId}" failed to re-parse/re-migrate on read-back.`, migrated.error));
  }

  const conflicts = rows.filter((r) => r.packId !== packId);
  return ok({
    catalogGameId,
    packId,
    definition: migrated.value.definition,
    provenance: buildProvenance(written, conflicts, migrated.value.migratedFromLegacy),
  });
}

/** Removes every persisted trainer_mod_packs row for a catalog game. Does not touch trainer_catalog_games metadata. */
export function removeCanonicalTrainerDefinition(catalogGameId: string): StorageResult<void> {
  let removedCount: number;
  try {
    removedCount = removeDefinitionsForGame(catalogGameId);
  } catch (err) {
    return fail(storageError('STORAGE_WRITE_FAILED', `Failed to remove trainer definitions for "${catalogGameId}".`, err));
  }
  if (removedCount === 0) {
    return fail(storageError('NOT_FOUND', `No persisted trainer definition found for catalog game "${catalogGameId}".`));
  }
  return ok(undefined);
}

export type { TrainerStorageError };
