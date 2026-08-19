import db from '../database/index.js';
import type { ModPack, TrainerCatalogEntry, TrainerCatalogSearchResult, VerificationStatus } from './types.js';
import { buildSearchableText } from './types.js';
import { categoryJsonLikePattern, normalizeGenreFilterList } from './catalog-genres.js';
import { normalizeCatalogTitle } from './normalize-title.js';
import {
  buildIdentityReviewRecords,
  buildSeparateIdentityCatalogGameId,
  detectIdentityCollision,
  type IdentityReviewItem,
  type IdentityReviewReason,
  type IdentityReviewRecordSummary,
  type IdentityReviewResolution,
  type IncomingCatalogWrite,
} from './identity-review.js';
import {
  isSolithDefinitionPayload,
  solithDefinitionToModPack,
} from '../definitions/mod-pack-adapter.js';
import type { SolithDefinitionV1 } from '../definitions/schema.v1.js';
import { filterEligibleForTrainerLibrary } from './eligibility-classification.js';
import { decodeHtmlEntities } from './sync/decode-html-entities.js';
import { isPlaceholderTitle, placeholderTitleLiterals } from './sync/placeholder-titles.js';

export type HubCertificationLevel = 'L0_Community' | 'L3_Certified';

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
    // Self-heals rows persisted before entity decoding was added at the sync
    // boundary (src/core/trainer-catalog/sync/parse-html.ts) — idempotent on
    // already-clean text, so this does not double-decode current writes.
    displayName: decodeHtmlEntities(String(row.displayName)),
    steamAppId: row.steamAppId != null ? Number(row.steamAppId) : undefined,
    executables: JSON.parse(String(row.executablesJson || '[]')) as string[],
    categories: JSON.parse(String(row.categoriesJson || '[]')) as string[],
    headerUrl: row.headerUrl ? String(row.headerUrl) : undefined,
    coverUrl: row.coverUrl ? String(row.coverUrl) : undefined,
    iconUrl: row.iconUrl ? String(row.iconUrl) : undefined,
    verificationStatus: String(row.verificationStatus) as VerificationStatus,
    certLevel: row.certLevel
      ? String(row.certLevel) as HubCertificationLevel
      : undefined,
    sources: JSON.parse(String(row.sourcesJson || '[]')) as TrainerCatalogEntry['sources'],
    hasModPack: Number(row.hasModPack) === 1,
    modPackId: row.modPackId ? String(row.modPackId) : undefined,
    cheatCount: Number(row.cheatCount ?? 0),
    searchableText: String(row.searchableText ?? ''),
    antiCheat: row.antiCheat ? (String(row.antiCheat) as TrainerCatalogEntry['antiCheat']) : undefined,
    offlinePlayAvailable: row.offlinePlayAvailable != null ? Number(row.offlinePlayAvailable) === 1 : undefined,
    catalogExclusionFlags: row.catalogExclusionFlagsJson
      ? (JSON.parse(String(row.catalogExclusionFlagsJson)) as TrainerCatalogEntry['catalogExclusionFlags'])
      : undefined,
    explicitlyUnsupported: row.explicitlyUnsupported != null ? Number(row.explicitlyUnsupported) === 1 : undefined,
    releaseDate: row.releaseDate ? String(row.releaseDate) : undefined,
    createdAt: row.createdAt ? String(row.createdAt) : undefined,
    contentUpdatedAt: row.contentUpdatedAt ? String(row.contentUpdatedAt) : undefined,
  };
}

interface ExistingTrainerCatalogRow {
  displayName: string;
  verificationStatus: string;
  hasModPack: number;
  modPackId: string | null;
  cheatCount: number;
  antiCheat: string | null;
  offlinePlayAvailable: number | null;
  catalogExclusionFlagsJson: string | null;
  explicitlyUnsupported: number | null;
  contentUpdatedAt: string | null;
}

