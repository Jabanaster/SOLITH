import type { SolithBrandingArtwork } from './index.js';

/** Primary app views — maps each route to its secondary module artwork. */
export type ModuleViewId =
  | 'library'
  | 'trainer'
  | 'saves'
  | 'data'
  | 'discovery'
  | 'recipes'
  | 'backups'
  | 'journal'
  | 'locations'
  | 'compatibility'
  | 'session-monitor'
  | 'controls'
  | 'live-memory'
  | 'multi-game-trainer'
  | 'trainer-library';

/**
 * Secondary Solith artwork per module (user-provided asset mapping):
 * - trainerController: trainer / live memory controls
 * - recoveryPhoenix: backup, restore, rollback, recovery
 * - advancedDragon: advanced / discovery utilities
 * - hoodedProfile: profiles, library, compatibility, specialized tools
 */
export const NAV_MODULE_ARTWORK: Partial<Record<ModuleViewId, SolithBrandingArtwork>> = {
  library: 'hoodedProfile',
  trainer: 'trainerController',
  saves: 'trainerController',
  backups: 'recoveryPhoenix',
  journal: 'recoveryPhoenix',
  locations: 'hoodedProfile',
  discovery: 'advancedDragon',
  data: 'advancedDragon',
  recipes: 'advancedDragon',
  compatibility: 'hoodedProfile',
  'session-monitor': 'advancedDragon',
  'live-memory': 'trainerController',
  'multi-game-trainer': 'trainerController',
  'trainer-library': 'trainerController',
  controls: 'trainerController',
};

export const SECTION_ARTWORK: Partial<Record<string, SolithBrandingArtwork>> = {
  Library: 'hoodedProfile',
  'Core Tools': 'recoveryPhoenix',
  Utilities: 'advancedDragon',
  Advanced: 'advancedDragon',
};

export function artworkForView(view: ModuleViewId): SolithBrandingArtwork | undefined {
  return NAV_MODULE_ARTWORK[view];
}
