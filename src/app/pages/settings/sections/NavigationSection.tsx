import React from 'react';
import type { NavSectionBehaviorMode, Settings } from '../../../../shared/types/index.js';

type Props = {
  settings: Settings;
  onUpdate: (key: keyof Settings, value: Settings[keyof Settings]) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
};

export const NavigationSection: React.FC<Props> = ({ settings, onUpdate, sidebarCollapsed, onToggleSidebar }) => {
  const behaviorMode = settings.navSectionBehaviorMode ?? 'remember';

  return (
    <div className="settings-section">
      <div className="settings-field">
        <label htmlFor="settings-sidebar-collapsed">Sidebar expanded/collapsed</label>
        <button
          id="settings-sidebar-collapsed"
          type="button"
          className="btn-secondary"
          onClick={onToggleSidebar}
          aria-pressed={sidebarCollapsed}
        >
          {sidebarCollapsed ? 'Collapsed — click to expand' : 'Expanded — click to collapse'}
        </button>
      </div>

      <fieldset className="settings-field settings-fieldset">
        <legend>Navigation-group behavior</legend>
        {(
          [
            { value: 'remember', label: 'Remember my sidebar sections' },
            { value: 'always-expand', label: 'Always expand all sections' },
            { value: 'always-collapse-inactive', label: 'Always collapse inactive sections' },
          ] as { value: NavSectionBehaviorMode; label: string }[]
        ).map((option) => (
          <label key={option.value} className="settings-radio">
            <input
              type="radio"
              name="nav-section-behavior-mode"
              value={option.value}
              checked={behaviorMode === option.value}
              onChange={() => onUpdate('navSectionBehaviorMode', option.value)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      <div className="settings-field">
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={settings.navCompactMode ?? false}
            onChange={(e) => onUpdate('navCompactMode', e.target.checked)}
          />
          Compact sidebar mode
        </label>
      </div>

      <div className="settings-field">
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={settings.navShowSectionLabels ?? true}
            onChange={(e) => onUpdate('navShowSectionLabels', e.target.checked)}
          />
          Show section labels
        </label>
      </div>
    </div>
  );
};