/**
 * ROADMAP §3.5 "Recently updated" — fields whose change counts as a meaningful catalog
 * update. Cosmetic/technical fields (artwork URLs, source bookkeeping, searchableText,
 * executable paths, categories, steamAppId, releaseDate) are intentionally excluded so a
 * routine sync/seed/import upsert cannot silently refresh the semantic timestamp.
 */
function hasMeaningfulCatalogChange(
  existing: ExistingTrainerCatalogRow | undefined,
  entry: TrainerCatalogEntry,
  hasModPackValue: number,
  offlinePlayAvailableValue: number | null,
  catalogExclusionFlagsJson: string | null,
  explicitlyUnsupportedValue: number | null,
): boolean {
  if (!existing) return true;
  return (
    existing.displayName !== entry.displayName ||
    existing.verificationStatus !== entry.verificationStatus ||
    existing.hasModPack !== hasModPackValue ||
    (existing.modPackId ?? null) !== (entry.modPackId ?? null) ||
    existing.cheatCount !== entry.cheatCount ||
    (existing.antiCheat ?? null) !== (entry.antiCheat ?? null) ||
    (existing.offlinePlayAvailable ?? null) !== offlinePlayAvailableValue ||
    (existing.catalogExclusionFlagsJson ?? null) !== catalogExclusionFlagsJson ||
    (existing.explicitlyUnsupported ?? null) !== explicitlyUnsupportedValue
  );
}

// Higher number wins when incoming artwork (steamAppId/coverUrl/headerUrl/
// iconUrl) conflicts with artwork already stored from a different provider.
// Bundled/curated sources are authoritative; generic remote-sync scrapes
// (mrantifun/fling/plitch/remote-listing) are the lowest tier and must never
// clobber artwork a higher-precedence source already established.
const ARTWORK_PRECEDENCE: Record<TrainerCatalogEntry['sources'][number]['provider'], number> = {
  bundled: 100,
  'solith-hub': 90,
  'ct-import': 85,
  user: 80,
  community: 60,
  fearless: 50,
  mrantifun: 50,
  fling: 50,
  plitch: 50,
  'remote-listing': 40,
};

function maxArtworkPrecedence(sources: TrainerCatalogEntry['sources']): number {
  return sources.reduce((max, source) => Math.max(max, ARTWORK_PRECEDENCE[source.provider] ?? 0), 0);
}

function mergeSources(
  existing: TrainerCatalogEntry['sources'],
  incoming: TrainerCatalogEntry['sources'],
): TrainerCatalogEntry['sources'] {
  const merged = [...existing];
  for (const incomingSource of incoming) {
    const index = merged.findIndex((source) => source.provider === incomingSource.provider);
    if (index === -1) {
      merged.push(incomingSource);
    } else {
      merged[index] = incomingSource;
    }
  }
  return merged;
}

/**
 * Resolves one artwork field (steamAppId/coverUrl/headerUrl/iconUrl) against
 * whatever is already stored. Null/undefined incoming values never erase an
 * existing value. A non-empty incoming value fills an empty field. A
 * non-empty incoming value only replaces an existing non-empty value when
 * its source's artwork precedence is at least as high as the precedence
 * that already produced the stored value.
 */
function resolveArtworkField<T>(
  existingValue: T | undefined,
  incomingValue: T | undefined,
  existingPrecedence: number,
  incomingPrecedence: number,
): T | undefined {
  if (incomingValue == null) return existingValue;
  if (existingValue == null) return incomingValue;
  return incomingPrecedence >= existingPrecedence ? incomingValue : existingValue;
}

