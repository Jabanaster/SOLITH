import React from 'react';
import type { Settings } from '../../../../shared/types/index.js';

type Props = {
  settings: Settings;
  onUpdate: (key: keyof Settings, value: Settings[keyof Settings]) => void;
};

export const AppearanceSection: React.FC<Props> = ({ settings, onUpdate }) => (
  <div className="settings-section">
    <div className="settings-field">
      <label htmlFor="settings-theme">Theme</label>
      <select
        id="settings-theme"
        value={settings.theme}
        onChange={(e) => onUpdate('theme', e.target.value as Settings['theme'])}
      >
        <option value="dark">Dark</option>
        <option value="light">Light</option>
      </select>
    </div>
  </div>
);
