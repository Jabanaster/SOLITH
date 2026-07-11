import db from '../database/index.js';
import type { ModPack, TrainerCatalogEntry, TrainerCatalogSearchResult, VerificationStatus } from './types.js';
import { buildSearchableText } from './types.js';
import {
  isSolithDefinitionPayload,
  solithDefinitionToModPack,
} from '../definitions/mod-pack-adapter.js';
import type { SolithDefinitionV1 } from '../definitions/schema.v1.js';

function parseModPackPayload(payloadJson: string): ModPack {
  const raw = JSON.parse(payloadJson) as unknown;
  if (isSolithDefinitionPayload(raw)) {
    return solithDefinitionToModPack(raw as SolithDefinitionV1);
  }
  return raw as ModPack;
}

function rowToEntry(row: Record<string, unknown>): TrainerCatalogEntry {
  return {
    catalogGameId: String(row.catalogGameId),
    displayName: String(row.displayName),
    steamAppId: row.steamAppId != null ? Number(row.steamAppId) : undefined,
    executables: JSON.parse(String(row.executablesJson || '[]')) as string[],
    categories: JSON.parse(String(row.categoriesJson || '[]')) as string[],
    headerUrl: row.headerUrl ? String(row.headerUrl) : undefined,
    coverUrl: row.coverUrl ? String(row.coverUrl) : undefined,
    iconUrl: row.iconUrl ? String(row.iconUrl) : undefined,
    verificationStatus: String(row.verificationStatus) as VerificationStatus,
    sources: JSON.parse(String(row.sourcesJson || '[]')) as TrainerCatalogEntry['sources'],
    hasModPack: Number(row.hasModPack) === 1,
    modPackId: row.modPackId ? String(row.modPackId) : undefined,
    cheatCount: Number(row.cheatCount ?? 0),
    searchableText: String(row.searchableText ?? ''),
  };
}

export function upsertCatalogEntry(entry: TrainerCatalogEntry): void {
  const searchableText = entry.searchableText || buildSearchableText(entry);
  db.prepare(
    `INSERT INTO trainer_catalog_games (
      catalogGameId, displayName, steamAppId, executablesJson, categoriesJson,
      headerUrl, coverUrl, iconUrl, verificationStatus, sourcesJson,
      hasModPack, modPackId, cheatCount, searchableText, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(catalogGameId) DO UPDATE SET
      displayName = excluded.displayName,
      steamAppId = excluded.steamAppId,
      executablesJson = excluded.executablesJson,
      categoriesJson = excluded.categoriesJson,
      headerUrl = excluded.headerUrl,
      coverUrl = excluded.coverUrl,
      iconUrl = excluded.iconUrl,
      verificationStatus = excluded.verificationStatus,
      sourcesJson = excluded.sourcesJson,
      hasModPack = excluded.hasModPack,
      modPackId = excluded.modPackId,
      cheatCount = excluded.cheatCount,
      searchableText = excluded.searchableText,
      updatedAt = datetime('now')`,
  ).run(
    entry.catalogGameId,
    entry.displayName,
    entry.steamAppId ?? null,
    JSON.stringify(entry.executables),
    JSON.stringify(entry.categories),
    entry.headerUrl ?? null,
    entry.coverUrl ?? null,
    entry.iconUrl ?? null,
    entry.verificationStatus,
    JSON.stringify(entry.sources),
    entry.hasModPack ? 1 : 0,
    entry.modPackId ?? null,
    entry.cheatCount,
    searchableText,
  );
}

export function upsertModPack(pack: ModPack): void {
  db.prepare(
    `INSERT INTO trainer_mod_packs (packId, catalogGameId, payloadJson, verificationStatus, sourceProvider, syncedAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(packId) DO UPDATE SET
       catalogGameId = excluded.catalogGameId,
       payloadJson = excluded.payloadJson,
       verificationStatus = excluded.verificationStatus,
       sourceProvider = excluded.sourceProvider,
       syncedAt = excluded.syncedAt,
       updatedAt = datetime('now')`,
  ).run(
    pack.packId,
    pack.catalogGameId,
    JSON.stringify(pack),
    pack.verificationStatus,
    pack.source.provider,
    pack.syncedAt,
  );
}