export function upsertCatalogEntry(entry: TrainerCatalogEntry): void {
  const existingEntry = getCatalogEntry(entry.catalogGameId);

  const mergedSources = existingEntry ? mergeSources(existingEntry.sources, entry.sources) : entry.sources;
  const existingPrecedence = existingEntry ? maxArtworkPrecedence(existingEntry.sources) : 0;
  const incomingPrecedence = maxArtworkPrecedence(entry.sources);

  const steamAppId = existingEntry
    ? resolveArtworkField(existingEntry.steamAppId, entry.steamAppId, existingPrecedence, incomingPrecedence)
    : entry.steamAppId;
  const headerUrl = existingEntry
    ? resolveArtworkField(existingEntry.headerUrl, entry.headerUrl, existingPrecedence, incomingPrecedence)
    : entry.headerUrl;
  const coverUrl = existingEntry
    ? resolveArtworkField(existingEntry.coverUrl, entry.coverUrl, existingPrecedence, incomingPrecedence)
    : entry.coverUrl;
  const iconUrl = existingEntry
    ? resolveArtworkField(existingEntry.iconUrl, entry.iconUrl, existingPrecedence, incomingPrecedence)
    : entry.iconUrl;

  const searchableText = entry.searchableText || buildSearchableText(entry);
  const hasModPackValue = entry.hasModPack ? 1 : 0;
  const offlinePlayAvailableValue = entry.offlinePlayAvailable != null ? (entry.offlinePlayAvailable ? 1 : 0) : null;
  const catalogExclusionFlagsJson = entry.catalogExclusionFlags ? JSON.stringify(entry.catalogExclusionFlags) : null;
  const explicitlyUnsupportedValue = entry.explicitlyUnsupported != null ? (entry.explicitlyUnsupported ? 1 : 0) : null;

  const existing = db
    .prepare(
      `SELECT displayName, verificationStatus, hasModPack, modPackId, cheatCount,
              antiCheat, offlinePlayAvailable, catalogExclusionFlagsJson, explicitlyUnsupported,
              contentUpdatedAt
       FROM trainer_catalog_games WHERE catalogGameId = ?`,
    )
    .get(entry.catalogGameId) as ExistingTrainerCatalogRow | undefined;

  const meaningfulChanged = hasMeaningfulCatalogChange(
    existing,
    entry,
    hasModPackValue,
    offlinePlayAvailableValue,
    catalogExclusionFlagsJson,
    explicitlyUnsupportedValue,
  );
  const contentUpdatedAt = meaningfulChanged ? new Date().toISOString() : existing?.contentUpdatedAt ?? null;

  db.prepare(
    `INSERT INTO trainer_catalog_games (
      catalogGameId, displayName, steamAppId, executablesJson, categoriesJson,
      headerUrl, coverUrl, iconUrl, verificationStatus, sourcesJson,
      hasModPack, modPackId, cheatCount, searchableText,
      antiCheat, offlinePlayAvailable, catalogExclusionFlagsJson, explicitlyUnsupported,
      releaseDate, createdAt, contentUpdatedAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, datetime('now'))
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
      antiCheat = excluded.antiCheat,
      offlinePlayAvailable = excluded.offlinePlayAvailable,
      catalogExclusionFlagsJson = excluded.catalogExclusionFlagsJson,
      explicitlyUnsupported = excluded.explicitlyUnsupported,
      releaseDate = excluded.releaseDate,
      contentUpdatedAt = excluded.contentUpdatedAt,
      updatedAt = datetime('now')`,
    // createdAt is intentionally absent from the UPDATE SET list above — ON CONFLICT
    // leaves it untouched, so it is only ever written by the INSERT branch.
  ).run(
    entry.catalogGameId,
    entry.displayName,
    steamAppId ?? null,
    JSON.stringify(entry.executables),
    JSON.stringify(entry.categories),
    headerUrl ?? null,
    coverUrl ?? null,
    iconUrl ?? null,
    entry.verificationStatus,
    JSON.stringify(mergedSources),
    hasModPackValue,
    entry.modPackId ?? null,
    entry.cheatCount,
    searchableText,
    entry.antiCheat ?? null,
    offlinePlayAvailableValue,
    catalogExclusionFlagsJson,
    explicitlyUnsupportedValue,
    entry.releaseDate ?? null,
    contentUpdatedAt,
  );
}

