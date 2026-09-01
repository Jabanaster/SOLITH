import React, { useEffect } from 'react';
import type { ToastItem } from '../lib/notifications.js';
import { TOAST_AUTO_DISMISS_MS } from '../lib/notifications.js';

type Props = {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
};

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div className={`notification-toast notification-toast--${toast.record.severity}`} role="status" aria-live="polite">
      <div className="notification-toast__copy">
        <strong>{toast.record.title}</strong>
        <span>{toast.record.message}</span>
      </div>
      <button
        type="button"
        className="notification-toast__dismiss"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

export function ToastHost({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null;
  return (
    <div className="notification-toast-host">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
