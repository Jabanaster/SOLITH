import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { validateIpcSender } from './sender-validation.js';
import { CheatToggleGetAllSchema, CheatToggleSetSchema, CheatToggleClearSchema } from './ipc-validation.js';

/**
 * Persisted cheat toggle state (Multi-Game Live Trainer) — lets a cheat that
 * was enabled/confirmed before Solith closes come back armed on the
 * next launch, instead of forcing the user to redo discovery from scratch.
 * Not feature-flag-gated the way live-memory IPC is — this only reads/writes
 * a small local table, no process memory access happens here.
 */
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

export function registerCheatToggleIpc(): void {
  guardedHandle('cheat-toggle-get-all', async (event, payload: unknown) => {
    try {
      if (event.sender.isDestroyed()) return { success: false, error: 'sender_invalid' };
      const parsed = CheatToggleGetAllSchema.parse(payload);
      const mod = await import('../src/core/cheat-system/cheat-toggle-store.js');
      return { success: true, states: mod.getPersistedCheatStates(parsed.gameId) };
    } catch (error) {
      return { success: false, error: sanitize(error, 'get_all_failed') };
    }
  });

  guardedHandle('cheat-toggle-set', async (event, payload: unknown) => {
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

  guardedHandle('cheat-toggle-clear', async (event, payload: unknown) => {
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