export function upsertModPack(pack: ModPack): void {
  const certLevel: HubCertificationLevel =
    pack.source.provider === 'bundled' ? 'L3_Certified' : 'L0_Community';
  db.prepare(
    `INSERT INTO trainer_mod_packs (
       packId, catalogGameId, payloadJson, verificationStatus, sourceProvider,
       syncedAt, cert_level, updated_at, updatedAt
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
     ON CONFLICT(packId) DO UPDATE SET
       catalogGameId = excluded.catalogGameId,
       payloadJson = excluded.payloadJson,
       verificationStatus = excluded.verificationStatus,
       sourceProvider = excluded.sourceProvider,
       syncedAt = excluded.syncedAt,
       cert_level = excluded.cert_level,
       updated_at = excluded.updated_at,
       updatedAt = datetime('now')`,
  ).run(
    pack.packId,
    pack.catalogGameId,
    JSON.stringify(pack),
    pack.verificationStatus,
    pack.source.provider,
    pack.syncedAt,
    certLevel,
  );
}

export interface DefinitionSyncMetadata {
  certLevel: HubCertificationLevel;
  updatedAt: number;
}

/** Store a compiled schema.v1 JSON payload (minified) in trainer_mod_packs. */
export function upsertDefinitionPayload(
  packId: string,
  catalogGameId: string,
  payloadJson: string,
  verificationStatus: VerificationStatus,
  sourceProvider: string,
  syncedAt: string,
  syncMetadata?: DefinitionSyncMetadata,
): void {
  const certLevel =
    syncMetadata?.certLevel ??
    (sourceProvider === 'bundled' ? 'L3_Certified' : 'L0_Community');
  const updatedAt = syncMetadata?.updatedAt ?? 0;
  db.prepare(
    `INSERT INTO trainer_mod_packs (
       packId, catalogGameId, payloadJson, verificationStatus, sourceProvider,
       syncedAt, cert_level, updated_at, updatedAt
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(packId) DO UPDATE SET
       catalogGameId = excluded.catalogGameId,
       payloadJson = excluded.payloadJson,
       verificationStatus = excluded.verificationStatus,
       sourceProvider = excluded.sourceProvider,
       syncedAt = excluded.syncedAt,
       cert_level = excluded.cert_level,
       updated_at = excluded.updated_at,
       updatedAt = datetime('now')`,
  ).run(
    packId,
    catalogGameId,
    payloadJson,
    verificationStatus,
    sourceProvider,
    syncedAt,
    certLevel,
    updatedAt,
  );
}

export function getDefinitionSyncMetadata(packId: string): DefinitionSyncMetadata | null {
  const row = db
    .prepare('SELECT cert_level, updated_at FROM trainer_mod_packs WHERE packId = ?')
    .get(packId) as { cert_level: HubCertificationLevel; updated_at: number } | undefined;
  return row
    ? { certLevel: row.cert_level, updatedAt: Number(row.updated_at) }
    : null;
}

