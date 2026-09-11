/**
 * Phase 2 Part B — request/row validation and row->JSON projection.
 *
 * Field names on the JSON side deliberately match, camelCase-for-camelCase,
 * the CLIENT-side contracts this backend serves:
 *   - src/core/discovery-catalog/types.ts's `DiscoveryCatalogEntry`
 *   - src/core/trainer-catalog/coverage-index.ts's `TrainerCoverageRecord`
 *   - src/core/sync-manifest/types.ts's `SyncManifestDelta`
 * (all in the main SOLITH repo, not this package) so
 * `fetchSyncManifest`'s `isSyncManifestDeltaShape` guard accepts this
 * backend's response body with ZERO client-code changes.
 */
import { z } from 'zod';

/** Matches src/core/sync-manifest/types.ts's SyncRevision grammar exactly: unpadded non-negative base-10 integer as a string. */
export const revisionStringSchema = z
  .string()
  .max(32)
  .regex(/^(0|[1-9][0-9]{0,30})$/, 'Must be an unpadded non-negative base-10 integer string');

/** `GET /catalog/sync?since=<revision>` query. `since` is optional — omitted means "full sync from the beginning". */
export const syncQuerySchema = z.object({
  since: revisionStringSchema.optional(),
});

/** Exact SHA-256 hex digest shape — the ONLY key artifacts are ever looked up by. Rejects anything else before any storage lookup happens. */
export const artifactHashParamSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, 'Must be a 64-character lowercase hex SHA-256 digest');

export interface DiscoveryCatalogEntryRow {
  solith_game_id: string;
  title: string;
  normalized_title: string;
  aliases_json: string;
  provider_ids_json: string;
  type: string;
  release_date: string | null;
  release_year: number | null;
  genres_json: string;
  tags_json: string;
  trainer_available: number;
  ct_available: number;
  updated_at: string;
  revision: number;
}

export interface TrainerCoverageRow {
  game_id: string;
  trainer_available: number;
  trainer_id: string | null;
  trainer_version: string | null;
  game_build_hint: string | null;
  cheat_count: number;
  trust_state: string;
  artifact_hash: string | null;
  artifact_size_bytes: number | null;
  last_updated: string;
  author: string | null;
  source: string | null;
  revision: number;
}

export interface DeletedCatalogEntryRow {
  solith_game_id: string;
  deleted_at: string;
  revision: number;
}

/** Parses a JSON TEXT column defensively — malformed stored JSON must never crash the response, only degrade to an empty/default value. */
function parseJsonArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Row -> `DiscoveryCatalogEntry`-shaped JSON (main repo type). */
export function projectDiscoveryCatalogEntry(row: DiscoveryCatalogEntryRow): Record<string, unknown> {
  return {
    solithGameId: row.solith_game_id,
    title: row.title,
    normalizedTitle: row.normalized_title,
    aliases: parseJsonArray(row.aliases_json),
    providerIds: parseJsonObject(row.provider_ids_json),
    type: row.type,
    ...(row.release_date ? { releaseDate: row.release_date } : {}),
    ...(row.release_year !== null ? { releaseYear: row.release_year } : {}),
    genres: parseJsonArray(row.genres_json),
    tags: parseJsonArray(row.tags_json),
    trainerAvailable: row.trainer_available !== 0,
    ctAvailable: row.ct_available !== 0,
    updatedAt: row.updated_at,
  };
}

/** Row -> `TrainerCoverageRecord`-shaped JSON (main repo type). */
export function projectTrainerCoverageRow(row: TrainerCoverageRow): Record<string, unknown> {
  return {
    gameId: row.game_id,
    trainerAvailable: row.trainer_available !== 0,
    ...(row.trainer_id ? { trainerId: row.trainer_id } : {}),
    ...(row.trainer_version ? { trainerVersion: row.trainer_version } : {}),
    ...(row.game_build_hint ? { gameBuildHint: row.game_build_hint } : {}),
    cheatCount: row.cheat_count,
    trustState: row.trust_state,
    ...(row.artifact_hash ? { artifactHash: row.artifact_hash } : {}),
    ...(row.artifact_size_bytes !== null ? { artifactSizeBytes: row.artifact_size_bytes } : {}),
    lastUpdated: row.last_updated,
    ...(row.author ? { author: row.author } : {}),
    ...(row.source ? { source: row.source } : {}),
  };
}
