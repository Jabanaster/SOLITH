import { ipcMain } from 'electron';
import {
  installedCatalogIdSet,
  installedGameCount,
  listInstalledGamesWithCatalog,
  runInstallDiscoveryScan,
} from '../src/core/install-discovery/index.js';

function sanitize(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerInstallDiscoveryIpc(): void {
  ipcMain.handle('install-discovery-scan', async (_event, payload: unknown) => {
    try {
      const options =
        payload && typeof payload === 'object'
          ? (payload as { steamInstallPath?: string; epicManifestsPath?: string; offlineRootsOnly?: boolean })
          : {};
      const result = runInstallDiscoveryScan(options);
      return {
        success: true,
        discovered: result.discovered,
        matched: result.matched,
        platforms: result.platforms,
        scannedAt: result.scannedAt,
        installedCount: installedGameCount(),
      };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('install-discovery-list', async () => {
    try {
      const games = listInstalledGamesWithCatalog();
      const catalogGameIds = [...installedCatalogIdSet()];
      return {
        success: true,
        games,
        catalogGameIds,
        total: games.length,
      };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });
}
