import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { validateIpcSender } from './sender-validation.js';
import {
  CreateNotificationSchema,
  MarkNotificationReadSchema,
} from './ipc-validation.js';
import type { NotificationRecord } from '../src/shared/types/index.js';

/**
 * Pre-Phase-3 closeout finding (same class as wisp-consent-ipc.ts's
 * sendToLiveWindows): `BrowserWindow.isDestroyed()` alone misses the window
 * where `webContents` is already destroyed slightly ahead of its owning
 * window during shutdown — `webContents.send(...)` then throws an uncaught
 * main-process exception. Checking `webContents.isDestroyed()` too, and
 * wrapping the send in try/catch, closes the race for this broadcaster.
 */
export function broadcastNotificationCreated(record: NotificationRecord): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
    try {
      win.webContents.send('notification-created', record);
    } catch {
      // Best-effort push — a destroyed/closing webContents must never crash
      // the main process or block app shutdown.
    }
  }
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

export function registerNotificationsIpc(): void {
  guardedHandle('list-notifications', async () => {
    try {
      const dbModule = await import('../src/core/database/index.js');
      await dbModule.initDatabase();
      const notificationsModule = await import('../src/core/notifications/index.js');
      return notificationsModule.listNotifications();
    } catch (error) {
      console.error('list-notifications error:', error);
      return { error: String(error) };
    }
  });

  guardedHandle('get-unread-notification-count', async () => {
    try {
      const dbModule = await import('../src/core/database/index.js');
      await dbModule.initDatabase();
      const notificationsModule = await import('../src/core/notifications/index.js');
      return notificationsModule.getUnreadNotificationCount();
    } catch (error) {
      console.error('get-unread-notification-count error:', error);
      return { error: String(error) };
    }
  });

  guardedHandle('create-notification', async (event, payload) => {
    try {
      const parsed = CreateNotificationSchema.parse(payload);
      const dbModule = await import('../src/core/database/index.js');
      await dbModule.initDatabase();
      const notificationsModule = await import('../src/core/notifications/index.js');
      const record = notificationsModule.createNotification(parsed);
      broadcastNotificationCreated(record);
      return { success: true, notification: record };
    } catch (error) {
      console.error('create-notification error:', error);
      return { error: String(error) };
    }
  });

  guardedHandle('mark-notification-read', async (event, payload) => {
    try {
      const parsed = MarkNotificationReadSchema.parse(payload);
      const dbModule = await import('../src/core/database/index.js');
      await dbModule.initDatabase();
      const notificationsModule = await import('../src/core/notifications/index.js');
      const changed = notificationsModule.markNotificationRead(parsed.id);
      return { success: changed };
    } catch (error) {
      console.error('mark-notification-read error:', error);
      return { error: String(error) };
    }
  });

  guardedHandle('mark-all-notifications-read', async () => {
    try {
      const dbModule = await import('../src/core/database/index.js');
      await dbModule.initDatabase();
      const notificationsModule = await import('../src/core/notifications/index.js');
      notificationsModule.markAllNotificationsRead();
      return { success: true };
    } catch (error) {
      console.error('mark-all-notifications-read error:', error);
      return { error: String(error) };
    }
  });

  guardedHandle('clear-notification-history', async () => {
    try {
      const dbModule = await import('../src/core/database/index.js');
      await dbModule.initDatabase();
      const notificationsModule = await import('../src/core/notifications/index.js');
      notificationsModule.clearNotificationHistory();
      return { success: true };
    } catch (error) {
      console.error('clear-notification-history error:', error);
      return { error: String(error) };
    }
  });
}
