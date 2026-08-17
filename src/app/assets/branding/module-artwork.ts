import type { SolithBrandingArtwork } from './index.js';

export type ModuleViewId =
  | 'library'
  | 'trainer'
  | 'saves'
  | 'data'
  | 'discovery'
  | 'trainer-research'
  | 'recipes'
  | 'backups'
  | 'journal'
  | 'locations'
  | 'compatibility'
  | 'session-monitor'
  | 'controls'
  | 'live-memory'
  | 'trainer-library'
  | 'ct-library'
  | 'trainer-deck'
  | 'catalog-save-controls'
  | 'registry-explorer'
  | 'settings';

/**
 * Icon assignment:
 * - libraryTempleBook: top-level Library section
 * - gameLibraryControllerMonitors: Game Library
 * - trainerLibraryStopwatchClipboard: Trainer Library
 * - trainerController: game trainer context
 * - saveTools: save editor, trainer controls
 * - recoveryPhoenix: backups, save locations, journal
 * - hoodedProfile: discovery, trainer research, data editor, compatibility, recipes
 * - advancedDragon: session monitor, live memory
 */
export const NAV_MODULE_ARTWORK: Partial<Record<ModuleViewId, SolithBrandingArtwork>> = {
  library: 'gameLibraryControllerMonitors',
  'trainer-library': 'trainerLibraryStopwatchClipboard',
  'ct-library': 'hoodedProfile',
  trainer: 'trainerController',
  saves: 'saveTools',
  controls: 'saveTools',
  backups: 'recoveryPhoenix',
  journal: 'recoveryPhoenix',
  locations: 'recoveryPhoenix',
  discovery: 'hoodedProfile',
  'trainer-research': 'hoodedProfile',
  data: 'hoodedProfile',
  compatibility: 'hoodedProfile',
  recipes: 'hoodedProfile',
  'session-monitor': 'advancedDragon',
  'live-memory': 'advancedDragon',
  'registry-explorer': 'hoodedProfile',
  'catalog-save-controls': 'saveTools',
};

export const SECTION_ARTWORK: Partial<Record<string, SolithBrandingArtwork>> = {
  Library: 'libraryTempleBook',
  Recovery: 'recoveryPhoenix',
  'Save Tools': 'saveTools',
  Specialized: 'hoodedProfile',
  Advanced: 'advancedDragon',
};

export function artworkForView(view: ModuleViewId): SolithBrandingArtwork | undefined {
  return NAV_MODULE_ARTWORK[view];
}
