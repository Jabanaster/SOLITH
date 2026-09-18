import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { validateIpcSender } from './sender-validation.js';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { compileCtZipArchive } from '../src/core/registry/compile-ct-zip.js';
import { compileCtLibraryArchive } from '../src/core/ct-library/write-library.js';
import { createCtZipPickerBridge } from '../src/core/ct-library/ct-zip-picker-bridge.js';
import {
  defaultCtLibraryPaths,
  getCtLibraryGameDetail,
  loadCtLibrarySummary,
  searchCtLibrary,
  type CtLibraryPaths,
} from '../src/core/ct-library/search.js';
import { getAppPaths } from '../src/shared/app-paths.js';

/**
 * P4-8 fix: personal CT-library reads/writes previously resolved against the
 * compiled module's own directory (effectively the app install/resources
 * tree in a packaged build) rather than Electron's per-user userData
 * directory — not writable by a standard user in a normal install, and wiped
 * by reinstall/update even where it was writable. `getAppPaths()` is the
 * same resolver already used for the SQLite DB path (src/shared/app-paths.ts),
 * with dev/test env-var fallbacks so this works outside Electron too.
 * Memoized because the resolved root never changes for the process lifetime.
 *
 * Not covered by this fix: automatically migrating a personal library
 * previously written under the OLD install-dir path. That is recorded as a
 * known follow-up rather than attempted here, to keep this fix narrow
 * (mission: "if fixing it would spill into broad CT work, do not expand
 * scope — record and defer").
 */
let cachedCtLibraryPaths: CtLibraryPaths | null = null;
async function getCtLibraryPaths(): Promise<CtLibraryPaths> {
  if (!cachedCtLibraryPaths) {
    const { userDataRoot } = await getAppPaths();
    cachedCtLibraryPaths = defaultCtLibraryPaths(userDataRoot);
  }
  return cachedCtLibraryPaths;
}

const activeImports = new Map<string, AbortController>();
const pickerBridge = createCtZipPickerBridge({});

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
  jobId: z.string().min(1).max(120).optional(),
  limit: z.number().int().min(1).max(100_000).optional(),
  maxShardBytes: z.number().int().min(1024).max(100 * 1024 * 1024).optional(),
}).strict();

const ImportPreviewSchema = z.object({
  selectionId: z.string().uuid(),
  jobId: z.string().min(1).max(120).optional(),
  limit: z.number().int().min(1).max(100_000).optional(),
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

export function registerCtLibraryIpc(): void {
  guardedHandle('ct-library-pick-zip', async (event) => {
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

  guardedHandle('ct-library-summary', async () => {
    try {
      const summary = await loadCtLibrarySummary(await getCtLibraryPaths());
      return {
        success: true,
        available: Boolean(summary),
        summary: summary ?? undefined,
      };
    } catch (error) {
      return { success: false, available: false, error: sanitize(error) };
    }
  });

  guardedHandle('ct-library-search', async (_event, payload: unknown) => {
    try {
      const parsed = SearchSchema.parse(payload ?? {});
      return { success: true, ...(await searchCtLibrary(await getCtLibraryPaths(), parsed)) };
    } catch (error) {
      return { success: false, available: false, total: 0, results: [], error: sanitize(error) };
    }
  });

  guardedHandle('ct-library-game-detail', async (_event, payload: unknown) => {
    try {
      const parsed = GameDetailSchema.parse(payload);
      return { success: true, ...(await getCtLibraryGameDetail(await getCtLibraryPaths(), parsed.gameId)) };
    } catch (error) {
      return { success: false, available: false, tables: [], error: sanitize(error) };
    }
  });

  guardedHandle('ct-library-import-zip-preview', async (event, payload: unknown) => {
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
    activeImports.set(jobId, controller);
    console.info(`[ct-library] preview started: ${path.basename(archivePath)}`);
    try {
      const preview = await compileCtZipArchive(archivePath, {
        signal: controller.signal,
        onProgress: (progress) => {
          event.sender.send('ct-library-import-progress', { jobId, ...progress });
        },
        limit: parsed.data.limit,
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
        archivePath,
        filename: path.basename(archivePath),
        totals: preview.totals,
        rejected: preview.rejected,
        games: preview.tables.slice(0, 40).map((table) => ({
          game: table.game,
          tableName: table.tableName,
          archivePath: table.archivePath,
          counts: table.counts,
        })),
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

  guardedHandle('ct-library-import-zip-start', async (event, payload: unknown) => {
    const parsed = ImportStartSchema.safeParse(payload);
    if (!parsed.success) {
      return { success: false, jobId: 'invalid', error: parsed.error.message };
    }
    const jobId = parsed.data.jobId ?? randomUUID();
    if (activeImports.has(jobId)) {
      return { success: false, jobId, error: 'ct_import_job_already_running' };
    }
    const selected = pickerBridge.resolve(event.sender.id, parsed.data.selectionId);
    if (!selected.success) return { success: false, jobId, ...selected };
    const archivePath = selected.archivePath;

    const controller = new AbortController();
    activeImports.set(jobId, controller);
    const paths = await getCtLibraryPaths();
    const libraryDirectory = path.dirname(paths.summaryPath);
    const registryDirectory = path.join(libraryDirectory, '..', 'registry');

    try {
      console.info(`[ct-library] confirmed import started: ${path.basename(archivePath)}`);
      const result = await compileCtLibraryArchive(archivePath, {
        signal: controller.signal,
        onProgress: (progress) => {
          event.sender.send('ct-library-import-progress', { jobId, ...progress });
        },
        outputJsonPath: path.join(registryDirectory, 'personal-ct-catalog.index.json'),
        libraryOutputPath: paths.summaryPath,
        shardDirectory: path.join(libraryDirectory, 'personal-ct-library-shards'),
        limit: parsed.data.limit,
        maxShardBytes: parsed.data.maxShardBytes,
      });
      console.info(
        `[ct-library] confirmed import completed: ${result.index.totals.compiledTables}/${result.index.totals.ctFiles} CT tables`,
      );
      return {
        success: true,
        jobId,
        libraryOutputPath: result.libraryOutputPath,
        shardDirectory: result.shardDirectory,
        shards: result.shards.length,
        totals: result.index.totals,
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

  guardedHandle('ct-library-import-zip-cancel', async (_event, payload: unknown) => {
    const parsed = ImportCancelSchema.parse(payload);
    const controller = activeImports.get(parsed.jobId);
    if (!controller) {
      return { success: false, jobId: parsed.jobId, error: 'ct_import_job_not_found' };
    }
    controller.abort();
    return { success: true, jobId: parsed.jobId };
  });
}
