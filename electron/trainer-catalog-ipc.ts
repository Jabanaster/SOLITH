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
import { ensureBundledDefinitions } from '../src/core/trainer-catalog/bundled-definition-seed.js';
import { syncAllTrainerSources } from '../src/core/trainer-catalog/sync/index.js';
import { loadGameConfigFromCatalog } from '../src/core/trainer-catalog/mod-pack-loader.js';
import { registerGame } from '../src/core/cheat-system/game-registry.js';
import { getSetting } from '../src/core/settings/index.js';
import { importDefinitionYaml } from '../src/core/definitions/import-definition.js';
import { importDefinitionCt } from '../src/core/definitions/import-definition-ct.js';
import {
  recordDefinitionFeedback,
  getDefinitionFeedbackSummary,
} from '../src/core/trainer-catalog/definition-feedback-store.js';
import {
  listPendingDefinitionUpdates,
  isDefinitionQuarantined,
} from '../src/core/trainer-catalog/definition-quarantine.js';
import { evaluatePromotionEligibility, promoteDefinitionToVerified } from '../src/core/trainer-catalog/definition-promotion.js';
import { DefinitionFeedbackSchema, ImportCtSchema } from './ipc-validation.js';
import { exportCatalogDefinitionToYaml } from '../src/core/definitions/export-catalog-definition.js';
import {
  loadCatalogDefinition,
  catalogDefinitionCapabilities,
} from '../src/core/definitions/load-catalog-definition.js';
import { solithDefinitionToTrainerControls } from '../src/core/definitions/definition-to-trainer-controls.js';
import { ensureCatalogGameForSaveAccess } from '../src/core/trainer-catalog/catalog-game-record.js';
import { addUserSelectedLocation } from '../src/core/saves/locations.js';

const ApproveSavePathSchema = z.object({
  catalogGameId: z.string().min(1).max(120),
  saveFilePath: z.string().min(1).max(4096),
});

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
      ensureBundledDefinitions();
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
      const definition = loadCatalogDefinition(parsed.catalogGameId);
      const config = loadGameConfigFromCatalog(parsed.catalogGameId);
      if (!config && !definition) return { success: false, error: 'no_mod_pack' };
      if (config) registerGame(config);

      const capabilities = definition ? catalogDefinitionCapabilities(definition) : null;
      if (capabilities && capabilities.saveControlCount > 0) {
        ensureCatalogGameForSaveAccess(
          parsed.catalogGameId,
          capabilities.title,
          app.getPath('userData'),
        );
      }

      return {
        success: true,
        gameId: config?.gameId ?? parsed.catalogGameId,
        name: config?.name ?? capabilities?.title ?? parsed.catalogGameId,
        cheatCount: config?.cheats.length ?? 0,
        config: config ?? undefined,
        capabilities,
      };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('trainer-catalog-get-trainer-controls', async (_event, payload: unknown) => {
    try {
      const parsed = CatalogGameIdSchema.parse(payload);
      const definition = loadCatalogDefinition(parsed.catalogGameId);
      if (!definition) return { success: false, error: 'no_definition' };
      const controls = solithDefinitionToTrainerControls(definition);
      return {
        success: true,
        controls,
        capabilities: catalogDefinitionCapabilities(definition),
      };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('trainer-catalog-approve-save-path', async (_event, payload: unknown) => {
    try {
      const parsed = ApproveSavePathSchema.parse(payload);
      const definition = loadCatalogDefinition(parsed.catalogGameId);
      if (!definition) return { success: false, error: 'no_definition' };

      ensureCatalogGameForSaveAccess(
        parsed.catalogGameId,
        definition.title,
        app.getPath('userData'),
      );

      const parentDir = path.dirname(parsed.saveFilePath);
      const result = addUserSelectedLocation(parsed.catalogGameId, parentDir);
      if (!result.success) return { success: false, error: result.error ?? 'approve_failed' };
      return { success: true, locationId: result.location?.id };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('trainer-catalog-import-ct', async (_event, payload: unknown) => {
    try {
      const parsed = ImportCtSchema.parse(payload);
      const result = await importDefinitionCt(parsed.xmlText, { title: parsed.title });
      if (!result.success) {
        return { success: false, errors: result.errors, rejected: result.rejected };
      }
      return {
        success: true,
        catalogGameId: result.catalogGameId,
        packId: result.packId,
        cheatCount: result.cheatCount,
        title: result.title,
        acceptedCount: result.acceptedCount,
        rejectedCount: result.rejectedCount,
        rejected: result.rejected,
        validationErrors: result.validationErrors,
      };
    } catch (error) {
      return { success: false, errors: [sanitize(error)] };
    }
  });

  ipcMain.handle('trainer-catalog-feedback-record', async (_event, payload: unknown) => {
    try {
      const parsed = DefinitionFeedbackSchema.parse(payload);
      recordDefinitionFeedback(parsed);
      const summary = getDefinitionFeedbackSummary(parsed.catalogGameId, parsed.featureId);
      return { success: true, summary };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('trainer-catalog-feedback-summary', async (_event, payload: unknown) => {
    try {
      const parsed = CatalogGameIdSchema.parse(payload);
      const summary = getDefinitionFeedbackSummary(parsed.catalogGameId);
      const quarantined = isDefinitionQuarantined(parsed.catalogGameId);
      const pending = listPendingDefinitionUpdates(20).filter((r) => r.catalogGameId === parsed.catalogGameId);
      return { success: true, summary, quarantined, pendingUpdates: pending.length };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('trainer-catalog-evaluate-promotion', async (_event, payload: unknown) => {
    try {
      const parsed = CatalogGameIdSchema.parse(payload);
      const definition = loadCatalogDefinition(parsed.catalogGameId);
      if (!definition) return { success: false, error: 'no_definition' };
      const eligibility = evaluatePromotionEligibility(definition);
      return { success: true, eligibility };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('trainer-catalog-promote-verified', async (_event, payload: unknown) => {
    try {
      const parsed = CatalogGameIdSchema.parse(payload);
      const definition = loadCatalogDefinition(parsed.catalogGameId);
      if (!definition) return { success: false, error: 'no_definition' };
      const promoted = promoteDefinitionToVerified(definition);
      return { success: true, catalogGameId: promoted.id, verificationStatus: promoted.safety.verificationStatus };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('trainer-catalog-export-definition', async (_event, payload: unknown) => {
    try {
      const parsed = CatalogGameIdSchema.parse(payload);
      const bundle = exportCatalogDefinitionToYaml(parsed.catalogGameId);
      if (!bundle) return { success: false, error: 'no_definition' };
      return {
        success: true,
        catalogGameId: parsed.catalogGameId,
        filename: bundle.filename,
        yaml: bundle.yaml,
        title: bundle.definition.title,
        verificationStatus: bundle.definition.safety.verificationStatus,
      };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('trainer-catalog-pending-quarantine', async () => {
    try {
      const pending = listPendingDefinitionUpdates(100);
      return { success: true, pending };
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
    ensureBundledDefinitions();
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
