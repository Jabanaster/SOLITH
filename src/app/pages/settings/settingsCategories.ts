export type SettingsCategoryId =
  | 'general' | 'appearance' | 'navigation' | 'game-library' | 'trainer-library'
  | 'launchers-accounts' | 'catalog-updates' | 'artwork-cache' | 'notifications'
  | 'privacy-network' | 'advanced' | 'about';

export type SettingsCategory = {
  id: SettingsCategoryId;
  label: string;
};

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'game-library', label: 'Game Library' },
  { id: 'trainer-library', label: 'Trainer Library' },
  { id: 'launchers-accounts', label: 'Launchers & Accounts' },
  { id: 'catalog-updates', label: 'Catalog Updates' },
  { id: 'artwork-cache', label: 'Artwork & Cache' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'privacy-network', label: 'Privacy & Network' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'about', label: 'About' },
];

export const DEFAULT_SETTINGS_CATEGORY: SettingsCategoryId = 'general';
