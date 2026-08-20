import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs/promises';
import { z } from 'zod';
import { validateIpcSender } from './sender-validation.js';
import { applySignedCatalogUpdate } from '../src/core/catalog-updates/apply.js';
import { rollbackCatalogUpdate } from '../src/core/catalog-updates/rollback.js';
import { getCatalogUpdateState, updateCatalogUpdateState, listCatalogUpdateHistory } from '../src/core/catalog-updates/store.js';
import { shouldCheckForCatalogUpdate } from '../src/core/catalog-updates/cooldown.js';

function requireTrustedSender(event: IpcMainInvokeEvent): { ok: true } | { ok: false; reason: string } {
  const result = validateIpcSender(event, ['main']);
  if (!result.ok) return { ok: false, reason: result.reason ?? 'unknown' };
  return { ok: true };
}

function sanitize(error: unknown): string {
  return error instanceof Error ? error.message : 'catalog_update_error';
}

const MAX_MANIFEST_FILE_BYTES = 4_000_000;

const SetPreferenceSchema = z
  .object({
    autoUpdateEnabled: z.boolean().optional(),
    bundledSnapshotOnly: z.boolean().optional(),
    artworkNetworkOptOut: z.boolean().optional(),
  })
  .strict();

export function registerCatalogUpdatesIpc(): void {
  ipcMain.handle('catalog-updates-status', async (event) => {
    const senderCheck = requireTrustedSender(event);
    if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
    const state = getCatalogUpdateState();
    return {
      success: true,
      state,
      history: listCatalogUpdateHistory(20),
      dueForAutomaticCheck: state.autoUpdateEnabled && !state.bundledSnapshotOnly && shouldCheckForCatalogUpdate(state.lastSuccessAt, new Date()),
    };
  });

  ipcMain.handle('catalog-updates-set-preference', async (event, payload: unknown) => {
    const senderCheck = requireTrustedSender(event);
    if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
    try {
      const parsed = SetPreferenceSchema.parse(payload ?? {});
      const state = updateCatalogUpdateState(parsed);
      return { success: true, state };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  // ROADMAP §5.5 "manual check available". No live distribution endpoint is
  // defined yet (an owner decision — see PHASE_5_CLOSEOUT.md), so V1's
  // manual path is importing an already-obtained signed update package from
  // disk, the same file-picker pattern trainer-catalog-pick-ct.ts uses.
  ipcMain.handle('catalog-updates-import', async (event) => {
    const senderCheck = requireTrustedSender(event);
    if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      const picked = await dialog.showOpenDialog(win ?? undefined, {
        title: 'Import a signed Solith catalog update',
        properties: ['openFile'],
        filters: [{ name: 'Signed catalog update', extensions: ['json'] }],
      });
      if (picked.canceled || picked.filePaths.length === 0) {
        return { success: false, canceled: true };
      }
      const filePath = picked.filePaths[0];
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) return { success: false, error: 'not_a_file' };
      if (stat.size < 1) return { success: false, error: 'empty_file' };
      if (stat.size > MAX_MANIFEST_FILE_BYTES) return { success: false, error: 'file_too_large' };
      const text = await fs.readFile(filePath, 'utf8');
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(text);
      } catch {
        return { success: false, error: 'invalid_json' };
      }
      const result = applySignedCatalogUpdate(parsedJson);
      return { success: result.status === 'applied', result };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('catalog-updates-rollback-last', async (event) => {
    const senderCheck = requireTrustedSender(event);
    if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
    try {
      const state = getCatalogUpdateState();
      const latestApplied = listCatalogUpdateHistory(50).find((h) => h.status === 'applied' && h.version === state.currentVersion);
      if (!latestApplied) return { success: false, error: 'no_applied_update_to_roll_back' };
      const result = rollbackCatalogUpdate(latestApplied.id);
      return result;
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });
}
