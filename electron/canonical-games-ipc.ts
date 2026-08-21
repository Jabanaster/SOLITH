import fs from 'fs';
import path from 'path';
import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { validateIpcSender } from './sender-validation.js';
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

export function registerCanonicalGamesIpc(): void {
  guardedHandle('list-game-library', async (_event, payload: unknown) => {
    try {
      const { view } = GameLibraryViewSchema.parse(payload ?? {});
      const records = buildGameLibraryRecords(view ?? 'installed');
      return { success: true, records };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  guardedHandle('list-canonical-games', async () => {
    try {
      return { success: true, games: listCanonicalGames() };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  guardedHandle('get-canonical-game', async (_event, payload: unknown) => {
    try {
      const { canonicalGameId } = z.object({ canonicalGameId: z.string().min(1).max(200) }).strict().parse(payload);
      const game = getCanonicalGame(canonicalGameId);
      if (!game) return { success: false, error: 'Canonical game not found.' };
      return { success: true, game, installations: listInstallationsForGame(canonicalGameId) };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  guardedHandle('launch-installation', async (_event, payload: unknown) => {
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
