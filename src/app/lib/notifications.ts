import type { NotificationRecord } from '../../shared/types/index.js';

export const TOAST_MAX_VISIBLE = 3;
export const TOAST_AUTO_DISMISS_MS = 6000;

export interface ToastItem {
  id: string;
  record: NotificationRecord;
}

/** Adds a toast to the queue, dropping the oldest when over the visible cap. */
export function enqueueToast(queue: ToastItem[], record: NotificationRecord): ToastItem[] {
  if (queue.some((item) => item.id === record.id)) return queue;
  const next = [...queue, { id: record.id, record }];
  return next.length > TOAST_MAX_VISIBLE ? next.slice(next.length - TOAST_MAX_VISIBLE) : next;
}

export function dismissToast(queue: ToastItem[], id: string): ToastItem[] {
  return queue.filter((item) => item.id !== id);
}

export function formatRelativeTime(isoTimestamp: string, now: number = Date.now()): string {
  const then = new Date(isoTimestamp).getTime();
  if (Number.isNaN(then)) return '';
  const diffSeconds = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSeconds < 60) return 'just now';
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