/** Store a compiled schema.v1 JSON payload (minified) in trainer_mod_packs. */
export function upsertDefinitionPayload(
  packId: string,
  catalogGameId: string,
  payloadJson: string,
  verificationStatus: VerificationStatus,
  sourceProvider: string,
  syncedAt: string,
): void {
  db.prepare(
    `INSERT INTO trainer_mod_packs (packId, catalogGameId, payloadJson, verificationStatus, sourceProvider, syncedAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(packId) DO UPDATE SET
       catalogGameId = excluded.catalogGameId,
       payloadJson = excluded.payloadJson,
       verificationStatus = excluded.verificationStatus,
       sourceProvider = excluded.sourceProvider,
       syncedAt = excluded.syncedAt,
       updatedAt = datetime('now')`,
  ).run(packId, catalogGameId, payloadJson, verificationStatus, sourceProvider, syncedAt);
}

export function getDefinitionPayload(catalogGameId: string): SolithDefinitionV1 | null {
  const row = db
    .prepare('SELECT payloadJson FROM trainer_mod_packs WHERE catalogGameId = ? ORDER BY syncedAt DESC LIMIT 1')
    .get(catalogGameId) as { payloadJson: string } | undefined;
  if (!row) return null;
  const raw = JSON.parse(row.payloadJson) as unknown;
  return isSolithDefinitionPayload(raw) ? (raw as SolithDefinitionV1) : null;
}

export function getModPack(packId: string): ModPack | null {
  const row = db.prepare('SELECT payloadJson FROM trainer_mod_packs WHERE packId = ?').get(packId) as
    | { payloadJson: string }
    | undefined;
  if (!row) return null;
  return parseModPackPayload(row.payloadJson);
}

export function getModPackForGame(catalogGameId: string): ModPack | null {
  const row = db
    .prepare('SELECT payloadJson FROM trainer_mod_packs WHERE catalogGameId = ? ORDER BY syncedAt DESC LIMIT 1')
    .get(catalogGameId) as { payloadJson: string } | undefined;
  if (!row) return null;
  return parseModPackPayload(row.payloadJson);
}

export function searchCatalog(query: string, limit = 48, offset = 0): TrainerCatalogSearchResult {
  const q = query.trim().toLowerCase();
  let rows: Record<string, unknown>[];
  let total: number;

  if (!q) {
    total = (db.prepare('SELECT COUNT(*) as c FROM trainer_catalog_games').get() as { c: number }).c;
    rows = db
      .prepare(
        `SELECT * FROM trainer_catalog_games ORDER BY
          CASE verificationStatus WHEN 'verified' THEN 0 WHEN 'community' THEN 1 ELSE 2 END,
          displayName COLLATE NOCASE LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as Record<string, unknown>[];
  } else {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    total = (
      db
        .prepare('SELECT COUNT(*) as c FROM trainer_catalog_games WHERE searchableText LIKE ?')
        .get(like) as { c: number }
    ).c;
    rows = db
      .prepare(
        `SELECT * FROM trainer_catalog_games WHERE searchableText LIKE ?
         ORDER BY
           CASE verificationStatus WHEN 'verified' THEN 0 WHEN 'community' THEN 1 ELSE 2 END,
           displayName COLLATE NOCASE
         LIMIT ? OFFSET ?`,
      )
      .all(like, limit, offset) as Record<string, unknown>[];
  }

  return {
    entries: rows.map(rowToEntry),
    total,
    query,
    offset,
    limit,
  };
}

export function getCatalogEntry(catalogGameId: string): TrainerCatalogEntry | null {
  const row = db.prepare('SELECT * FROM trainer_catalog_games WHERE catalogGameId = ?').get(catalogGameId) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToEntry(row) : null;
}

export function countCatalogEntries(): number {
  return (db.prepare('SELECT COUNT(*) as c FROM trainer_catalog_games').get() as { c: number }).c;
}

export function logTrainerSync(provider: string, status: string, detail: string, imported = 0): void {
  db.prepare(
    `INSERT INTO trainer_sync_log (provider, status, detail, importedCount, syncedAt)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  ).run(provider, status, detail, imported);
}

export function getRecentSyncLogs(limit = 20): Array<{ provider: string; status: string; detail: string; importedCount: number; syncedAt: string }> {
  return db
    .prepare('SELECT provider, status, detail, importedCount, syncedAt FROM trainer_sync_log ORDER BY syncedAt DESC LIMIT ?')
    .all(limit) as Array<{ provider: string; status: string; detail: string; importedCount: number; syncedAt: string }>;
}
