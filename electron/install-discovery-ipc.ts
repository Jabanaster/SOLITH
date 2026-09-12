import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { validateIpcSender } from './sender-validation.js';
import { z } from 'zod';
import {
  commitInstallDiscoveryRecords,
  installedCatalogIdSet,
  installedGameCount,
  listInstalledGamesWithCatalog,
  previewInstallDiscoveryScan,
  runInstallDiscoveryScan,
} from '../src/core/install-discovery/index.js';
import { listInstalledGames } from '../src/core/install-discovery/store.js';
import { listProviderCapabilities } from '../src/core/install-discovery/provider-capabilities.js';

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

function requireTrustedSender(event: IpcMainInvokeEvent): { ok: true } | { ok: false; reason: string } {
  const result = validateIpcSender(event, ['main']);
  if (!result.ok) return { ok: false, reason: result.reason ?? 'unknown' };
  return { ok: true };
}

/** Phase 7 B2 hardening — see electron/main.ts's handleGuarded for the pattern this mirrors. */
function guardedHandle(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => any,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    const senderCheck = requireTrustedSender(event);
    if (senderCheck.ok === false) {
      return { success: false, error: `sender_rejected:${senderCheck.reason}` };
    }
    return listener(event, ...args);
  });
}

export function registerInstallDiscoveryIpc(): void {
  guardedHandle('install-discovery-pick-folder', async (event) => {
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

  guardedHandle('install-discovery-preview', async (_event, payload: unknown) => {
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

  guardedHandle('install-discovery-commit', async (_event, payload: unknown) => {
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

  guardedHandle('install-discovery-scan', async (_event, payload: unknown) => {
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

  guardedHandle('install-discovery-list', async () => {
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

  // Mission 8/9: Linked Game Libraries UI foundation. This is read-only,
  // static capability data plus a real local install count per provider —
  // never fabricated "Connected"/account-sync state for providers with no
  // scanner (see provider-capabilities.ts's doc comment for why).
  guardedHandle('linked-libraries-list', async () => {
    try {
      const capabilities = listProviderCapabilities();
      const installedByPlatform = new Map<string, number>();
      // Mission 19 — "Last scan" per provider: the most recent lastSeenAt
      // across that provider's own installed_games rows. This is real,
      // already-tracked per-row data (install-discovery/store.ts), not a new
      // persisted field — a provider with zero installed rows has never
      // produced evidence, so it stays `null` ("Never scanned") rather than
      // guessing a timestamp.
      const lastScanByPlatform = new Map<string, string>();
      for (const game of listInstalledGames()) {
        installedByPlatform.set(game.platform, (installedByPlatform.get(game.platform) ?? 0) + 1);
        const existing = lastScanByPlatform.get(game.platform);
        if (!existing || game.lastSeenAt > existing) {
          lastScanByPlatform.set(game.platform, game.lastSeenAt);
        }
      }
      const providers = capabilities.map((capability) => ({
        ...capability,
        localInstalledCount: installedByPlatform.get(capability.provider) ?? 0,
        lastScanAt: lastScanByPlatform.get(capability.provider) ?? null,
      }));
      return { success: true, providers };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });
}
