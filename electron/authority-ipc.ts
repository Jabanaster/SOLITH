import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { validateIpcSender } from './sender-validation.js';
import {
  getAuthorityReadOnlyMode,
  setAuthorityReadOnlyMode,
  listRecentAuthorityDecisions,
} from './authority-bridge.js';

function requireTrustedSender(event: IpcMainInvokeEvent): { ok: true } | { ok: false; reason: string } {
  const result = validateIpcSender(event, ['main']);
  if (!result.ok) return { ok: false, reason: result.reason ?? 'unknown' };
  return { ok: true };
}

/**
 * SOL-1 authority IPC surface (SOL-1 STEP 6/18). Every handler is
 * sender-validated the same way as electron/main.ts's handleGuarded() —
 * this module does not introduce a parallel trust path.
 */
export function registerAuthorityIpc(): void {
  ipcMain.handle('authority-get-state', async (event) => {
    const senderCheck = requireTrustedSender(event);
    if (!senderCheck.ok) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
    return { success: true, readOnlyMode: getAuthorityReadOnlyMode() };
  });

  ipcMain.handle('authority-set-readonly', async (event, enabled: unknown) => {
    const senderCheck = requireTrustedSender(event);
    if (!senderCheck.ok) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
    if (typeof enabled !== 'boolean') return { success: false, error: 'invalid_payload' };
    setAuthorityReadOnlyMode(enabled);
    return { success: true, readOnlyMode: enabled };
  });

  ipcMain.handle('authority-list-decisions', async (event, limit: unknown) => {
    const senderCheck = requireTrustedSender(event);
    if (!senderCheck.ok) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
    const parsedLimit = typeof limit === 'number' && Number.isInteger(limit) && limit > 0 && limit <= 500 ? limit : 100;
    return { success: true, decisions: listRecentAuthorityDecisions(parsedLimit) };
  });
}
