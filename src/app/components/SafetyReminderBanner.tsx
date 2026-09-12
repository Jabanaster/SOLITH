import React from 'react';
import { SAFETY_REMINDER_TITLE, SAFETY_REMINDER_BODY } from '../../core/safety-acknowledgment/copy.js';

/**
 * Offline Safety Acknowledgment — Policy v1, ~30-day non-blocking reminder.
 * Owner-frozen copy. Never blocks trainer/library use — renders as a
 * dismissible in-app banner only, never an OS-level notification.
 */
export interface SafetyReminderBannerProps {
  onDismiss: () => void;
  onShowSafetyInfo?: () => void;
}

export const SafetyReminderBanner: React.FC<SafetyReminderBannerProps> = ({ onDismiss, onShowSafetyInfo }) => {
  return (
    <div role="status" aria-label="Safety reminder" className="safety-reminder-banner">
      <div className="safety-reminder-text">
        <strong>{SAFETY_REMINDER_TITLE}</strong>
        <span>{SAFETY_REMINDER_BODY}</span>
      </div>
      <div className="safety-reminder-actions">
        {onShowSafetyInfo && (
          <button type="button" className="btn-secondary" onClick={onShowSafetyInfo}>
            Safety Info
          </button>
        )}
        <button type="button" className="btn-secondary" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
};

export default SafetyReminderBanner;
