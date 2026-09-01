import crypto from 'crypto';
import db from '../database';
import { NotificationRecord, NotificationCategory, NotificationSeverity, NotificationAction } from '../../shared/types';

export const NOTIFICATION_HISTORY_LIMIT = 200;

const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  'catalog-update', 'artwork', 'trainer-profile', 'maintenance', 'recovery', 'general',
];

const NOTIFICATION_SEVERITIES: NotificationSeverity[] = ['info', 'success', 'warning', 'error'];

const TITLE_MAX_LENGTH = 200;
const MESSAGE_MAX_LENGTH = 1000;

function isValidCategory(value: unknown): value is NotificationCategory {
  return typeof value === 'string' && (NOTIFICATION_CATEGORIES as string[]).includes(value);
}

function isValidSeverity(value: unknown): value is NotificationSeverity {
  return typeof value === 'string' && (NOTIFICATION_SEVERITIES as string[]).includes(value);
}

export interface CreateNotificationInput {
  category: NotificationCategory;
  title: string;
  message: string;
  severity?: NotificationSeverity;
  action?: NotificationAction;
}

function rowToNotification(row: any): NotificationRecord {
  const record: NotificationRecord = {
    id: String(row.id),
    category: isValidCategory(row.category) ? row.category : 'general',
    title: typeof row.title === 'string' ? row.title : '',
    message: typeof row.message === 'string' ? row.message : '',
    severity: isValidSeverity(row.severity) ? row.severity : 'info',
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    read: row.read === 1 || row.read === true,
  };
  if (row.actionType === 'open-view' && typeof row.actionView === 'string' && row.actionView.length > 0) {
    record.action = { type: 'open-view', view: row.actionView };
  }
  return record;
}

export function createNotification(input: CreateNotificationInput): NotificationRecord {
  if (!isValidCategory(input.category)) {
    throw new Error(`Invalid notification category: ${String(input.category)}`);
  }

  const id = crypto.randomUUID();
  const title = input.title.trim().slice(0, TITLE_MAX_LENGTH);
  const message = input.message.trim().slice(0, MESSAGE_MAX_LENGTH);
  const severity = isValidSeverity(input.severity) ? input.severity : 'info';
  const action = input.action?.type === 'open-view' && typeof input.action.view === 'string' && input.action.view.length > 0
    ? input.action
    : undefined;

  db.prepare(`
    INSERT INTO notifications (id, category, title, message, severity, actionType, actionView)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.category,
    title,
    message,
    severity,
    action ? action.type : null,
    action ? action.view : null,
  );

  enforceHistoryCap();

  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
  return rowToNotification(row);
}

function enforceHistoryCap(): void {
  db.prepare(`
    DELETE FROM notifications
    WHERE id NOT IN (
      SELECT id FROM notifications ORDER BY createdAt DESC, rowid DESC LIMIT ?
    )
  `).run(NOTIFICATION_HISTORY_LIMIT);
}

export function listNotifications(limit: number = NOTIFICATION_HISTORY_LIMIT): NotificationRecord[] {
  const rows = db.prepare(`
    SELECT * FROM notifications ORDER BY createdAt DESC, rowid DESC LIMIT ?
  `).all(limit);
  return rows.map(rowToNotification);
}

export function getUnreadNotificationCount(): number {
  const row = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE read = 0').get();
  return row.count;
}

export function markNotificationRead(id: string): boolean {
  const result = db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id);
  return result.changes !== 0;
}

export function markAllNotificationsRead(): void {
  db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
}

export function clearNotificationHistory(): void {
  db.prepare('DELETE FROM notifications').run();
}
