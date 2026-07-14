import db from '../database/index.js';
import type { InstalledGameRecord } from './types.js';

export function upsertInstalledGames(records: InstalledGameRecord[]): void {
  const stmt = db.prepare(`
    INSERT INTO installed_games (
      id, catalog_game_id, platform, install_path, executable_path,
      display_name, steam_app_id, detected_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(platform, install_path) DO UPDATE SET
      catalog_game_id = excluded.catalog_game_id,
      executable_path = excluded.executable_path,
      display_name = excluded.display_name,
      steam_app_id = excluded.steam_app_id,
      last_seen_at = excluded.last_seen_at
  `);

  for (const record of records) {
    stmt.run(
      record.id,
      record.catalogGameId ?? null,
      record.platform,
      record.installPath,
      record.executablePath ?? null,
      record.displayName ?? null,
      record.steamAppId ?? null,
      record.detectedAt,
      record.lastSeenAt,
    );
  }
}

export function listInstalledGames(): InstalledGameRecord[] {
  const rows = db.prepare(
    `SELECT id, catalog_game_id AS catalogGameId, platform, install_path AS installPath,
            executable_path AS executablePath, display_name AS displayName,
            steam_app_id AS steamAppId, detected_at AS detectedAt, last_seen_at AS lastSeenAt
     FROM installed_games
     ORDER BY display_name COLLATE NOCASE`,
  ).all() as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.id),
    catalogGameId: row.catalogGameId ? String(row.catalogGameId) : undefined,
    platform: String(row.platform) as InstalledGameRecord['platform'],
    installPath: String(row.installPath),
    executablePath: row.executablePath ? String(row.executablePath) : undefined,
    displayName: row.displayName ? String(row.displayName) : undefined,
    steamAppId: row.steamAppId != null ? Number(row.steamAppId) : undefined,
    detectedAt: String(row.detectedAt),
    lastSeenAt: String(row.lastSeenAt),
  }));
}

export function getInstalledCatalogGameIds(): Set<string> {
  const rows = db.prepare(
    `SELECT DISTINCT catalog_game_id AS catalogGameId FROM installed_games WHERE catalog_game_id IS NOT NULL`,
  ).all() as Array<{ catalogGameId: string }>;
  return new Set(rows.map((r) => String(r.catalogGameId)));
}

export function getInstallPathForCatalogGame(catalogGameId: string): string | undefined {
  const row = db.prepare(
    `SELECT install_path AS installPath FROM installed_games WHERE catalog_game_id = ? LIMIT 1`,
  ).get(catalogGameId) as { installPath?: string } | undefined;
  return row?.installPath ? String(row.installPath) : undefined;
}

export function countInstalledGames(): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM installed_games`).get() as { count: number };
  return Number(row.count ?? 0);
}
