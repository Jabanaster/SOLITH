import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createCtZipPickerBridge } from '../src/core/ct-library/ct-zip-picker-bridge.js';
import { createCtImportService } from '../src/core/ct-library/selective-import.js';
import {
  defaultCtLibraryPaths,
  getCtLibraryGameDetail,
  loadCtLibrarySummary,
  searchCtLibrary,
} from '../src/core/ct-library/search.js';
import { validateIpcSender } from './sender-validation.js';

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirectory = path.dirname(moduleFilename);
const projectRoot = path.resolve(moduleDirectory, '..');
const paths = defaultCtLibraryPaths(projectRoot);
const activeImports = new Map<string, { ownerId: number; controller: AbortController }>();
const pickerBridge = createCtZipPickerBridge({});
const importService = createCtImportService({
  paths: {
    catalogPath: path.join(projectRoot, 'data', 'registry', 'personal-ct-catalog.index.json'),
    librarySummaryPath: paths.summaryPath,
    shardDirectory: path.join(path.dirname(paths.summaryPath), 'personal-ct-library-shards'),
    historyPath: path.join(path.dirname(paths.summaryPath), 'import-history.json'),
  },
});
const wiredOwners = new Set<number>();

const SearchSchema = z.object({
  query: z.string().max(200).optional().default(''),
  gameId: z.string().min(1).max(160).optional(),
  kind: z.enum(['all', 'pointer', 'script', 'aob']).optional().default('all'),
  limit: z.number().int().min(1).max(200).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
}).strict();

const GameDetailSchema = z.object({
  gameId: z.string().min(1).max(160),
}).strict();

const ImportStartSchema = z.object({
  selectionId: z.string().uuid(),
  receiptId: z.string().uuid(),
  selectedIds: z.array(z.string().regex(/^ct-table-[a-f0-9]{64}$/)).min(1).max(5_000),
  jobId: z.string().min(1).max(120).optional(),
  limit: z.number().int().min(1).max(100_000).optional(),
  maxShardBytes: z.number().int().min(1024).max(100 * 1024 * 1024).optional(),
}).strict();

const HistoryListSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(25),
  offset: z.number().int().min(0).optional().default(0),
  status: z.enum(['succeeded', 'failed', 'cancelled', 'rolled-back']).optional(),
  sourceType: z.literal('zip-archive').optional(),
}).strict();

const HistoryDetailSchema = z.object({
  historyId: z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
}).strict();

const ImportPreviewSchema = z.object({
  selectionId: z.string().uuid(),
  jobId: z.string().min(1).max(120).optional(),
  limit: z.number().int().min(1).max(5_000).optional(),
}).strict();

const ImportCancelSchema = z.object({
  jobId: z.string().min(1).max(120),
}).strict();

function sanitize(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  const message = sanitize(error);
  if (/NUL byte/i.test(message)) return 'REJECTED_NUL_BYTE';
  if (/path traversal/i.test(message)) return 'REJECTED_PATH_TRAVERSAL';
  if (/absolute zip entry/i.test(message)) return 'REJECTED_ABSOLUTE_PATH';
  if (/byte import cap|exceeds/i.test(message)) return 'REJECTED_SIZE_CAP';
  return undefined;
}

function authorize(event: IpcMainInvokeEvent): { ok: true; ownerId: number } | { ok: false; response: object } {
  const validation = validateIpcSender(event, ['main']);
  if (!validation.ok) {
    return {
      ok: false,
      response: { success: false, errorCode: `SENDER_REJECTED_${validation.reason.toUpperCase()}`, error: 'ct_library_sender_rejected' },
    };
  }
  const ownerId = event.sender.id;
  if (!wiredOwners.has(ownerId)) {
    wiredOwners.add(ownerId);
    event.sender.once('destroyed', () => {
      wiredOwners.delete(ownerId);
      importService.revokeOwner(ownerId);
      for (const [jobId, active] of activeImports) {
        if (active.ownerId === ownerId) {
          active.controller.abort();
          activeImports.delete(jobId);
        }
      }
    });
  }
  return { ok: true, ownerId };
}

