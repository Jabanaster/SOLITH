import type { SolithBrandingArtwork } from './index.js';

/** Primary app views — maps each route to its secondary module artwork. */
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
  | 'multi-game-trainer'
  | 'trainer-library'
  | 'catalog-save-controls';

/**
 * Custom Solith artwork for sidebar nav items only where semantic match is strong.
 * All other items use vendored Tabler SVG icons from `Icon`.
 *
 * Custom usage rules:
 * - trainerController (winged): Game Library, Live Memory Trainer, Multi-Game Cheats, game trainer context
 * - recoveryPhoenix: Backups / recovery flows
 * - advancedDragon: Advanced / V2 section label only (not per-item nav)
 * - hoodedProfile: profiles / sensitive tools on pages — not normal sidebar nav
 */
export const NAV_MODULE_ARTWORK: Partial<Record<ModuleViewId, SolithBrandingArtwork>> = {
  library: 'trainerController',
  trainer: 'trainerController',
  backups: 'recoveryPhoenix',
  discovery: 'hoodedProfile',
  'trainer-research': 'hoodedProfile',
  'live-memory': 'trainerController',
  'multi-game-trainer': 'trainerController',
};

/** Section header artwork — smaller than nav icons; decorative grouping only. */
export const SECTION_ARTWORK: Partial<Record<string, SolithBrandingArtwork>> = {
  Library: 'trainerController',
  'Core Tools': 'recoveryPhoenix',
  Advanced: 'advancedDragon',
};

export function artworkForView(view: ModuleViewId): SolithBrandingArtwork | undefined {
  return NAV_MODULE_ARTWORK[view];
}
