/**
 * SOLITH Phase 3.1, Mission 2/3 — deterministic, batched catalog import.
 *
 * Root cause of the sql.js resource exhaustion (see database/index.ts's
 * StatementWrapper doc comment): every one-shot `db.prepare(sql).run(...)`
 * leaks a WASM statement handle. For a bulk import of tens/hundreds of
 * thousands of rows, waiting on GC (the FinalizationRegistry safety net
 * added to StatementWrapper) is NOT sufficient — confirmed empirically: a
 * tight synchronous import loop never yields to the event loop, so
 * FinalizationRegistry callbacks never fire until the whole loop is already
 * done (too late to prevent OOM).
 *
 * This module is the real, deterministic fix for exactly that workload:
 * ONE statement is prepared per table for the WHOLE batch (not per row),
 * reused via bind/step/reset (`StatementWrapper.bindStepReset`), and freed
 * exactly once when the batch completes — a 250,000-row import now prepares
 * a handful of statements total, not hundreds of thousands. The whole batch
 * runs inside one explicit SQL transaction (BEGIN/COMMIT), which also
 * defers the debounced disk persist until the transaction commits (see
 * persistDatabase()'s `inTransaction` gate) instead of scheduling it on
 * every row.
 *
 * Crash safety (Mission 19): any error mid-batch triggers ROLLBACK before
 * re-throwing, and the prepared statement is always freed in a `finally`
 * block — no half-applied transaction, no leaked handle, regardless of
 * where the failure occurs.
 */
import db from '../database/index.js';
import { upsertCanonicalProviderLink } from '../canonical-games/provider-link-store.js';
import type { CanonicalProviderLink } from '../canonical-games/provider-link-store.js';
import type { ProviderGameRecord } from './types.js';
import type { DiscoveryCatalogEntry } from '../discovery-catalog/types.js';

export interface BatchImportResult {
  rowsWritten: number;
  durationMs: number;
}

/**
 * Runs `body` inside one BEGIN/COMMIT transaction, rolling back and
 * re-throwing on any failure. Never leaves the database mid-transaction.
 */
function withTransaction<T>(body: () => T): T {
  db.run('BEGIN TRANSACTION');
  try {
    const result = body();
    db.run('COMMIT');
    return result;
  } catch (error) {
    try {
      db.run('ROLLBACK');
    } catch {
      // If ROLLBACK itself fails the connection is already in a bad state;
      // the original error is what matters to the caller.
    }
    throw error;
  }
}

export function importProviderCatalogRecordsBatch(records: ProviderGameRecord[]): BatchImportResult {
  const start = performance.now();
  if (records.length === 0) return { rowsWritten: 0, durationMs: 0 };

  withTransaction(() => {
    const stmt = db.prepare(
      `INSERT INTO provider_catalog_records (
         provider, providerGameId, title, type, storeUrl, releaseDate, developer, publisher,
         genresJson, tagsJson, rating, ratingSource, popularityRank, popularitySource, lastUpdated, rawRevision
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, providerGameId) DO UPDATE SET
         title = excluded.title,
         type = excluded.type,
         storeUrl = excluded.storeUrl,
         releaseDate = excluded.releaseDate,
         developer = excluded.developer,
         publisher = excluded.publisher,
         genresJson = excluded.genresJson,
         tagsJson = excluded.tagsJson,
         rating = excluded.rating,
         ratingSource = excluded.ratingSource,
         popularityRank = excluded.popularityRank,
         popularitySource = excluded.popularitySource,
         lastUpdated = excluded.lastUpdated,
         rawRevision = excluded.rawRevision
       WHERE excluded.lastUpdated >= provider_catalog_records.lastUpdated`,
    );
    try {
      for (const record of records) {
        stmt.bindStepReset([
          record.provider,
          record.providerGameId,
          record.title,
          record.type,
          record.storeUrl ?? null,
          record.releaseDate ?? null,
          record.developer ?? null,
          record.publisher ?? null,
          record.genres ? JSON.stringify(record.genres) : null,
          record.tags ? JSON.stringify(record.tags) : null,
          record.rating ?? null,
          record.ratingSource ?? null,
          record.popularityRank ?? null,
          record.popularitySource ?? null,
          record.lastUpdated,
          record.rawRevision ?? null,
        ]);
      }
    } finally {
      stmt.free();
    }
  });

  return { rowsWritten: records.length, durationMs: performance.now() - start };
}

export function importDiscoveryCatalogEntriesBatch(entries: DiscoveryCatalogEntry[]): BatchImportResult {
  const start = performance.now();
  if (entries.length === 0) return { rowsWritten: 0, durationMs: 0 };

  withTransaction(() => {
    const stmt = db.prepare(
      `INSERT INTO discovery_catalog_entries
         (solithGameId, title, normalizedTitle, aliasesJson, providerIdsJson, type, releaseDate, releaseYear, genresJson, tagsJson, trainerAvailable, ctAvailable, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(solithGameId) DO UPDATE SET
         title = excluded.title,
         normalizedTitle = excluded.normalizedTitle,
         aliasesJson = excluded.aliasesJson,
         providerIdsJson = excluded.providerIdsJson,
         type = excluded.type,
         releaseDate = excluded.releaseDate,
         releaseYear = excluded.releaseYear,
         genresJson = excluded.genresJson,
         tagsJson = excluded.tagsJson,
         trainerAvailable = excluded.trainerAvailable,
         ctAvailable = excluded.ctAvailable,
         updatedAt = excluded.updatedAt`,
    );
    try {
      for (const entry of entries) {
        stmt.bindStepReset([
          entry.solithGameId,
          entry.title,
          entry.normalizedTitle,
          JSON.stringify(entry.aliases ?? []),
          JSON.stringify(entry.providerIds ?? {}),
          entry.type,
          entry.releaseDate ?? null,
          entry.releaseYear ?? null,
          JSON.stringify(entry.genres ?? []),
          JSON.stringify(entry.tags ?? []),
          entry.trainerAvailable ? 1 : 0,
          entry.ctAvailable ? 1 : 0,
          entry.updatedAt,
        ]);
      }
    } finally {
      stmt.free();
    }
  });

  return { rowsWritten: entries.length, durationMs: performance.now() - start };
}

export function importCanonicalProviderLinksBatch(links: Omit<CanonicalProviderLink, 'linkedAt'>[]): BatchImportResult {
  const start = performance.now();
  if (links.length === 0) return { rowsWritten: 0, durationMs: 0 };

  withTransaction(() => {
    const stmt = db.prepare(
      `INSERT INTO canonical_provider_links (provider, providerGameId, canonicalGameId, confidence, evidenceJson, linkedAt)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(provider, providerGameId) DO UPDATE SET
         canonicalGameId = excluded.canonicalGameId,
         confidence = excluded.confidence,
         evidenceJson = excluded.evidenceJson,
         linkedAt = excluded.linkedAt`,
    );
    try {
      for (const link of links) {
        stmt.bindStepReset([link.provider, link.providerGameId, link.canonicalGameId, link.confidence, JSON.stringify(link.evidence)]);
      }
    } finally {
      stmt.free();
    }
  });

  return { rowsWritten: links.length, durationMs: performance.now() - start };
}

// Re-exported so callers needing a single-row write (e.g. interactive,
// non-bulk code paths) do not need to import two different modules.
export { upsertCanonicalProviderLink };
