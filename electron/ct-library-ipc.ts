import { ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  defaultCtLibraryPaths,
  getCtLibraryGameDetail,
  loadCtLibrarySummary,
  searchCtLibrary,
} from '../src/core/ct-library/search.js';

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirectory = path.dirname(moduleFilename);
const projectRoot = path.resolve(moduleDirectory, '..');
const paths = defaultCtLibraryPaths(projectRoot);

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

function sanitize(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function registerCtLibraryIpc(): void {
  ipcMain.handle('ct-library-summary', async () => {
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

  ipcMain.handle('ct-library-search', async (_event, payload: unknown) => {
    try {
      const parsed = SearchSchema.parse(payload ?? {});
      return { success: true, ...(await searchCtLibrary(paths, parsed)) };
    } catch (error) {
      return { success: false, available: false, total: 0, results: [], error: sanitize(error) };
    }
  });

  ipcMain.handle('ct-library-game-detail', async (_event, payload: unknown) => {
    try {
      const parsed = GameDetailSchema.parse(payload);
      return { success: true, ...(await getCtLibraryGameDetail(paths, parsed.gameId)) };
    } catch (error) {
      return { success: false, available: false, tables: [], error: sanitize(error) };
    }
  });
}
