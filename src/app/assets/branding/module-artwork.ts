import type { SolithBrandingArtwork } from './index.js';

export type ModuleViewId =
  | 'library'
  | 'trainer'
  | 'saves'
  | 'data'
  | 'discovery-lab'
  | 'discovery'
  | 'community'
  | 'trainer-research'
  | 'recipes'
  | 'proposal-inspector'
  | 'backups'
  | 'journal'
  | 'locations'
  | 'compatibility'
  | 'session-monitor'
  | 'controls'
  | 'live-memory'
  | 'trainer-library'
  | 'linked-libraries'
  | 'ct-library'
  | 'trainer-deck'
  | 'catalog-save-controls'
  | 'registry-explorer'
  | 'home'
  | 'my-games'
  | 'game-detail'
  | 'settings';

/**
 * Icon assignment:
 * - libraryTempleBook: top-level Library section
 * - gameLibraryControllerMonitors: Game Library
 * - trainerLibraryStopwatchClipboard: Trainer Library
 * - trainerController: game trainer context
 * - saveTools: save editor, trainer controls
 * - recoveryPhoenix: Community identity (Discovery Master Pass section 33 —
 *   "the Phoenix becomes the Community icon"); also still used for
 *   journal/save-locations pending a full Stage-6 artwork audit.
 * - hoodedProfile: discovery-lab, trainer research, data editor, compatibility, recipes
 * - advancedDragon: session monitor, live memory
 *
 * `discovery` (the new game-universe browser) and `backups` deliberately
 * have NO entry below — they fall back to their plain `Icon` (see
 * AppSidebar.tsx), since reusing hoodedProfile (an engineering-tool asset)
 * or recoveryPhoenix (now Community's) for either would misrepresent them.
 * Both need their own approved branding artwork in the Stage 6 pass.
 */
export const NAV_MODULE_ARTWORK: Partial<Record<ModuleViewId, SolithBrandingArtwork>> = {
  library: 'gameLibraryControllerMonitors',
  'trainer-library': 'trainerLibraryStopwatchClipboard',
  'linked-libraries': 'gameLibraryControllerMonitors',
  'ct-library': 'hoodedProfile',
  trainer: 'trainerController',
  saves: 'saveTools',
  controls: 'saveTools',
  journal: 'recoveryPhoenix',
  locations: 'recoveryPhoenix',
  community: 'recoveryPhoenix',
  'discovery-lab': 'hoodedProfile',
  'trainer-research': 'hoodedProfile',
  data: 'hoodedProfile',
  compatibility: 'hoodedProfile',
  recipes: 'hoodedProfile',
  'proposal-inspector': 'recoveryPhoenix',
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
