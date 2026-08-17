import React from 'react';
import { Icon } from './icons/index.js';

type Props = {
  unreadCount: number;
  showBadge: boolean;
  isOpen: boolean;
  onToggle: () => void;
};

export function NotificationBell({ unreadCount, showBadge, isOpen, onToggle }: Props) {
  const hasUnread = showBadge && unreadCount > 0;
  const label = hasUnread
    ? `Notifications, ${unreadCount} unread`
    : 'Notifications';

  return (
    <button
      type="button"
      className="sidebar-notification-btn"
      onClick={onToggle}
      aria-label={label}
      aria-expanded={isOpen}
      aria-haspopup="true"
      title="Notifications"
    >
      <Icon name="bell" size={20} />
      {hasUnread && (
        <span className="notification-bell-badge" aria-hidden="true">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}
