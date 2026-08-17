import fs from 'fs';
import path from 'path';
import { ipcMain, shell } from 'electron';
import { z } from 'zod';
import { buildGameLibraryRecords } from '../src/core/canonical-games/render-model.js';
import { getCanonicalGame, listCanonicalGames, listInstallationsForGame } from '../src/core/canonical-games/store.js';
import { validatePathSafety } from '../src/core/safety/path-safety.js';

function sanitize(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const GameLibraryViewSchema = z.object({
  view: z.enum(['installed', 'all', 'owned']).optional(),
}).strict();

const LaunchInstallationSchema = z.object({
  canonicalGameId: z.string().min(1).max(200),
  installationId: z.string().min(1).max(400),
}).strict();

export function registerCanonicalGamesIpc(): void {
  ipcMain.handle('list-game-library', async (_event, payload: unknown) => {
    try {
      const { view } = GameLibraryViewSchema.parse(payload ?? {});
      const records = buildGameLibraryRecords(view ?? 'installed');
      return { success: true, records };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('list-canonical-games', async () => {
    try {
      return { success: true, games: listCanonicalGames() };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('get-canonical-game', async (_event, payload: unknown) => {
    try {
      const { canonicalGameId } = z.object({ canonicalGameId: z.string().min(1).max(200) }).strict().parse(payload);
      const game = getCanonicalGame(canonicalGameId);
      if (!game) return { success: false, error: 'Canonical game not found.' };
      return { success: true, game, installations: listInstallationsForGame(canonicalGameId) };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('launch-installation', async (_event, payload: unknown) => {
    try {
      const { canonicalGameId, installationId } = LaunchInstallationSchema.parse(payload);
      const installations = listInstallationsForGame(canonicalGameId);
      const installation = installations.find((i) => i.id === installationId);
      if (!installation) {
        return { success: false, error: 'Installation not found for this canonical game.' };
      }
      const executablePath = installation.executablePath;
      if (!executablePath) {
        return { success: false, error: 'No known executable for this installation.' };
      }
      const safety = validatePathSafety(executablePath);
      if (!safety.safe) {
        return { success: false, error: `Unsafe executable path: ${safety.reason ?? 'blocked'}` };
      }
      if (!fs.existsSync(executablePath) || !fs.statSync(executablePath).isFile()) {
        return { success: false, error: 'Executable file was not found on disk.' };
      }
      if (path.extname(executablePath).toLowerCase() !== '.exe') {
        return { success: false, error: 'Only .exe launch targets are supported.' };
      }
      // shell.openPath (never a raw shell/exec call) — no argument injection surface.
      const openError = await shell.openPath(executablePath);
      if (openError) {
        return { success: false, error: openError };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });
}
