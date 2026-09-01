import React from 'react';
import type { Settings } from '../../../../shared/types/index.js';

type Props = {
  settings: Settings;
  onUpdate: (key: keyof Settings, value: Settings[keyof Settings]) => void;
};

export const NotificationsSection: React.FC<Props> = ({ settings, onUpdate }) => {
  return (
    <div className="settings-section">
      <div className="settings-field">
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={settings.notificationsToastEnabled ?? true}
            onChange={(e) => onUpdate('notificationsToastEnabled', e.target.checked)}
          />
          Enable notification toasts
        </label>
      </div>

      <div className="settings-field">
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={settings.notificationsShowUnreadBadge ?? true}
            onChange={(e) => onUpdate('notificationsShowUnreadBadge', e.target.checked)}
          />
          Show unread badge
        </label>
      </div>

      <fieldset className="settings-field settings-fieldset">
        <legend>Event categories</legend>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={settings.notificationsCatalogUpdateEnabled ?? true}
            onChange={(e) => onUpdate('notificationsCatalogUpdateEnabled', e.target.checked)}
          />
          Catalog update notifications
        </label>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={settings.notificationsArtworkEnabled ?? true}
            onChange={(e) => onUpdate('notificationsArtworkEnabled', e.target.checked)}
          />
          Artwork notifications
        </label>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={settings.notificationsTrainerProfileEnabled ?? true}
            onChange={(e) => onUpdate('notificationsTrainerProfileEnabled', e.target.checked)}
          />
          Trainer/profile update notifications
        </label>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={settings.notificationsMaintenanceEnabled ?? true}
            onChange={(e) => onUpdate('notificationsMaintenanceEnabled', e.target.checked)}
          />
          Maintenance/recovery notifications
        </label>
      </fieldset>
    </div>
  );
};
