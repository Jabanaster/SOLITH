import { searchCatalog, countCatalogEntries } from '../trainer-catalog/store.js';
import { ensureCatalogSeeded, resolveSeedPath } from '../trainer-catalog/seed.js';
import { getSetting, setSetting } from '../settings/index.js';
import { scanEpicInstalls } from './epic.js';
import { scanGogInstalls } from './gog.js';
import { countMatchedCatalog, matchInstalledToCatalog } from './match.js';
import { scanSteamInstalls } from './steam.js';
import { countInstalledGames, getInstalledCatalogGameIds, listInstalledGames, upsertInstalledGames } from './store.js';
import { runTrainerHealthCheck } from '../trainer-health/index.js';
import type { InstallDiscoveryOptions, InstallDiscoveryScanResult, InstalledGameRecord } from './types.js';

export function discoverRawInstalls(options: InstallDiscoveryOptions = {}) {
  const steam = scanSteamInstalls(options);
  // Epic: allow fixture manifests even when offlineRootsOnly is set.
  const epic =
    options.offlineRootsOnly && !options.epicManifestsPath
      ? []
      : scanEpicInstalls(options);
  // GOG: allow fixture JSON even when offlineRootsOnly is set; skip live registry otherwise.
  const gog =
    options.gogFixturePath
      ? scanGogInstalls(options)
      : options.offlineRootsOnly
        ? []
        : scanGogInstalls(options);
  return [...steam, ...epic, ...gog];
}

export function runInstallDiscoveryScan(
  options: InstallDiscoveryOptions = {},
): InstallDiscoveryScanResult & { records: InstalledGameRecord[] } {
  const scannedAt = new Date().toISOString();
  if (countCatalogEntries() < 100) {
    try {
      ensureCatalogSeeded(resolveSeedPath(process.cwd()), 1000);
    } catch {
      // Catalog seed optional for scan — matching may be sparse
    }
  }
  const raw = discoverRawInstalls(options);
  const catalog = searchCatalog('', 5000, 0).entries;
  const records = matchInstalledToCatalog(raw, catalog, scannedAt);

  if (getSetting('installDiscoveryEnabled') !== false) {
    upsertInstalledGames(records);
    setSetting('installDiscoveryLastScan', scannedAt);
    try {
      runTrainerHealthCheck();
    } catch {
      // Health check is best-effort after scan
    }
  }

  const platforms = {
    steam: raw.filter((g) => g.platform === 'steam').length,
    epic: raw.filter((g) => g.platform === 'epic').length,
    gog: raw.filter((g) => g.platform === 'gog').length,
    manual: 0,
  };

  return {
    discovered: raw.length,
    matched: countMatchedCatalog(records),
    platforms,
    scannedAt,
    records,
  };
}

export function listInstalledGamesWithCatalog(): InstalledGameRecord[] {
  return listInstalledGames();
}

export function installedCatalogIdSet(): Set<string> {
  return getInstalledCatalogGameIds();
}

export function installedGameCount(): number {
  return countInstalledGames();
}
