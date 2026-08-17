import React, { useState } from 'react';
import type { Settings } from '../../../shared/types/index.js';
import { DEFAULT_SETTINGS_CATEGORY, SETTINGS_CATEGORIES, type SettingsCategoryId } from './settingsCategories.js';
import { EmptyCategorySection } from './sections/EmptyCategorySection.js';
import { AppearanceSection } from './sections/AppearanceSection.js';
import { NavigationSection } from './sections/NavigationSection.js';
import { NotificationsSection } from './sections/NotificationsSection.js';
import { AboutSection } from './sections/AboutSection.js';
import { AdvancedSection } from './sections/AdvancedSection.js';

type Props = {
  settings: Settings | null;
  onUpdateSetting: (key: keyof Settings, value: Settings[keyof Settings]) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
};

const SETTINGS_CATEGORY_KEY = 'solith-settings-category';

function readInitialCategory(): SettingsCategoryId {
  try {
    const saved = localStorage.getItem(SETTINGS_CATEGORY_KEY);
    if (saved && SETTINGS_CATEGORIES.some((c) => c.id === saved)) {
      return saved as SettingsCategoryId;
    }
  } catch {
    // ignore — no localStorage access
  }
  return DEFAULT_SETTINGS_CATEGORY;
}

export const SettingsPage: React.FC<Props> = ({ settings, onUpdateSetting, sidebarCollapsed, onToggleSidebar }) => {
  const [category, setCategory] = useState<SettingsCategoryId>(readInitialCategory);

  const selectCategory = (id: SettingsCategoryId) => {
    setCategory(id);
    try { localStorage.setItem(SETTINGS_CATEGORY_KEY, id); } catch { /* ignore */ }
  };

  const activeCategoryLabel = SETTINGS_CATEGORIES.find((c) => c.id === category)?.label ?? '';

  const renderCategoryContent = () => {
    if (!settings) return null;
    switch (category) {
      case 'appearance':
        return <AppearanceSection settings={settings} onUpdate={onUpdateSetting} />;
      case 'navigation':
        return (
          <NavigationSection
            settings={settings}
            onUpdate={onUpdateSetting}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={onToggleSidebar}
          />
        );
      case 'notifications':
        return <NotificationsSection settings={settings} onUpdate={onUpdateSetting} />;
      case 'about':
        return <AboutSection />;
      case 'advanced':
        return <AdvancedSection />;
      default:
        return <EmptyCategorySection categoryLabel={activeCategoryLabel} />;
    }
  };

  return (
    <div className="settings-page">
      <nav className="settings-categories" aria-label="Settings categories">
        {SETTINGS_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={c.id === category ? 'active' : ''}
            aria-current={c.id === category ? 'page' : undefined}
            onClick={() => selectCategory(c.id)}
          >
            {c.label}
          </button>
        ))}
      </nav>
      <div className="settings-content" role="region" aria-label={`${activeCategoryLabel} settings`}>
        <h2>{activeCategoryLabel}</h2>
        {renderCategoryContent()}
      </div>
    </div>
  );
};

export default SettingsPage;
