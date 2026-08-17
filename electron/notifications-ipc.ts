import { BrowserWindow, ipcMain } from 'electron';
import {
  CreateNotificationSchema,
  MarkNotificationReadSchema,
} from './ipc-validation.js';
import type { NotificationRecord } from '../src/shared/types/index.js';

export function broadcastNotificationCreated(record: NotificationRecord): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('notification-created', record);
    }
  }
}

export function registerNotificationsIpc(): void {
  ipcMain.handle('list-notifications', async () => {
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

  ipcMain.handle('get-unread-notification-count', async () => {
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

  ipcMain.handle('create-notification', async (event, payload) => {
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

  ipcMain.handle('mark-notification-read', async (event, payload) => {
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

  ipcMain.handle('mark-all-notifications-read', async () => {
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

  ipcMain.handle('clear-notification-history', async () => {
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
