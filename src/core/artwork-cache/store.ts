import db from '../database/index.js';
import type { ArtworkCacheEntry, ArtworkCacheStatus, ArtworkKind, ArtworkRightsClass } from './types.js';

interface ArtworkCacheRow {
  catalogGameId: string;
  kind: string;
  sourceUrl: string;
  rightsClass: string;
  licenseNote: string | null;
  localPath: string;
  sizeBytes: number;
  status: string;
  fetchedAt: string;
  lastError: string | null;
}

function rowToEntry(row: ArtworkCacheRow): ArtworkCacheEntry {
  return {
    catalogGameId: row.catalogGameId,
    kind: row.kind as ArtworkKind,
    sourceUrl: row.sourceUrl,
    rightsClass: row.rightsClass as ArtworkRightsClass,
    localPath: row.localPath,
    sizeBytes: row.sizeBytes,
    status: row.status as ArtworkCacheStatus,
    fetchedAt: row.fetchedAt,
    ...(row.licenseNote != null ? { licenseNote: row.licenseNote } : {}),
    ...(row.lastError != null ? { lastError: row.lastError } : {}),
  };
}

/** Upserts the full cache record — atomic single-row write, always the last step after a verified disk write (or a recorded failure/rights-block). */
export function upsertArtworkCacheEntry(entry: ArtworkCacheEntry): void {
  db.prepare(
    `INSERT INTO artwork_cache (catalogGameId, kind, sourceUrl, rightsClass, licenseNote, localPath, sizeBytes, status, fetchedAt, lastError)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(catalogGameId, kind) DO UPDATE SET
       sourceUrl = excluded.sourceUrl,
       rightsClass = excluded.rightsClass,
       licenseNote = excluded.licenseNote,
       localPath = excluded.localPath,
       sizeBytes = excluded.sizeBytes,
       status = excluded.status,
       fetchedAt = excluded.fetchedAt,
       lastError = excluded.lastError`,
  ).run(
    entry.catalogGameId,
    entry.kind,
    entry.sourceUrl,
    entry.rightsClass,
    entry.licenseNote ?? null,
    entry.localPath,
    entry.sizeBytes,
    entry.status,
    entry.fetchedAt,
    entry.lastError ?? null,
  );
}

export function getArtworkCacheEntry(catalogGameId: string, kind: ArtworkKind): ArtworkCacheEntry | null {
  const row = db
    .prepare(`SELECT * FROM artwork_cache WHERE catalogGameId = ? AND kind = ?`)
    .get(catalogGameId, kind) as ArtworkCacheRow | undefined;
  return row ? rowToEntry(row) : null;
}

/** Cache keys (see cache-key.ts) currently in 'ok' status — feeds queue.ts's "no redundant successful re-fetch" dedup. */
export function listOkArtworkCacheKeys(): Set<string> {
  const rows = db
    .prepare(`SELECT catalogGameId, kind FROM artwork_cache WHERE status = 'ok'`)
    .all() as Array<{ catalogGameId: string; kind: string }>;
  return new Set(rows.map((row) => `${row.catalogGameId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120)}__${row.kind}`));
}

export function listFailedArtworkCacheEntries(): ArtworkCacheEntry[] {
  const rows = db.prepare(`SELECT * FROM artwork_cache WHERE status = 'failed'`).all() as ArtworkCacheRow[];
  return rows.map(rowToEntry);
}

export function listAllArtworkCacheEntries(): ArtworkCacheEntry[] {
  const rows = db.prepare(`SELECT * FROM artwork_cache`).all() as ArtworkCacheRow[];
  return rows.map(rowToEntry);
}
