import { ipcMain, app } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  searchCatalog,
  countCatalogEntries,
  getCatalogEntry,
  getRecentSyncLogs,
} from '../src/core/trainer-catalog/store.js';
import { ensureCatalogSeeded, resolveSeedPath } from '../src/core/trainer-catalog/seed.js';
import { syncAllTrainerSources } from '../src/core/trainer-catalog/sync/index.js';
import { loadGameConfigFromCatalog } from '../src/core/trainer-catalog/mod-pack-loader.js';
import { registerGame } from '../src/core/cheat-system/game-registry.js';
import { getSetting } from '../src/core/settings/index.js';
import { importDefinitionYaml } from '../src/core/definitions/import-definition.js';

const SearchSchema = z.object({
  query: z.string().max(200).optional().default(''),
  limit: z.number().int().min(1).max(200).optional().default(48),
  offset: z.number().int().min(0).optional().default(0),
});

const CatalogGameIdSchema = z.object({
  catalogGameId: z.string().min(1).max(120),
});

const ImportYamlSchema = z.object({
  yamlText: z.string().min(1).max(2_000_000),
});

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirectory = path.dirname(moduleFilename);
const projectRoot = path.resolve(moduleDirectory, '..');

export function registerTrainerCatalogIpc(): void {
  ipcMain.handle('trainer-catalog-search', async (_event, payload: unknown) => {
    try {
      const parsed = SearchSchema.parse(payload ?? {});
      const result = searchCatalog(parsed.query, parsed.limit, parsed.offset);
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('trainer-catalog-stats', async () => {
    try {
      return {
        success: true,
        total: countCatalogEntries(),
        recentSyncs: getRecentSyncLogs(10),
      };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('trainer-catalog-get', async (_event, payload: unknown) => {
    try {
      const parsed = CatalogGameIdSchema.parse(payload);
      const entry = getCatalogEntry(parsed.catalogGameId);
      if (!entry) return { success: false, error: 'not_found' };
      return { success: true, entry };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('trainer-catalog-seed', async () => {
    try {
      const seedPath = resolvePackagedSeedPath();
      const total = ensureCatalogSeeded(seedPath, 1000);
      return { success: true, total };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('trainer-catalog-sync-remote', async () => {
    try {
      if (getSetting('v2RemoteCatalogSyncEnabled') === false) {
        return { success: false, error: 'remote_sync_disabled' };
      }
      const report = await syncAllTrainerSources();
      return { success: true, report };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('trainer-catalog-load-game', async (_event, payload: unknown) => {
    try {
      const parsed = CatalogGameIdSchema.parse(payload);
      const config = loadGameConfigFromCatalog(parsed.catalogGameId);
      if (!config) return { success: false, error: 'no_mod_pack' };
      registerGame(config);
      return {
        success: true,
        gameId: config.gameId,
        name: config.name,
        cheatCount: config.cheats.length,
        config,
      };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('trainer-catalog-import-yaml', async (_event, payload: unknown) => {
    try {
      const parsed = ImportYamlSchema.parse(payload);
      const result = importDefinitionYaml(parsed.yamlText);
      if (!result.success) {
        return { success: false, errors: result.errors };
      }
      return {
        success: true,
        catalogGameId: result.catalogGameId,
        packId: result.packId,
        cheatCount: result.cheatCount,
        title: result.definition.title,
      };
    } catch (error) {
      return { success: false, errors: [sanitize(error)] };
    }
  });
}

function resolvePackagedSeedPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'data', 'trainer-catalog-seed.json');
  }
  return resolveSeedPath(projectRoot);
}

export async function bootstrapTrainerCatalog(): Promise<void> {
  const seedPath = resolvePackagedSeedPath();
  try {
    ensureCatalogSeeded(seedPath, 1000);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[trainer-catalog] Seed bootstrap skipped:', error);
  }

  const { getSetting, setSetting } = await import('../src/core/settings/index.js');
  if (getSetting('v2RemoteCatalogSyncEnabled') === false) return;
  if (getSetting('trainerRemoteSyncCompleted') === true) return;

  try {
    await syncAllTrainerSources();
    setSetting('trainerRemoteSyncCompleted', true);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[trainer-catalog] Remote sync skipped:', error);
  }
}

function sanitize(error: unknown): string {
  return error instanceof Error ? error.message : 'trainer_catalog_error';
}
