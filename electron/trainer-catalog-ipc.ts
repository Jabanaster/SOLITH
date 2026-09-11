import { BrowserWindow, dialog, ipcMain, app, type IpcMainInvokeEvent } from 'electron';
import { validateIpcSender } from './sender-validation.js';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  searchCatalog,
  countCatalogEntries,
  getCatalogEntryForDisplay,
  getDefinitionPayload,
  getRecentSyncLogs,
  hasUserAuthoredDefinition,
  listPendingIdentityReviewItems,
  getPendingIdentityReviewCount,
  resolveIdentityReviewItem,
  setCatalogEntryOwnedConfirmed,
} from '../src/core/trainer-catalog/store.js';
import { ensureCatalogSeeded, resolveSeedPath } from '../src/core/trainer-catalog/seed.js';
import { ensureBundledDefinitions } from '../src/core/trainer-catalog/ensure-bundled-definitions.js';
import { syncAllTrainerSources } from '../src/core/trainer-catalog/sync/index.js';
import {
  publishCommunityDefinition,
  syncCommunityDefinitions,
} from '../src/core/trainer-catalog/sync/hub-client.js';
import { loadGameConfigFromCatalog } from '../src/core/trainer-catalog/mod-pack-loader.js';
import { registerGame } from '../src/core/cheat-system/game-registry.js';
import { getSetting } from '../src/core/settings/index.js';
import { isOnlineOperationAllowed } from '../src/core/settings/online-services-gate.js';
import { importDefinitionYaml } from '../src/core/definitions/import-definition.js';
import { importDefinitionCt, previewDefinitionCt } from '../src/core/definitions/import-definition-ct.js';
import {
  recordDefinitionFeedback,
  getDefinitionFeedbackSummary,
  listPositiveFeedbackCountsSorted,
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
import { resolveSaveEditControlsDualRead } from '../src/core/definitions/dual-read-save-controls.js';
import { ensureCatalogGameForSaveAccess } from '../src/core/trainer-catalog/catalog-game-record.js';
import { addUserSelectedLocation } from '../src/core/saves/locations.js';
import { SolithDefinitionV1Schema } from '../src/core/definitions/schema.v1.js';
import { POPULAR_TRAINER_LIMIT } from '../src/core/trainer-catalog/popular-ranking.js';

const ApproveSavePathSchema = z.object({
  catalogGameId: z.string().min(1).max(120),
  saveFilePath: z.string().min(1).max(4096),
});

const SearchSchema = z.object({
  query: z.string().max(200).optional().default(''),
  // Max raised from 200 to POPULAR_TRAINER_LIMIT (ROADMAP §3.3) so the Trainer
  // Library's Popular view can fetch its full bounded ranking candidate set in
  // one request instead of paginating.
  limit: z.number().int().min(1).max(POPULAR_TRAINER_LIMIT).optional().default(48),
  offset: z.number().int().min(0).optional().default(0),
  categories: z.array(z.string().min(1).max(40)).max(12).optional(),
  verificationStatus: z
    .enum(['all', 'verified', 'community', 'metadata-only', 'unverified'])
    .optional()
    .default('all'),
});

const CatalogGameIdSchema = z.object({
  catalogGameId: z.string().min(1).max(120),
});

/** ROADMAP §3.6 Availability "Owned" — deliberate local user confirmation, never inferred. */
const SetOwnedSchema = z.object({
  catalogGameId: z.string().min(1).max(120),
  owned: z.boolean(),
});

const ImportYamlSchema = z.object({
  yamlText: z.string().min(1).max(2_000_000),
});

const PickedCtSchema = z.object({
  filePath: z.string().min(1).max(4096),
  xmlText: z.string().min(1).max(8_000_000),
  title: z.string().min(1).max(200),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();

const PublishToCommunitySchema = z.object({
  definition: SolithDefinitionV1Schema,
  executableHash: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();

const SyncHubSchema = z.object({
  overwriteUserDefinitions: z.boolean().optional().default(false),
}).strict();

const ResolveIdentityReviewSchema = z.object({
  id: z.string().min(1).max(64),
  resolution: z.enum(['keep-existing', 'accept-incoming', 'treat-separate', 'ignore']),
}).strict();

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirectory = path.dirname(moduleFilename);
const projectRoot = path.resolve(moduleDirectory, '..');

function requireTrustedSender(event: IpcMainInvokeEvent): { ok: true } | { ok: false; reason: string } {
  const result = validateIpcSender(event, ['main']);
  if (!result.ok) return { ok: false, reason: result.reason ?? 'unknown' };
  return { ok: true };
}

/** Phase 7 B2 hardening — see electron/main.ts's handleGuarded for the pattern this mirrors. */
function handleGuarded(
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

export function registerTrainerCatalogIpc(): void {
  handleGuarded('trainer-catalog-search', async (_event, payload: unknown) => {
    try {
      const parsed = SearchSchema.parse(payload ?? {});
      const result = searchCatalog(parsed.query, parsed.limit, parsed.offset, {
        categories: parsed.categories,
        verificationStatus: parsed.verificationStatus,
      });
      // Phase 1: attach schema.v1 capability lanes (read-only derivation; no execute change).
      const entries = result.entries.map((entry) => {
        const definition = loadCatalogDefinition(entry.catalogGameId);
        return {
          ...entry,
          capabilities: definition ? catalogDefinitionCapabilities(definition) : null,
        };
      });
      return { success: true, ...result, entries };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  handleGuarded('trainer-catalog-stats', async () => {
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

  handleGuarded('trainer-catalog-get', async (_event, payload: unknown) => {
    try {
      const parsed = CatalogGameIdSchema.parse(payload);
      const entry = getCatalogEntryForDisplay(parsed.catalogGameId);
      if (!entry) return { success: false, error: 'not_found' };
      return { success: true, entry };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  handleGuarded('trainer-catalog-seed', async () => {
    try {
      const seedPath = resolvePackagedSeedPath();
      const total = ensureCatalogSeeded(seedPath, 1000);
      ensureBundledDefinitions();
      return { success: true, total };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  handleGuarded('trainer-catalog-sync-remote', async () => {
    try {
      const onlineServicesEnabled = getSetting('onlineServicesEnabled') !== false;
      if (!isOnlineOperationAllowed({ onlineServicesEnabled }, 'catalog-refresh')) {
        return { success: false, error: 'online_services_disabled' };
      }
      if (getSetting('v2RemoteCatalogSyncEnabled') === false) {
        return { success: false, error: 'remote_sync_disabled' };
      }
      const report = await syncAllTrainerSources();
      return { success: true, report };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  handleGuarded('trainer-catalog-sync-hub', async (_event, payload: unknown) => {
    try {
      const onlineServicesEnabled = getSetting('onlineServicesEnabled') !== false;
      if (!isOnlineOperationAllowed({ onlineServicesEnabled }, 'community-sync')) {
        return { success: false, error: 'online_services_disabled' };
      }
      const parsed = SyncHubSchema.parse(payload ?? {});
      const report = await syncCommunityDefinitions({
        overwriteUserDefinitions: parsed.overwriteUserDefinitions === true,
      });
      return { success: report.status === 'synced', report };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  handleGuarded('trainer-catalog-get-definition', async (_event, payload: unknown) => {
    try {
      const parsed = CatalogGameIdSchema.parse(payload);
      const definition = getDefinitionPayload(parsed.catalogGameId);
      if (!definition) return { success: false, error: 'no_definition' };
      const validated = SolithDefinitionV1Schema.parse(definition);
      return {
        success: true,
        definition: validated,
        canPublish: hasUserAuthoredDefinition(parsed.catalogGameId),
      };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  handleGuarded('publishToCommunity', async (_event, payload: unknown) => {
    try {
      const onlineServicesEnabled = getSetting('onlineServicesEnabled') !== false;
      if (!isOnlineOperationAllowed({ onlineServicesEnabled }, 'trainer-upload')) {
        return { success: false, error: 'online_services_disabled' };
      }
      const parsed = PublishToCommunitySchema.parse(payload);
      const published = await publishCommunityDefinition(parsed);
      return { success: true, published };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  handleGuarded('trainer-catalog-load-game', async (_event, payload: unknown) => {
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

  handleGuarded('trainer-catalog-get-trainer-controls', async (_event, payload: unknown) => {
    try {
      const parsed = CatalogGameIdSchema.parse(payload);
      const dual = resolveSaveEditControlsDualRead({ catalogGameId: parsed.catalogGameId });
      const definition = loadCatalogDefinition(parsed.catalogGameId);
      if (dual.controls.length === 0 && !definition) {
        return { success: false, error: 'no_definition' };
      }
      return {
        success: true,
        controls: dual.controls,
        source: dual.source,
        capabilities: definition ? catalogDefinitionCapabilities(definition) : null,
      };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  handleGuarded('trainer-catalog-approve-save-path', async (_event, payload: unknown) => {
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

  handleGuarded('trainer-catalog-pick-ct', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      const picked = await dialog.showOpenDialog(win ?? undefined, {
        title: 'Import Cheat Engine table as inert Solith metadata',
        properties: ['openFile'],
        filters: [{ name: 'Cheat Engine tables', extensions: ['ct', 'xml'] }],
      });
      if (picked.canceled || picked.filePaths.length === 0) {
        return { success: false, canceled: true };
      }
      const filePath = picked.filePaths[0];
      if (!/\.(ct|xml)$/i.test(filePath)) {
        return { success: false, error: 'unsupported_ct_file_type' };
      }
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) return { success: false, error: 'not_a_file' };
      if (stat.size < 1) return { success: false, error: 'empty_ct_file' };
      if (stat.size > 8_000_000) return { success: false, error: 'ct_file_too_large' };
      const xmlText = await fs.readFile(filePath, 'utf8');
      const sha256 = crypto.createHash('sha256').update(xmlText, 'utf8').digest('hex');
      return {
        success: true,
        filePath,
        xmlText,
        title: path.basename(filePath).replace(/\.(ct|xml)$/i, ''),
        sha256,
      };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  handleGuarded('trainer-catalog-preview-ct', async (_event, payload: unknown) => {
    try {
      const parsed = PickedCtSchema.parse(payload);
      const currentHash = crypto.createHash('sha256').update(parsed.xmlText, 'utf8').digest('hex');
      if (currentHash !== parsed.sha256) {
        return { success: false, errors: ['source_hash_changed_before_preview'] };
      }
      const result = await previewDefinitionCt(parsed.xmlText, { title: parsed.title });
      if (result.success === false) {
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
        metadataImport: result.metadataImport,
        scriptOnlyCount: result.scriptOnlyCount,
        scriptAnalysisCount: result.scriptAnalysisCount,
        sourceHash: parsed.sha256,
        filePath: parsed.filePath,
      };
    } catch (error) {
      return { success: false, errors: [sanitize(error)] };
    }
  });

  handleGuarded('trainer-catalog-import-ct', async (_event, payload: unknown) => {
    try {
      const parsed = ImportCtSchema.parse(payload);
      const result = await importDefinitionCt(parsed.xmlText, { title: parsed.title });
      if (result.success === false) {
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

  handleGuarded('trainer-catalog-feedback-record', async (_event, payload: unknown) => {
    try {
      const parsed = DefinitionFeedbackSchema.parse(payload);
      // `rating` is a required z.union of literals in DefinitionFeedbackSchema
      // and always present after a successful .parse(); tsconfig.electron.json
      // runs with strictNullChecks disabled, under which zod's own optionality
      // inference loosens every required object property to optional.
      recordDefinitionFeedback({ ...parsed, rating: parsed.rating as -1 | 0 | 1 });
      const summary = getDefinitionFeedbackSummary(parsed.catalogGameId, parsed.featureId);
      return { success: true, summary };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  handleGuarded('trainer-catalog-set-owned', async (_event, payload: unknown) => {
    try {
      const parsed = SetOwnedSchema.parse(payload);
      setCatalogEntryOwnedConfirmed(parsed.catalogGameId, parsed.owned);
      const entry = getCatalogEntryForDisplay(parsed.catalogGameId);
      return { success: true, ownedConfirmed: entry?.ownedConfirmed ?? parsed.owned };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  handleGuarded('trainer-catalog-feedback-summary', async (_event, payload: unknown) => {
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

  handleGuarded('trainer-catalog-all-time-popularity-list', async () => {
    try {
      // ROADMAP §3.5 "All-time popular" — lifetime positive community feedback count,
      // deliberately distinct from the "Popular now" catalog_demand signal.
      return { success: true, popularity: listPositiveFeedbackCountsSorted(500) };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  handleGuarded('trainer-catalog-evaluate-promotion', async (_event, payload: unknown) => {
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

  handleGuarded('trainer-catalog-promote-verified', async (_event, payload: unknown) => {
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

  handleGuarded('trainer-catalog-export-definition', async (_event, payload: unknown) => {
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

  handleGuarded('trainer-catalog-pending-quarantine', async () => {
    try {
      const pending = listPendingDefinitionUpdates(100);
      return { success: true, pending };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  handleGuarded('trainer-catalog-identity-review-list', async () => {
    try {
      const items = listPendingIdentityReviewItems();
      return { success: true, items };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  handleGuarded('trainer-catalog-identity-review-count', async () => {
    try {
      const count = getPendingIdentityReviewCount();
      return { success: true, count };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  handleGuarded('trainer-catalog-identity-review-resolve', async (_event, payload: unknown) => {
    try {
      const parsed = ResolveIdentityReviewSchema.parse(payload);
      const item = resolveIdentityReviewItem(parsed.id, parsed.resolution);
      if (!item) return { success: false, error: 'review_item_not_found_or_not_pending' };
      return { success: true, item };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  handleGuarded('trainer-catalog-import-yaml', async (_event, payload: unknown) => {
    try {
      const parsed = ImportYamlSchema.parse(payload);
      const result = importDefinitionYaml(parsed.yamlText);
      if (result.success === false) {
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
  if (
    getSetting('v2RemoteCatalogSyncEnabled') !== false &&
    getSetting('trainerRemoteSyncCompleted') !== true
  ) {
    try {
      await syncAllTrainerSources();
      setSetting('trainerRemoteSyncCompleted', true);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[trainer-catalog] Remote sync skipped:', error);
    }
  }

  // Automatic Hub polling is owned by electron/community-sync-orchestrator.ts
  // (opt-in via communitySyncEnabled). Do not fetch here.
}

function sanitize(error: unknown): string {
  return error instanceof Error ? error.message : 'trainer_catalog_error';
}
