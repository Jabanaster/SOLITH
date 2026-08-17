import { useCallback, useEffect, useState } from 'react';
import type { NotificationRecord } from '../../shared/types/index.js';
import { enqueueToast, dismissToast, type ToastItem } from '../lib/notifications.js';

export interface UseNotificationsOptions {
  toastsEnabled: boolean;
}

export function useNotifications({ toastsEnabled }: UseNotificationsOptions) {
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const refresh = useCallback(async () => {
    try {
      const result = await window.electronAPI?.listNotifications?.();
      if (Array.isArray(result)) setNotifications(result);
    } catch {
      // ignore — browser mode
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onNotificationCreated?.((record) => {
      setNotifications((prev) => (prev.some((n) => n.id === record.id) ? prev : [record as NotificationRecord, ...prev]));
      if (toastsEnabled) {
        setToasts((prev) => enqueueToast(prev, record as NotificationRecord));
      }
    });
    return () => unsubscribe?.();
  }, [toastsEnabled]);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    void window.electronAPI?.markNotificationRead?.(id);
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    void window.electronAPI?.markAllNotificationsRead?.();
  }, []);

  const clearHistory = useCallback(() => {
    setNotifications([]);
    void window.electronAPI?.clearNotificationHistory?.();
  }, []);

  const dismissToastItem = useCallback((id: string) => {
    setToasts((prev) => dismissToast(prev, id));
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return {
    notifications,
    unreadCount,
    toasts,
    markRead,
    markAllRead,
    clearHistory,
    dismissToast: dismissToastItem,
  };
}
