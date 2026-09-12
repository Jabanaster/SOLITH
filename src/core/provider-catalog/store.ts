import db from '../database/index.js';
import type { LinkedLibraryProvider } from '../install-discovery/provider-capabilities.js';
import type { ProviderGameRecord } from './types.js';

interface ProviderCatalogRow {
  provider: string;
  providerGameId: string;
  title: string;
  type: string;
  storeUrl: string | null;
  releaseDate: string | null;
  developer: string | null;
  publisher: string | null;
  genresJson: string | null;
  tagsJson: string | null;
  rating: number | null;
  ratingSource: string | null;
  popularityRank: number | null;
  popularitySource: string | null;
  lastUpdated: string;
  rawRevision: string | null;
}

function rowToRecord(row: ProviderCatalogRow): ProviderGameRecord {
  return {
    provider: row.provider as LinkedLibraryProvider,
    providerGameId: row.providerGameId,
    title: row.title,
    type: row.type as ProviderGameRecord['type'],
    lastUpdated: row.lastUpdated,
    ...(row.storeUrl != null ? { storeUrl: row.storeUrl } : {}),
    ...(row.releaseDate != null ? { releaseDate: row.releaseDate } : {}),
    ...(row.developer != null ? { developer: row.developer } : {}),
    ...(row.publisher != null ? { publisher: row.publisher } : {}),
    ...(row.genresJson != null ? { genres: JSON.parse(row.genresJson) as string[] } : {}),
    ...(row.tagsJson != null ? { tags: JSON.parse(row.tagsJson) as string[] } : {}),
    ...(row.rating != null ? { rating: row.rating } : {}),
    ...(row.ratingSource != null ? { ratingSource: row.ratingSource } : {}),
    ...(row.popularityRank != null ? { popularityRank: row.popularityRank } : {}),
    ...(row.popularitySource != null ? { popularitySource: row.popularitySource } : {}),
    ...(row.rawRevision != null ? { rawRevision: row.rawRevision } : {}),
  };
}

/**
 * Upserts one provider catalog record — atomic single-row write, keyed by
 * (provider, providerGameId).
 *
 * SECURITY FIX (Phase 3 hostile review, P2 — stale-revision rollback): the
 * `WHERE excluded.lastUpdated >= provider_catalog_records.lastUpdated` guard
 * on the UPDATE means a replayed/stale fetch (a malicious mirror, a MITM
 * replay, or simply a slow/out-of-order concurrent sync) can never roll an
 * existing row backward — `lastUpdated` is generated locally by SOLITH at
 * normalization time (see each adapter's `new Date().toISOString()`), never
 * provider-supplied, so it cannot be forged by a compromised response. A
 * provider's own `rawRevision` is intentionally NOT used for this guard: for
 * Epic/GOG it is a content hash with no ordering, and even Steam's numeric
 * `last_modified` is provider-supplied and therefore not a trustworthy
 * ordering signal against a hostile/compromised endpoint.
 */
export function upsertProviderCatalogRecord(record: ProviderGameRecord): void {
  db.prepare(
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
  ).run(
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
  );
}

/**
 * Returns the currently-stored rawRevision for a record, or null if the
 * record doesn't exist yet — used by ingestion adapters to skip rewriting
 * unchanged rows (Phase 3 Mission 8: "do not redownload/store duplicate
 * unchanged rows unnecessarily").
 */
export function getProviderCatalogRecordRevision(provider: LinkedLibraryProvider, providerGameId: string): string | null {
  const row = db
    .prepare('SELECT rawRevision FROM provider_catalog_records WHERE provider = ? AND providerGameId = ?')
    .get(provider, providerGameId) as { rawRevision: string | null } | undefined;
  return row?.rawRevision ?? null;
}

export function countProviderCatalogRecords(provider?: LinkedLibraryProvider): number {
  const row = provider
    ? (db.prepare('SELECT COUNT(*) as c FROM provider_catalog_records WHERE provider = ?').get(provider) as { c: number })
    : (db.prepare('SELECT COUNT(*) as c FROM provider_catalog_records').get() as { c: number });
  return row.c;
}

export function getProviderCatalogRecord(
  provider: LinkedLibraryProvider,
  providerGameId: string,
): ProviderGameRecord | null {
  const row = db
    .prepare('SELECT * FROM provider_catalog_records WHERE provider = ? AND providerGameId = ?')
    .get(provider, providerGameId) as ProviderCatalogRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function listProviderCatalogRecordsByProvider(provider: LinkedLibraryProvider): ProviderGameRecord[] {
  const rows = db
    .prepare('SELECT * FROM provider_catalog_records WHERE provider = ? ORDER BY title COLLATE NOCASE')
    .all(provider) as ProviderCatalogRow[];
  return rows.map(rowToRecord);
}
