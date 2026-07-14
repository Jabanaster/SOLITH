import path from 'node:path';
import type { TrainerCatalogEntry } from '../trainer-catalog/types.js';
import type { InstalledGameRecord, RawInstalledGame } from './types.js';

function normalizeExe(name: string): string {
  return path.basename(name).toLowerCase();
}

function buildInstalledId(game: RawInstalledGame): string {
  const key = `${game.platform}:${path.resolve(game.installPath).toLowerCase()}`;
  return key;
}

export function matchInstalledToCatalog(
  installed: RawInstalledGame[],
  catalog: TrainerCatalogEntry[],
  scannedAt: string,
): InstalledGameRecord[] {
  const bySteamId = new Map<number, TrainerCatalogEntry>();
  const byExecutable = new Map<string, TrainerCatalogEntry[]>();

  for (const entry of catalog) {
    if (entry.steamAppId != null && entry.steamAppId < 1_000_000) {
      bySteamId.set(entry.steamAppId, entry);
    }
    for (const exe of entry.executables) {
      const key = normalizeExe(exe);
      const list = byExecutable.get(key) ?? [];
      list.push(entry);
      byExecutable.set(key, list);
    }
  }

  const records: InstalledGameRecord[] = [];

  for (const game of installed) {
    let match: TrainerCatalogEntry | undefined;

    if (game.steamAppId != null) {
      match = bySteamId.get(game.steamAppId);
    }

    if (!match && game.executablePath) {
      const candidates = byExecutable.get(normalizeExe(game.executablePath)) ?? [];
      if (candidates.length === 1) {
        match = candidates[0];
      } else if (candidates.length > 1 && game.displayName) {
        const lower = game.displayName.toLowerCase();
        match = candidates.find((c) => c.displayName.toLowerCase() === lower) ?? candidates[0];
      }
    }

    records.push({
      ...game,
      id: buildInstalledId(game),
      catalogGameId: match?.catalogGameId,
      catalogDisplayName: match?.displayName,
      detectedAt: scannedAt,
      lastSeenAt: scannedAt,
    });
  }

  return records;
}

export function countMatchedCatalog(records: InstalledGameRecord[]): number {
  return records.filter((r) => r.catalogGameId).length;
}
