import fs from 'node:fs';
import path from 'node:path';
import db from '../database/index.js';
import { getGameById } from '../games/index.js';

/**
 * Ensure a minimal games-table row exists for catalog-only titles that need
 * save-field path approval via save_locations.
 */
export function ensureCatalogGameForSaveAccess(
  catalogGameId: string,
  displayName: string,
  userDataRoot: string,
): void {
  if (getGameById(catalogGameId)) return;

  const catalogRoot = path.join(userDataRoot, 'catalog-games', catalogGameId);
  fs.mkdirSync(catalogRoot, { recursive: true });

  db.prepare(
    `INSERT OR IGNORE INTO games (id, name, path, engine, fingerprint)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    catalogGameId,
    displayName,
    catalogRoot,
    'Catalog',
    JSON.stringify({
      fileCount: 0,
      totalSize: 0,
      keyHashes: [],
      lastScan: new Date().toISOString(),
    }),
  );
}
