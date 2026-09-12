import crypto from 'node:crypto';
import db from '../database/index.js';

/**
 * Support Request domain model — local-only for now (Mission 14/15). No
 * network call exists anywhere in this module; it only reads/writes the
 * local `support_requests` table. Designed so a FUTURE community sync layer
 * could aggregate by `canonicalGameId` + counts without ever needing to see
 * which specific user made a request, or that user's other owned games —
 * this module itself never groups requests by user (there is no user field
 * at all), so there is nothing per-user to leak even locally.
 */
export type SupportRequestStatus = 'REQUESTED' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'SUPPORTED';

export interface SupportRequest {
  requestId: string;
  canonicalGameId: string;
  gameTitle: string;
  platforms: string[];
  launcherGameIds: Record<string, string>;
  versionHint?: string;
  requestedAt: string;
  updatedAt: string;
  status: SupportRequestStatus;
}

interface SupportRequestRow {
  requestId: string;
  canonicalGameId: string;
  gameTitle: string;
  platformsJson: string;
  launcherGameIdsJson: string;
  versionHint: string | null;
  status: SupportRequestStatus;
  requestedAt: string;
  updatedAt: string;
}

function rowToRequest(row: SupportRequestRow): SupportRequest {
  return {
    requestId: row.requestId,
    canonicalGameId: row.canonicalGameId,
    gameTitle: row.gameTitle,
    platforms: JSON.parse(row.platformsJson),
    launcherGameIds: JSON.parse(row.launcherGameIdsJson),
    versionHint: row.versionHint ?? undefined,
    status: row.status,
    requestedAt: row.requestedAt,
    updatedAt: row.updatedAt,
  };
}

const SELECT_COLUMNS = `
  request_id AS requestId, canonical_game_id AS canonicalGameId, game_title AS gameTitle,
  platforms_json AS platformsJson, launcher_game_ids_json AS launcherGameIdsJson,
  version_hint AS versionHint, status, requested_at AS requestedAt, updated_at AS updatedAt
`;

/**
 * Creates a request, or returns the EXISTING one unchanged if this
 * canonical game already has one — the `UNIQUE(canonical_game_id)`
 * constraint plus this check-first pattern is what makes repeated clicks
 * a no-op instead of creating duplicate local requests (Mission 16).
 */
export function requestSupport(input: {
  canonicalGameId: string;
  gameTitle: string;
  platforms: string[];
  launcherGameIds?: Record<string, string>;
  versionHint?: string;
}): SupportRequest {
  const existing = getSupportRequestForGame(input.canonicalGameId);
  if (existing) return existing;

  const requestId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO support_requests
       (request_id, canonical_game_id, game_title, platforms_json, launcher_game_ids_json, version_hint, status, requested_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'REQUESTED', datetime('now'), datetime('now'))`,
  ).run(
    requestId,
    input.canonicalGameId,
    input.gameTitle,
    JSON.stringify(input.platforms),
    JSON.stringify(input.launcherGameIds ?? {}),
    input.versionHint ?? null,
  );
  return getSupportRequestForGame(input.canonicalGameId)!;
}

export function getSupportRequestForGame(canonicalGameId: string): SupportRequest | null {
  const row = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM support_requests WHERE canonical_game_id = ?`)
    .get(canonicalGameId) as SupportRequestRow | undefined;
  return row ? rowToRequest(row) : null;
}

export function listSupportRequests(): SupportRequest[] {
  const rows = db.prepare(`SELECT ${SELECT_COLUMNS} FROM support_requests ORDER BY requested_at DESC`).all() as SupportRequestRow[];
  return rows.map(rowToRequest);
}

function setStatus(canonicalGameId: string, status: SupportRequestStatus): SupportRequest | null {
  db.prepare(`UPDATE support_requests SET status = ?, updated_at = datetime('now') WHERE canonical_game_id = ?`).run(
    status,
    canonicalGameId,
  );
  return getSupportRequestForGame(canonicalGameId);
}

export function acknowledgeSupportRequest(canonicalGameId: string): SupportRequest | null {
  return setStatus(canonicalGameId, 'ACKNOWLEDGED');
}

export function markSupportRequestInProgress(canonicalGameId: string): SupportRequest | null {
  return setStatus(canonicalGameId, 'IN_PROGRESS');
}

/**
 * Mission 16 — "if support later becomes available, automatically
 * resolve/update the request state." Call this when the catalog gains
 * trainer support for a game (e.g. a mod pack lands) — it is a no-op if no
 * request exists for that game.
 */
export function resolveSupportRequestIfExists(canonicalGameId: string): SupportRequest | null {
  const existing = getSupportRequestForGame(canonicalGameId);
  if (!existing) return null;
  return setStatus(canonicalGameId, 'SUPPORTED');
}