export function getMaxHubDefinitionUpdatedAt(): number {
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(updated_at), 0) AS maxUpdatedAt
         FROM trainer_mod_packs
        WHERE sourceProvider = 'solith-hub'`,
    )
    .get() as { maxUpdatedAt: number };
  return Number(row.maxUpdatedAt) || 0;
}

export function hasUserAuthoredDefinition(catalogGameId: string): boolean {
  const pack = db
    .prepare(
      `SELECT 1 AS found
         FROM trainer_mod_packs
        WHERE catalogGameId = ?
          AND sourceProvider IN ('user', 'ct-import')
        LIMIT 1`,
    )
    .get(catalogGameId);
  if (pack) return true;

  const entry = getCatalogEntry(catalogGameId);
  return entry?.sources.some(
    (source) => source.provider === 'user' || source.provider === 'ct-import',
  ) ?? false;
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

export interface CatalogSearchFilters {
  categories?: string[];
  verificationStatus?: VerificationStatus | 'all';
}

function buildCatalogSearchWhere(
  query: string,
  filters: CatalogSearchFilters = {},
): { whereSql: string; params: Array<string | number> } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  // Hides already-persisted placeholder rows (e.g. "[REDACTED]") without
  // deleting them. Exact-match only, so legitimate bracketed titles like
  // "[NINJA GAIDEN - Master Collection] NINJA GAIDEN 3" are unaffected —
  // only rows whose ENTIRE trimmed displayName is one of these literals.
  clauses.push(
    `TRIM(displayName) != '' AND LOWER(TRIM(displayName)) NOT IN (${placeholderTitleLiterals()
      .map(() => '?')
      .join(', ')})`,
  );
  params.push(...placeholderTitleLiterals());

  const q = query.trim().toLowerCase();
  if (q) {
    clauses.push('searchableText LIKE ?');
    params.push(`%${q.replace(/[%_]/g, '')}%`);
  }

  const genres = normalizeGenreFilterList(filters.categories);
  if (genres.length > 0) {
    const genreClauses = genres.map(() => 'categoriesJson LIKE ?');
    clauses.push(`(${genreClauses.join(' OR ')})`);
    params.push(...genres.map((g) => categoryJsonLikePattern(g)));
  }

  if (filters.verificationStatus && filters.verificationStatus !== 'all') {
    clauses.push('verificationStatus = ?');
    params.push(filters.verificationStatus);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return { whereSql, params };
}

export function searchCatalog(
  query: string,
  limit = 48,
  offset = 0,
  filters: CatalogSearchFilters = {},
): TrainerCatalogSearchResult {
  const { whereSql, params } = buildCatalogSearchWhere(query, filters);

  const total = (
    db.prepare(`SELECT COUNT(*) as c FROM trainer_catalog_games ${whereSql}`).get(...params) as { c: number }
  ).c;

  const rows = db
    .prepare(
      `SELECT trainer_catalog_games.*,
              (
                SELECT cert_level
                  FROM trainer_mod_packs
                 WHERE trainer_mod_packs.catalogGameId = trainer_catalog_games.catalogGameId
                 ORDER BY syncedAt DESC
                 LIMIT 1
              ) AS certLevel
         FROM trainer_catalog_games ${whereSql}
       ORDER BY
         CASE verificationStatus WHEN 'verified' THEN 0 WHEN 'community' THEN 1 ELSE 2 END,
         displayName COLLATE NOCASE
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Record<string, unknown>[];

  // Central §3.2 exclusion boundary (Step 9) — excluded titles never re-enter
  // Trainer Library results here, regardless of which UI path calls searchCatalog.
  const entries = filterEligibleForTrainerLibrary(rows.map(rowToEntry));

  return {
    entries,
    total,
    query,
    offset,
    limit,
  };
}

export function getCatalogEntry(catalogGameId: string): TrainerCatalogEntry | null {
  const row = db.prepare(
    `SELECT trainer_catalog_games.*,
            (
              SELECT cert_level
                FROM trainer_mod_packs
               WHERE trainer_mod_packs.catalogGameId = trainer_catalog_games.catalogGameId
               ORDER BY syncedAt DESC
               LIMIT 1
            ) AS certLevel
       FROM trainer_catalog_games
      WHERE catalogGameId = ?`,
  ).get(catalogGameId) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToEntry(row) : null;
}

/**
 * User-facing single-entry lookup: same as getCatalogEntry(), but hides
 * exact placeholder titles (e.g. "[REDACTED]") the same way the browse/search
 * listing does. Use this from renderer-exposed IPC handlers. getCatalogEntry()
 * itself stays raw/internal — quarantine, promotion, hub sync, discovery, and
 * health-check logic all need to see placeholder rows to manage them, and
 * none of them render displayName to the user.
 */