export function registerCtLibraryIpc(): void {
  ipcMain.handle('ct-library-pick-zip', async (event) => {
    const authorized = authorize(event);
    if (authorized.ok === false) return authorized.response;
    const win = BrowserWindow.fromWebContents(event.sender);
    console.info('[ct-library] ZIP picker opened');
    const result = await pickerBridge.pick(event.sender.id, () => dialog.showOpenDialog(win ?? undefined, {
      title: 'Import Cheat Engine CT ZIP',
      properties: ['openFile'],
      filters: [{ name: 'ZIP archives', extensions: ['zip'] }],
    }));
    if (result.status === 'cancelled') console.info('[ct-library] ZIP picker cancelled');
    else if (result.status === 'selected') console.info(`[ct-library] ZIP selected: ${result.filename}`);
    else console.warn(`[ct-library] ZIP picker rejected selection: ${result.errorCode}`);
    return result;
  });

  ipcMain.handle('ct-library-summary', async (event) => {
    const authorized = authorize(event);
    if (authorized.ok === false) return authorized.response;
    try {
      const summary = await loadCtLibrarySummary(paths);
      return {
        success: true,
        available: Boolean(summary),
        summary: summary ?? undefined,
      };
    } catch (error) {
      return { success: false, available: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('ct-library-search', async (event, payload: unknown) => {
    const authorized = authorize(event);
    if (authorized.ok === false) return { ...authorized.response, available: false, total: 0, results: [] };
    try {
      const parsed = SearchSchema.parse(payload ?? {});
      return { success: true, ...(await searchCtLibrary(paths, parsed)) };
    } catch (error) {
      return { success: false, available: false, total: 0, results: [], error: sanitize(error) };
    }
  });

  ipcMain.handle('ct-library-game-detail', async (event, payload: unknown) => {
    const authorized = authorize(event);
    if (authorized.ok === false) return { ...authorized.response, available: false, tables: [] };
    try {
      const parsed = GameDetailSchema.parse(payload);
      return { success: true, ...(await getCtLibraryGameDetail(paths, parsed.gameId)) };
    } catch (error) {
      return { success: false, available: false, tables: [], error: sanitize(error) };
    }
  });

  ipcMain.handle('ct-library-import-zip-preview', async (event, payload: unknown) => {
    const authorized = authorize(event);
    if (authorized.ok === false) return { ...authorized.response, jobId: 'rejected' };
    const parsed = ImportPreviewSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, jobId: 'invalid', errorCode: 'INVALID_PAYLOAD', error: parsed.error.message };
    }
    const jobId = parsed.data.jobId ?? randomUUID();
    if (activeImports.has(jobId)) {
      return { success: false, jobId, errorCode: 'JOB_ALREADY_RUNNING', error: 'ct_import_job_already_running' };
    }
    const selected = pickerBridge.resolve(event.sender.id, parsed.data.selectionId);
    if (!selected.success) return { success: false, jobId, ...selected };
    const archivePath = selected.archivePath;

    const controller = new AbortController();
    activeImports.set(jobId, { ownerId: authorized.ownerId, controller });
    console.info(`[ct-library] preview started: ${path.basename(archivePath)}`);
    try {
      const preview = await importService.preview({
        ownerId: authorized.ownerId,
        selectionId: parsed.data.selectionId,
        archivePath,
        signal: controller.signal,
        onProgress: (progress) => {
          event.sender.send('ct-library-import-progress', { jobId, ...progress });
        },
        limit: parsed.data.limit ?? 5_000,
      });
      if (preview.totals.compiledTables === 0) {
        return {
          success: false,
          jobId,
          errorCode: 'NO_SUPPORTED_CT',
          error: 'The ZIP contains no supported Cheat Engine table content.',
        };
      }
      console.info(
        `[ct-library] preview completed: ${preview.totals.compiledTables}/${preview.totals.ctFiles} CT tables`,
      );
      return {
        success: true,
        jobId,
        receiptId: preview.receiptId,
        expiresAt: preview.expiresAt,
        filename: preview.filename,
        totals: preview.totals,
        rejected: preview.rejected,
        games: preview.items.slice(0, 5_000),
      };
    } catch (error) {
      console.error('[ct-library] preview failed:', error);
      return {
        success: false,
        jobId,
        error: sanitize(error),
        errorCode: errorCode(error) ?? 'PREVIEW_FAILED',
      };
    } finally {
      activeImports.delete(jobId);
    }
  });

  ipcMain.handle('ct-library-import-zip-start', async (event, payload: unknown) => {
    const authorized = authorize(event);
    if (authorized.ok === false) return { ...authorized.response, jobId: 'rejected' };
    const parsed = ImportStartSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, jobId: 'invalid', error: parsed.error.message };
    }
    const jobId = parsed.data.jobId ?? randomUUID();
    if (activeImports.has(jobId)) {
      return { success: false, jobId, error: 'ct_import_job_already_running' };
    }
    const controller = new AbortController();
    activeImports.set(jobId, { ownerId: authorized.ownerId, controller });

    try {
      console.info(`[ct-library] confirmed selective import started: ${parsed.data.selectedIds.length} table(s)`);
      const result = await importService.commit({
        ownerId: authorized.ownerId,
        selectionId: parsed.data.selectionId,
        receiptId: parsed.data.receiptId,
        selectedIds: parsed.data.selectedIds,
        signal: controller.signal,
        onProgress: (progress) => {
          event.sender.send('ct-library-import-progress', { jobId, ...progress });
        },
        maxShardBytes: parsed.data.maxShardBytes,
      });
      if (result.success === false) {
        return { success: false, jobId, errorCode: result.errorCode, error: 'CT import was rejected without modifying the library.' };
      }
      console.info(
        `[ct-library] confirmed selective import completed: ${result.importedCount} CT tables`,
      );
      return {
        success: true,
        jobId,
        historyId: result.historyId,
        importedCount: result.importedCount,
        skippedCount: result.skippedCount,
        totals: result.totals,
      };
    } catch (error) {
      console.error('[ct-library] confirmed import failed:', error);
      return {
        success: false,
        jobId,
        error: sanitize(error),
        errorCode: errorCode(error),
      };
    } finally {
      activeImports.delete(jobId);
    }
  });

  ipcMain.handle('ct-library-import-zip-cancel', async (event, payload: unknown) => {
    const authorized = authorize(event);
    if (authorized.ok === false) return { ...authorized.response, jobId: 'rejected' };
    const parsed = ImportCancelSchema.parse(payload);
    const active = activeImports.get(parsed.jobId);
    if (!active || active.ownerId !== authorized.ownerId) {
      return { success: false, jobId: parsed.jobId, error: 'ct_import_job_not_found' };
    }
    active.controller.abort();
    return { success: true, jobId: parsed.jobId };
  });

  ipcMain.handle('ct-library-import-history-list', async (event, payload: unknown) => {
    const authorized = authorize(event);
    if (authorized.ok === false) return { ...authorized.response, total: 0, entries: [] };
    const parsed = HistoryListSchema.safeParse(payload ?? {});
    if (!parsed.success) return { success: false, errorCode: 'INVALID_PAYLOAD', total: 0, entries: [] };
    try {
      return { success: true, ...(await importService.listHistory(parsed.data)) };
    } catch {
      return { success: false, errorCode: 'HISTORY_READ_FAILED', total: 0, entries: [] };
    }
  });

  ipcMain.handle('ct-library-import-history-detail', async (event, payload: unknown) => {
    const authorized = authorize(event);
    if (authorized.ok === false) return authorized.response;
    const parsed = HistoryDetailSchema.safeParse(payload);
    if (!parsed.success) return { success: false, errorCode: 'INVALID_PAYLOAD' };
    try {
      const entry = await importService.getHistory(parsed.data.historyId);
      return entry ? { success: true, entry } : { success: false, errorCode: 'HISTORY_NOT_FOUND' };
    } catch {
      return { success: false, errorCode: 'HISTORY_READ_FAILED' };
    }
  });
}
