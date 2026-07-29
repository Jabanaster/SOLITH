import { BrowserWindow, dialog, ipcMain } from 'electron';
import { z } from 'zod';
import {
  commitInstallDiscoveryRecords,
  installedCatalogIdSet,
  installedGameCount,
  listInstalledGamesWithCatalog,
  previewInstallDiscoveryScan,
  runInstallDiscoveryScan,
} from '../src/core/install-discovery/index.js';

function sanitize(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const DiscoveryOptionsSchema = z.object({
  steamInstallPath: z.string().min(1).max(4096).optional(),
  epicManifestsPath: z.string().min(1).max(4096).optional(),
  gogFixturePath: z.string().min(1).max(4096).optional(),
  offlineRootsOnly: z.boolean().optional(),
  userSelectedRoots: z.array(z.string().min(1).max(4096)).max(24).optional(),
  includeCommonRoots: z.boolean().optional(),
}).strict();

const InstallCommitSelectionSchema = z.object({
  platform: z.enum(['steam', 'epic', 'gog', 'xbox', 'manual']),
  installPath: z.string().min(1).max(4096),
  executablePath: z.string().min(1).max(4096).optional(),
  displayName: z.string().max(240).optional(),
  steamAppId: z.number().int().positive().optional(),
  launcherAppId: z.string().min(1).max(240).optional(),
}).strict();

const CommitRecordsSchema = z.object({
  records: z.array(InstallCommitSelectionSchema).max(500),
}).strict();

export function registerInstallDiscoveryIpc(): void {
  ipcMain.handle('install-discovery-pick-folder', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(win ?? undefined, {
        title: 'Select a local game library folder',
        properties: ['openDirectory'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }
      return { success: true, folderPath: result.filePaths[0] };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('install-discovery-preview', async (_event, payload: unknown) => {
    try {
      const options = DiscoveryOptionsSchema.parse(payload ?? {});
      const result = previewInstallDiscoveryScan(options);
      return {
        success: true,
        ...result,
        unsupported: result.unsupported.length,
      };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('install-discovery-commit', async (_event, payload: unknown) => {
    try {
      const parsed = CommitRecordsSchema.parse(payload);
      const result = commitInstallDiscoveryRecords(parsed.records);
      return {
        success: true,
        ...result,
        installedCount: installedGameCount(),
      };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('install-discovery-scan', async (_event, payload: unknown) => {
    try {
      const options = DiscoveryOptionsSchema.parse(payload ?? {});
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
