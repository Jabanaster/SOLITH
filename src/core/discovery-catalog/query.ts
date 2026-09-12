/**
 * Discovery Catalog — query model (Mission 16, Phase 1 online-foundation).
 *
 * Real parameterized SQL against `discovery_catalog_entries`, built to use
 * the existing indexes (normalizedTitle, releaseYear, trainerAvailable).
 * Never concatenates caller-supplied values into the SQL string — every
 * value is passed as a bound `?` parameter.
 *
 * HONESTY NOTE on `favoriteOrPersonalOnly`: `favorites` (see
 * src/core/favorites/store.ts) is keyed by `canonical_game_id`, a
 * different ID namespace than this table's `solithGameId` (see
 * src/core/personal-library/model.ts's doc comment — canonical game IDs
 * come from src/core/canonical-games/store.ts). There is no existing join
 * key that ties the two together without duplicating personal-library
 * resolution logic, so this is deliberately implemented as a TWO-STEP
 * query: (1) read favorited canonical_game_id values, (2) filter discovery
 * entries whose solithGameId matches one of them. This only returns
 * correct results where solithGameId and canonical_game_id happen to share
 * the same identifier space for a given title — that is NOT guaranteed
 * today. Treat this filter as best-effort until discovery catalog entries
 * carry an explicit canonical-game-id cross-reference column.
 */

import db from '../database/index.js';
import type { DiscoveryCatalogEntry } from './types.js';
import type { LinkedLibraryProvider } from '../install-discovery/provider-capabilities.js';

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

export interface DiscoveryCatalogQueryOptions {
  /** Free-text search against title/normalizedTitle/aliases (case-insensitive substring). */
  text?: string;
  /** Single-provider filter (legacy). Prefer `providers` for OR-across-multiple-providers filtering (Phase 3 Mission 17). */
  provider?: LinkedLibraryProvider;
  /** Phase 3 Mission 17 — OR semantics: entries carrying ANY of these provider IDs. Combined with `provider` via AND if both given. */
  providers?: LinkedLibraryProvider[];
  trainerAvailable?: boolean;
  /** See module doc comment — best-effort two-step filter, not a guaranteed-correct join. */
  favoriteOrPersonalOnly?: boolean;
  releaseYear?: number;
  /** Discovery Master Pass, Stage 2 — inclusive range filter, combined with `releaseYear` via AND if both given. */
  releaseYearMin?: number;
  releaseYearMax?: number;
  genre?: string;
  /** Phase 3 Mission 17. Defaults to 'title-asc'. */
  sort?: 'title-asc' | 'title-desc' | 'release-desc' | 'release-asc';
  limit?: number;
  offset?: number;
}

const DEFAULT_LIMIT = 50;
/** Hard ceiling so a caller can never accidentally request the whole 100k+ catalog in one query (Mission 17: "do not return the entire catalog by default"). */
const MAX_LIMIT = 500;

const SORT_CLAUSES: Record<NonNullable<DiscoveryCatalogQueryOptions['sort']>, string> = {
  'title-asc': 'normalizedTitle ASC',
  'title-desc': 'normalizedTitle DESC',
  'release-desc': 'releaseYear DESC, normalizedTitle ASC',
  'release-asc': 'releaseYear ASC, normalizedTitle ASC',
};

/** Reads favorited canonical_game_id values directly (no import from favorites/store.ts to avoid a circular/duplicated-logic dependency beyond a single read-only SELECT). */
function getFavoritedIds(): string[] {
  const rows = db.prepare(`SELECT canonical_game_id AS id FROM favorites`).all() as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

export function queryDiscoveryCatalog(options: DiscoveryCatalogQueryOptions = {}): DiscoveryCatalogEntry[] {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (options.text && options.text.trim().length > 0) {
    const needle = `%${options.text.trim().toLowerCase()}%`;
    conditions.push('(LOWER(title) LIKE ? OR LOWER(normalizedTitle) LIKE ? OR LOWER(aliasesJson) LIKE ?)');
    params.push(needle, needle, needle);
  }

  if (options.provider) {
    // providerIdsJson is a JSON object keyed by provider — a plain key-presence
    // substring check ("<key>":) is sufficient here and avoids requiring a
    // JSON1-extension-dependent query against sql.js.
    conditions.push('providerIdsJson LIKE ?');
    params.push(`%"${options.provider}":%`);
  }

  if (options.providers && options.providers.length > 0) {
    conditions.push(`(${options.providers.map(() => 'providerIdsJson LIKE ?').join(' OR ')})`);
    for (const provider of options.providers) params.push(`%"${provider}":%`);
  }

  if (options.trainerAvailable !== undefined) {
    conditions.push('trainerAvailable = ?');
    params.push(options.trainerAvailable ? 1 : 0);
  }

  if (options.releaseYear !== undefined) {
    conditions.push('releaseYear = ?');
    params.push(options.releaseYear);
  }

  if (options.releaseYearMin !== undefined) {
    conditions.push('releaseYear >= ?');
    params.push(options.releaseYearMin);
  }

  if (options.releaseYearMax !== undefined) {
    conditions.push('releaseYear <= ?');
    params.push(options.releaseYearMax);
  }

  if (options.genre) {
    conditions.push('LOWER(genresJson) LIKE ?');
    params.push(`%"${options.genre.toLowerCase()}"%`);
  }

  if (options.favoriteOrPersonalOnly) {
    const favoritedIds = getFavoritedIds();
    if (favoritedIds.length === 0) {
      return [];
    }
    conditions.push(`solithGameId IN (${favoritedIds.map(() => '?').join(', ')})`);
    params.push(...favoritedIds);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = options.offset ?? 0;
  // Fixed lookup table, never string-interpolated from caller input directly —
  // an unrecognized sort value (e.g. an unvalidated value crossing an IPC
  // boundary) falls back to the safe default rather than producing invalid SQL.
  const orderBy = SORT_CLAUSES[options.sort ?? 'title-asc'] ?? SORT_CLAUSES['title-asc'];

  const sql = `SELECT * FROM discovery_catalog_entries ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...params, limit, offset) as DiscoveryCatalogRow[];
  return rows.map(rowToEntry);
}
