import path from 'node:path';
import db from '../database/index.js';
import type { InstalledGameRecord } from './types.js';

export function upsertInstalledGames(records: InstalledGameRecord[]): void {
  const stmt = db.prepare(`
    INSERT INTO installed_games (
      id, install_identity, canonical_install_path, canonical_executable_path,
      launcher_app_id, identity_version, identity_status, needs_reverification,
      catalog_game_id, platform, install_path, executable_path, display_name,
      steam_app_id, detected_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(install_identity) DO UPDATE SET
      catalog_game_id = excluded.catalog_game_id,
      canonical_install_path = excluded.canonical_install_path,
      canonical_executable_path = excluded.canonical_executable_path,
      launcher_app_id = excluded.launcher_app_id,
      identity_version = excluded.identity_version,
      identity_status = excluded.identity_status,
      needs_reverification = excluded.needs_reverification,
      install_path = excluded.install_path,
      executable_path = excluded.executable_path,
      display_name = excluded.display_name,
      steam_app_id = excluded.steam_app_id,
      last_seen_at = excluded.last_seen_at
  `);

  for (const record of records) {
    stmt.run(
      record.id,
      record.installIdentity,
      record.canonicalInstallPath,
      record.canonicalExecutablePath ?? null,
      record.launcherAppId ?? null,
      record.identityVersion,
      record.identityStatus,
      record.needsReverification ? 1 : 0,
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
            steam_app_id AS steamAppId, detected_at AS detectedAt, last_seen_at AS lastSeenAt,
            install_identity AS installIdentity,
            canonical_install_path AS canonicalInstallPath,
            canonical_executable_path AS canonicalExecutablePath,
            launcher_app_id AS launcherAppId, identity_version AS identityVersion,
            identity_status AS identityStatus, needs_reverification AS needsReverification
     FROM installed_games
     ORDER BY display_name COLLATE NOCASE`,
  ).all() as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.id),
    installIdentity: String(row.installIdentity),
    canonicalInstallPath: String(row.canonicalInstallPath),
    canonicalExecutablePath: row.canonicalExecutablePath ? String(row.canonicalExecutablePath) : undefined,
    launcherAppId: row.launcherAppId ? String(row.launcherAppId) : undefined,
    identityVersion: Number(row.identityVersion),
    identityStatus: String(row.identityStatus) as InstalledGameRecord['identityStatus'],
    needsReverification: Boolean(row.needsReverification),
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

/**
 * Resolves the on-disk executable path for a catalog game's installed copy.
 * When `executableName` is given, matches the specific install whose
 * executable basename matches (case-insensitive); otherwise returns the
 * first installed copy found. Shared by every executable-hashing caller
 * (SHA-256 definition-fingerprint compat, BLAKE3 authoritative content
 * identity) so the lookup semantics stay in exactly one place.
 */
export function findInstalledExecutablePath(catalogGameId: string, executableName?: string): string | undefined {
  const candidates = listInstalledGames().filter((game) => game.catalogGameId === catalogGameId);
  const installed = executableName
    ? candidates.find(
      (game) =>
        game.executablePath != null &&
        path.basename(game.executablePath).toLowerCase() === executableName.toLowerCase(),
    )
    : candidates[0];
  return installed?.executablePath;
}

export function countInstalledGames(): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM installed_games`).get() as { count: number };
  return Number(row.count ?? 0);
}
