import React from 'react';
import type { NotificationRecord } from '../../shared/types/index.js';
import { formatRelativeTime } from '../lib/notifications.js';

type Props = {
  notifications: NotificationRecord[];
  unreadCount: number;
  onClose: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClearHistory: () => void;
  onAction: (action: { type: 'open-view'; view: string }) => void;
};

export function NotificationCenter({
  notifications,
  unreadCount,
  onClose,
  onMarkRead,
  onMarkAllRead,
  onClearHistory,
  onAction,
}: Props) {
  return (
    <div className="notification-center" role="dialog" aria-label="Notification Center">
      <div className="notification-center__header">
        <h2>Notifications{unreadCount > 0 ? ` (${unreadCount} unread)` : ''}</h2>
        <button type="button" className="notification-center__close" onClick={onClose} aria-label="Close notifications">
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <div className="notification-center__actions">
        <button type="button" onClick={onMarkAllRead} disabled={unreadCount === 0}>
          Mark all read
        </button>
        <button type="button" onClick={onClearHistory} disabled={notifications.length === 0}>
          Clear history
        </button>
      </div>

      {notifications.length === 0 ? (
        <div className="notification-center__empty">No notifications yet.</div>
      ) : (
        <ul className="notification-center__list">
          {notifications.map((notification) => (
            <li
              key={notification.id}
              className={`notification-item${notification.read ? '' : ' notification-item--unread'}`}
            >
              <button
                type="button"
                className="notification-item__body"
                onClick={() => onMarkRead(notification.id)}
                aria-label={`${notification.read ? '' : 'Unread. '}${notification.title}. ${notification.message}. ${formatRelativeTime(notification.createdAt)}`}
              >
                <span className="notification-item__title">{notification.title}</span>
                <span className="notification-item__message">{notification.message}</span>
                <span className="notification-item__time">{formatRelativeTime(notification.createdAt)}</span>
              </button>
              {notification.action && (
                <button
                  type="button"
                  className="notification-item__action"
                  onClick={() => {
                    onMarkRead(notification.id);
                    onAction(notification.action!);
                  }}
                >
                  Open
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
