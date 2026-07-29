import path from 'node:path';
import type { TrainerCatalogEntry } from '../trainer-catalog/types.js';
import type { InstalledGameRecord, RawInstalledGame } from './types.js';
import { createInstallIdentity, INSTALL_IDENTITY_VERSION } from './identity.js';

function normalizeExe(name: string): string {
  return path.basename(name).toLowerCase();
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

    const identity = createInstallIdentity(game);
    records.push({
      ...game,
      id: identity.installIdentity,
      installIdentity: identity.installIdentity,
      canonicalInstallPath: identity.canonicalInstallPath,
      canonicalExecutablePath: identity.canonicalExecutablePath,
      launcherAppId: identity.launcherAppId,
      identityVersion: INSTALL_IDENTITY_VERSION,
      identityStatus: identity.identityStatus,
      needsReverification: identity.needsReverification,
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
