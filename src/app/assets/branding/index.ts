import landscapeBackground from './solith-landscape-background.png';
import topBanner from './solith-top-banner.png';
import trainerController from './solith-trainer-controller.png';
import recoveryPhoenix from './solith-recovery-phoenix.png';
import advancedDragon from './solith-advanced-dragon.png';
import hoodedProfile from './solith-hooded-profile.png';

/** Secondary module artwork — small, decorative only (not page backgrounds). */
export const solithBranding = {
  landscapeBackground,
  topBanner,
  trainerController,
  recoveryPhoenix,
  advancedDragon,
  hoodedProfile,
} as const;

export type SolithBrandingArtwork = keyof typeof solithBranding;

export * from './module-artwork.js';
