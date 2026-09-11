/**
 * Discovery Catalog — store (Mission 6, Phase 1 online-foundation).
 *
 * Row-mapping pattern follows src/core/artwork-cache/store.ts: JSON-encoded
 * array/object columns are parsed on read and stringified on write; optional
 * fields are only included in the mapped object when present (spread guard),
 * never written as `undefined`/`null` placeholders.
 */

import db from '../database/index.js';
import type { DiscoveryCatalogEntry } from './types.js';

interface DiscoveryCatalogRow {
  solithGameId: string;
  title: string;
  normalizedTitle: string;
  aliasesJson: string;
  providerIdsJson: string;
  type: string;
  releaseDate: string | null;
  releaseYear: number | null;
  genresJson: string;
  tagsJson: string;
  trainerAvailable: number;
  ctAvailable: number;
  updatedAt: string;
}

function rowToEntry(row: DiscoveryCatalogRow): DiscoveryCatalogEntry {
  return {
    solithGameId: row.solithGameId,
    title: row.title,
    normalizedTitle: row.normalizedTitle,
    aliases: JSON.parse(row.aliasesJson) as string[],
    providerIds: JSON.parse(row.providerIdsJson) as DiscoveryCatalogEntry['providerIds'],
    type: row.type,
    genres: JSON.parse(row.genresJson) as string[],
    tags: JSON.parse(row.tagsJson) as string[],
    trainerAvailable: row.trainerAvailable === 1,
    ctAvailable: row.ctAvailable === 1,
    updatedAt: row.updatedAt,
    ...(row.releaseDate != null ? { releaseDate: row.releaseDate } : {}),
    ...(row.releaseYear != null ? { releaseYear: row.releaseYear } : {}),
  };
}

/** Upserts by `solithGameId` — the primary key dedup boundary for this table. */
export function upsertDiscoveryCatalogEntry(entry: DiscoveryCatalogEntry): void {
  db.prepare(
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
  ).run(
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
  );
}

export function getDiscoveryCatalogEntry(solithGameId: string): DiscoveryCatalogEntry | null {
  const row = db
    .prepare(`SELECT * FROM discovery_catalog_entries WHERE solithGameId = ?`)
    .get(solithGameId) as DiscoveryCatalogRow | undefined;
  return row ? rowToEntry(row) : null;
}

export function countDiscoveryCatalogEntries(): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM discovery_catalog_entries`).get() as
    | { count: number }
    | undefined;
  return row?.count ?? 0;
}
