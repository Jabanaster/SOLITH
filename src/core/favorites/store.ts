import db from '../database/index.js';

/**
 * Favorites — a plain boolean flag per canonical game, persisted locally.
 * Does NOT alter ownership/installed/support truth in any way; purely a
 * user-chosen marker with a dedicated filter/view.
 */
export interface FavoriteRow {
  canonicalGameId: string;
  favoritedAt: string;
}

export function isFavorite(canonicalGameId: string): boolean {
  const row = db.prepare(`SELECT 1 FROM favorites WHERE canonical_game_id = ?`).get(canonicalGameId);
  return Boolean(row);
}

export function addFavorite(canonicalGameId: string): FavoriteRow {
  db.prepare(
    `INSERT OR IGNORE INTO favorites (canonical_game_id, favorited_at) VALUES (?, datetime('now'))`,
  ).run(canonicalGameId);
  return getFavorite(canonicalGameId)!;
}

export function removeFavorite(canonicalGameId: string): void {
  db.prepare(`DELETE FROM favorites WHERE canonical_game_id = ?`).run(canonicalGameId);
}

export function toggleFavorite(canonicalGameId: string): boolean {
  if (isFavorite(canonicalGameId)) {
    removeFavorite(canonicalGameId);
    return false;
  }
  addFavorite(canonicalGameId);
  return true;
}

export function getFavorite(canonicalGameId: string): FavoriteRow | null {
  const row = db
    .prepare(`SELECT canonical_game_id AS canonicalGameId, favorited_at AS favoritedAt FROM favorites WHERE canonical_game_id = ?`)
    .get(canonicalGameId) as FavoriteRow | undefined;
  return row ?? null;
}

export function listFavoriteIds(): string[] {
  const rows = db.prepare(`SELECT canonical_game_id AS canonicalGameId FROM favorites`).all() as Array<{ canonicalGameId: string }>;
  return rows.map((r) => r.canonicalGameId);
}
