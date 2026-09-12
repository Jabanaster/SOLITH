import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { validateIpcSender } from './sender-validation.js';
import path from 'node:path';
import {
  listInstalledGamesWithCatalog,
  runInstallDiscoveryScan,
} from '../src/core/install-discovery/index.js';
import { listInstalledGames } from '../src/core/install-discovery/store.js';
import {
  getTrainerHealthMap,
  listTrainerHealthRecords,
  runOfflineCertify,
  runTrainerHealthCheck,
} from '../src/core/trainer-health/index.js';
import { recordCatalogDemand, listCatalogDemandSorted } from '../src/core/catalog-demand/store.js';
import { loadCatalogDefinition } from '../src/core/definitions/load-catalog-definition.js';
import { buildTrainerDeckRows } from '../src/core/trainer-deck/build-deck-rows.js';
import { getCatalogEntryForDisplay } from '../src/core/trainer-catalog/store.js';
import { catalogDefinitionCapabilities } from '../src/core/definitions/load-catalog-definition.js';
import { resolveSaveEditControlsDualRead } from '../src/core/definitions/dual-read-save-controls.js';
import {
  setCatalogProcessWatchInterval,
  getActiveProcessDetections,
} from './catalog-process-watch.js';

function sanitize(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPathUnderApprovedInstall(targetPath: string, installPath: string): boolean {
  const normalizedTarget = path.resolve(targetPath);
  const normalizedInstall = path.resolve(installPath);
  return (
    normalizedTarget === normalizedInstall ||
    normalizedTarget.startsWith(normalizedInstall + path.sep)
  );
}

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

export function registerTrainerDeckIpc(): void {
  guardedHandle('trainer-deck-get', async (_event, payload: unknown) => {
    try {
      const catalogGameId =
        payload && typeof payload === 'object' && 'catalogGameId' in payload
          ? String((payload as { catalogGameId: string }).catalogGameId)
          : '';
      if (!catalogGameId) return { success: false, error: 'missing_catalog_game_id' };

      const entry = getCatalogEntryForDisplay(catalogGameId);
      const definition = loadCatalogDefinition(catalogGameId);
      const health = runTrainerHealthCheck(catalogGameId)[0];
      const installed = listInstalledGames().find((g) => g.catalogGameId === catalogGameId);
      const demand = listCatalogDemandSorted(500).find((d) => d.catalogGameId === catalogGameId);

      const dual = resolveSaveEditControlsDualRead({ catalogGameId });

      return {
        success: true,
        entry,
        capabilities: definition ? catalogDefinitionCapabilities(definition) : null,
        rows: definition ? buildTrainerDeckRows(definition) : [],
        controls: dual.controls,
        controlsSource: dual.source,
        health,
        installed,
        demand: demand ?? null,
        // The single global "last detection" can be a DIFFERENT game than the
        // one this deck is for (any catalog game's process poll updates it).
        // Look up this catalogGameId's own live detection instead, so the
        // deck only ever shows a PID that actually belongs to it.
        activeProcessDetection: getActiveProcessDetections().find(
          (d) => d.catalogGameId === catalogGameId,
        ) ?? null,
      };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  guardedHandle('trainer-health-check', async (_event, payload: unknown) => {
    try {
      const catalogGameId =
        payload && typeof payload === 'object' && 'catalogGameId' in payload
          ? String((payload as { catalogGameId: string }).catalogGameId)
          : undefined;
      const records = runTrainerHealthCheck(catalogGameId);
      return { success: true, records, map: getTrainerHealthMap() };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  guardedHandle('trainer-health-list', async () => {
    try {
      return { success: true, records: listTrainerHealthRecords(), map: getTrainerHealthMap() };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  guardedHandle('trainer-catalog-certify-l1', async (_event, payload: unknown) => {
    try {
      const catalogGameId =
        payload && typeof payload === 'object' && 'catalogGameId' in payload
          ? String((payload as { catalogGameId: string }).catalogGameId)
          : '';
      if (!catalogGameId) return { success: false, error: 'missing_catalog_game_id' };
      const result = runOfflineCertify(catalogGameId);
      return { success: result.success, ...result };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  guardedHandle('catalog-demand-notify', async (_event, payload: unknown) => {
    try {
      const parsed =
        payload && typeof payload === 'object'
          ? (payload as { catalogGameId?: string; kind?: 'notify' | 'verification_request' })
          : {};
      if (!parsed.catalogGameId) return { success: false, error: 'missing_catalog_game_id' };
      const row = recordCatalogDemand(
        parsed.catalogGameId,
        parsed.kind === 'verification_request' ? 'verification_request' : 'notify',
      );
      return { success: true, demand: row };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  guardedHandle('catalog-demand-list', async () => {
    try {
      return { success: true, demand: listCatalogDemandSorted(100) };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  guardedHandle('install-discovery-open-path', async (_event, payload: unknown) => {
    try {
      const parsed =
        payload && typeof payload === 'object'
          ? (payload as { catalogGameId?: string; targetPath?: string })
          : {};
      if (!parsed.catalogGameId) return { success: false, error: 'missing_catalog_game_id' };

      const installed = listInstalledGames().find((g) => g.catalogGameId === parsed.catalogGameId);
      if (!installed) return { success: false, error: 'not_installed' };

      const openTarget = parsed.targetPath
        ? path.resolve(parsed.targetPath)
        : path.resolve(installed.installPath);

      if (!isPathUnderApprovedInstall(openTarget, installed.installPath)) {
        return { success: false, error: 'path_outside_install' };
      }

      const result = await shell.openPath(openTarget);
      if (result) return { success: false, error: result };
      return { success: true };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  guardedHandle('catalog-process-watch-active', async (_event, payload: unknown) => {
    try {
      const active =
        payload && typeof payload === 'object' && 'active' in payload
          ? Boolean((payload as { active: boolean }).active)
          : false;
      setCatalogProcessWatchInterval(active ? 5_000 : 15_000);
      return { success: true, intervalMs: active ? 5_000 : 15_000 };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  // Pull-based current-state sync: lets a renderer that just mounted (or a
  // fresh SOLITH launch racing an already-running game) recover the running
  // set immediately instead of waiting for the next poll's push event.
  guardedHandle('catalog-process-active-list', async () => {
    try {
      return { success: true, detections: getActiveProcessDetections() };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });
}

/** Re-export scan with health refresh for IPC layer consistency. */
export { runInstallDiscoveryScan, listInstalledGamesWithCatalog };
