import { ipcMain } from 'electron';
import { CheatToggleGetAllSchema, CheatToggleSetSchema, CheatToggleClearSchema } from './ipc-validation.js';

/**
 * Persisted cheat toggle state (Multi-Game Live Trainer) — lets a cheat that
 * was enabled/confirmed before Solith closes come back armed on the
 * next launch, instead of forcing the user to redo discovery from scratch.
 * Not feature-flag-gated the way live-memory IPC is — this only reads/writes
 * a small local table, no process memory access happens here.
 */
export function registerCheatToggleIpc(): void {
  ipcMain.handle('cheat-toggle-get-all', async (event, payload: unknown) => {
    try {
      if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
      const parsed = CheatToggleGetAllSchema.parse(payload);
      const mod = await import('../src/core/cheat-system/cheat-toggle-store.js');
      return { success: true, states: mod.getPersistedCheatStates(parsed.gameId) };
    } catch (error) {
      return { success: false, error: sanitize(error, 'get_all_failed') };
    }
  });

  ipcMain.handle('cheat-toggle-set', async (event, payload: unknown) => {
    try {
      if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
      const parsed = CheatToggleSetSchema.parse(payload);
      const mod = await import('../src/core/cheat-system/cheat-toggle-store.js');
      mod.setPersistedCheatState(parsed.gameId, parsed.cheatId, {
        enabled: parsed.enabled,
        confirmedAddress: parsed.confirmedAddress,
        dataType: parsed.dataType,
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: sanitize(error, 'set_failed') };
    }
  });

  ipcMain.handle('cheat-toggle-clear', async (event, payload: unknown) => {
    try {
      if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
      const parsed = CheatToggleClearSchema.parse(payload);
      const mod = await import('../src/core/cheat-system/cheat-toggle-store.js');
      mod.clearPersistedCheatState(parsed.gameId, parsed.cheatId);
      return { success: true };
    } catch (error) {
      return { success: false, error: sanitize(error, 'clear_failed') };
    }
  });
}

function sanitize(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message === 'sender_invalid') return error.message;
  return fallback;
}