export function getCatalogEntryForDisplay(catalogGameId: string): TrainerCatalogEntry | null {
  const entry = getCatalogEntry(catalogGameId);
  if (!entry || isPlaceholderTitle(entry.displayName) || entry.displayName.trim() === '') {
    return null;
  }
  return entry;
}

export function getDefinitionCertificationForGame(
  catalogGameId: string,
): HubCertificationLevel | undefined {
  const row = db
    .prepare(
      `SELECT cert_level
         FROM trainer_mod_packs
        WHERE catalogGameId = ?
        ORDER BY syncedAt DESC
        LIMIT 1`,
    )
    .get(catalogGameId) as { cert_level: HubCertificationLevel } | undefined;
  return row?.cert_level;
}

export function countCatalogEntries(): number {
  return (db.prepare('SELECT COUNT(*) as c FROM trainer_catalog_games').get() as { c: number }).c;
}

/**
 * Idempotent cleanup for community-sourced catalog rows whose displayName
 * would be rejected by the current title-validation rules (e.g. rows
 * ingested before normalizeCatalogTitle() was applied at parse time).
 * Bundled/curated entries are never touched. Safe to run repeatedly.
 */
export function pruneInvalidCommunityCatalogTitles(): string[] {
  const rows = db
    .prepare(
      `SELECT catalogGameId, displayName, modPackId FROM trainer_catalog_games
       WHERE verificationStatus = 'community'`,
    )
    .all() as { catalogGameId: string; displayName: string; modPackId: string | null }[];

  const removed: string[] = [];
  for (const row of rows) {
    if (normalizeCatalogTitle(row.displayName) !== null) continue;
    db.prepare('DELETE FROM trainer_catalog_games WHERE catalogGameId = ?').run(row.catalogGameId);
    if (row.modPackId) {
      db.prepare('DELETE FROM trainer_mod_packs WHERE packId = ?').run(row.modPackId);
    }
    removed.push(row.catalogGameId);
  }
  return removed;
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

/** Returns null instead of throwing on a corrupted leftRecordJson/rightRecordJson cell. */
function parseIdentityReviewRow(row: Record<string, unknown>): IdentityReviewItem | null {
  try {
    return {
      id: String(row.id),
      reason: String(row.reason) as IdentityReviewReason,
      status: String(row.status) as IdentityReviewItem['status'],
      leftRecord: JSON.parse(String(row.leftRecordJson)) as IdentityReviewRecordSummary,
      rightRecord: JSON.parse(String(row.rightRecordJson)) as IdentityReviewRecordSummary,
      resolution: row.resolution ? (String(row.resolution) as IdentityReviewResolution) : undefined,
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
      resolvedAt: row.resolvedAt ? String(row.resolvedAt) : undefined,
    };
  } catch {
    return null;
  }
}

function getIdentityReviewItem(id: string): IdentityReviewItem | null {
  const row = db.prepare('SELECT * FROM catalog_identity_review WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? parseIdentityReviewRow(row) : null;
}

/**
 * Creates a pending review row if this exact collision fingerprint hasn't been seen
 * before; otherwise returns the existing row untouched (never resets an already
 * resolved/ignored decision back to pending).
 */
function createOrReuseIdentityReviewItem(
  id: string,
  reason: IdentityReviewReason,
  leftRecord: IdentityReviewRecordSummary,
  rightRecord: IdentityReviewRecordSummary,
): IdentityReviewItem {
  db.prepare(
    `INSERT INTO catalog_identity_review (id, reason, status, leftRecordJson, rightRecordJson)
     VALUES (?, ?, 'pending', ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(id, reason, JSON.stringify(leftRecord), JSON.stringify(rightRecord));
  const item = getIdentityReviewItem(id);
  if (!item) throw new Error(`Failed to persist identity review item ${id}`);
  return item;
}

export function listPendingIdentityReviewItems(): IdentityReviewItem[] {
  const rows = db
    .prepare(
      `SELECT * FROM catalog_identity_review WHERE status = 'pending' ORDER BY createdAt ASC, id ASC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map(parseIdentityReviewRow).filter((item): item is IdentityReviewItem => item !== null);
}

export function getPendingIdentityReviewCount(): number {
  return (
    db.prepare(`SELECT COUNT(*) as c FROM catalog_identity_review WHERE status = 'pending'`).get() as {
      c: number;
    }
  ).c;
}

/**
 * Applies a human resolution decision to a pending review item.
 *
 * - keep-existing / ignore: mark resolved, write nothing (existing row is left intact).
 * - accept-incoming: write the deferred incoming entry over the existing catalogGameId.
 * - treat-separate: write the deferred incoming entry under a new, deterministic
 *   catalogGameId (`${original}--${provider}`) instead of colliding with the existing one.
 *
 * Returns null if the review item does not exist or is no longer pending.
 */
export function resolveIdentityReviewItem(
  id: string,
  resolution: IdentityReviewResolution,
): IdentityReviewItem | null {
  const item = getIdentityReviewItem(id);
  if (!item || item.status !== 'pending') return null;

  if (resolution === 'accept-incoming') {
    upsertCatalogEntry({ ...item.rightRecord.entry, catalogGameId: item.leftRecord.entry.catalogGameId });
  } else if (resolution === 'treat-separate') {
    const separateId = buildSeparateIdentityCatalogGameId(
      item.leftRecord.entry.catalogGameId,
      item.rightRecord.provider,
    );
    upsertCatalogEntry({ ...item.rightRecord.entry, catalogGameId: separateId });
  }
  // keep-existing / ignore: no catalog write — existing record stays exactly as-is.

  const status: IdentityReviewItem['status'] = resolution === 'ignore' ? 'ignored' : 'resolved';
  db.prepare(
    `UPDATE catalog_identity_review
        SET status = ?, resolution = ?, updatedAt = datetime('now'), resolvedAt = datetime('now')
      WHERE id = ?`,
  ).run(status, resolution, id);

  return getIdentityReviewItem(id);
}

/**
 * Safe write boundary for community catalog sync (Step 5/6 of Phase 1.7): upserts
 * normally when there is no existing row, when the write is provably the same
 * identity, or when this exact collision was already resolved by a human. Otherwise
 * defers the write, preserving the existing record, and files/reuses a review item.
 */
export function upsertCatalogEntryWithIdentityReview(
  incoming: IncomingCatalogWrite,
): { deferred: boolean; reviewId?: string; writtenCatalogGameId?: string } {
  const existing = getCatalogEntry(incoming.entry.catalogGameId);
  if (!existing) {
    upsertCatalogEntry(incoming.entry);
    return { deferred: false, writtenCatalogGameId: incoming.entry.catalogGameId };
  }

  const collision = detectIdentityCollision(existing, incoming);
  if (!collision) {
    upsertCatalogEntry(incoming.entry);
    return { deferred: false, writtenCatalogGameId: incoming.entry.catalogGameId };
  }

  const existingReview = getIdentityReviewItem(collision.fingerprint);
  if (existingReview && existingReview.status !== 'pending') {
    if (existingReview.resolution === 'accept-incoming') {
      upsertCatalogEntry(incoming.entry);
      return { deferred: false, writtenCatalogGameId: incoming.entry.catalogGameId };
    }
    if (existingReview.resolution === 'treat-separate') {
      const separateId = buildSeparateIdentityCatalogGameId(existing.catalogGameId, incoming.provider);
      upsertCatalogEntry({ ...incoming.entry, catalogGameId: separateId });
      return { deferred: false, writtenCatalogGameId: separateId };
    }
    // keep-existing / ignore: honor the human decision, skip the write again.
    return { deferred: true, reviewId: existingReview.id };
  }

  const { leftRecord, rightRecord } = buildIdentityReviewRecords(existing, incoming);
  const item = createOrReuseIdentityReviewItem(collision.fingerprint, collision.reason, leftRecord, rightRecord);
  return { deferred: true, reviewId: item.id };
}
