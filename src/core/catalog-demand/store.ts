import db from '../database/index.js';

export type CatalogDemandKind = 'notify' | 'verification_request';

export interface CatalogDemandRow {
  catalogGameId: string;
  notifyCount: number;
  verificationRequests: number;
  lastRequestedAt: string;
}

function ensureRow(catalogGameId: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO catalog_demand (catalog_game_id, notify_count, verification_requests, last_requested_at)
     VALUES (?, 0, 0, datetime('now'))`,
  ).run(catalogGameId);
}

export function recordCatalogDemand(catalogGameId: string, kind: CatalogDemandKind): CatalogDemandRow {
  ensureRow(catalogGameId);
  if (kind === 'notify') {
    db.prepare(
      `UPDATE catalog_demand SET notify_count = notify_count + 1, last_requested_at = datetime('now')
       WHERE catalog_game_id = ?`,
    ).run(catalogGameId);
  } else {
    db.prepare(
      `UPDATE catalog_demand SET verification_requests = verification_requests + 1, last_requested_at = datetime('now')
       WHERE catalog_game_id = ?`,
    ).run(catalogGameId);
  }
  return getCatalogDemand(catalogGameId)!;
}

export function getCatalogDemand(catalogGameId: string): CatalogDemandRow | null {
  const row = db.prepare(
    `SELECT catalog_game_id AS catalogGameId, notify_count AS notifyCount,
            verification_requests AS verificationRequests, last_requested_at AS lastRequestedAt
     FROM catalog_demand WHERE catalog_game_id = ?`,
  ).get(catalogGameId) as CatalogDemandRow | undefined;
  return row ?? null;
}

export function listCatalogDemandSorted(limit = 50): CatalogDemandRow[] {
  return db.prepare(
    `SELECT catalog_game_id AS catalogGameId, notify_count AS notifyCount,
            verification_requests AS verificationRequests, last_requested_at AS lastRequestedAt
     FROM catalog_demand
     ORDER BY (notify_count + verification_requests) DESC, last_requested_at DESC
     LIMIT ?`,
  ).all(limit) as CatalogDemandRow[];
}
