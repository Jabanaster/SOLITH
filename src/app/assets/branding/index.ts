import landscapeBackground from './solith-landscape-background.png';
import shellBackground from './solith-shell-background.png';
import bannerBackdrop from './solith-banner-backdrop.png';
import topBanner from './solith-top-banner.png';
import solithEmblem from './solith-emblem.png';
import trainerController from './solith-trainer-controller.png';
import libraryTempleBook from './solith-library-temple-book.png';
import gameLibraryControllerMonitors from './solith-game-library-controller-monitors.png';
import trainerLibraryStopwatchClipboard from './solith-trainer-library-stopwatch-clipboard.png';
import recoveryPhoenix from './solith-recovery-phoenix.png';
import advancedDragon from './solith-advanced-dragon.png';
import hoodedProfile from './solith-hooded-profile.png';
import saveTools from './solith-save-tools.png';

/** Secondary module artwork — small, decorative only (not page backgrounds). */
export const solithBranding = {
  landscapeBackground,
  shellBackground,
  bannerBackdrop,
  /** Approved full-width shell banner (raster emblem + title + tagline). */
  topBanner,
  /** Cropped emblem from approved banner — title bar / sidebar mark only. */
  solithEmblem,
  trainerController,
  /** Library section — temple/book artwork. */
  libraryTempleBook,
  /** Game Library navigation — controller/monitors artwork. */
  gameLibraryControllerMonitors,
  /** Trainer Library navigation — stopwatch/clipboard artwork. */
  trainerLibraryStopwatchClipboard,
  recoveryPhoenix,
  advancedDragon,
  hoodedProfile,
  /** Toolbox — Save Tools, Save Editor, Trainer Controls. */
  saveTools,
} as const;

export type SolithBrandingArtwork = keyof typeof solithBranding;

export * from './module-artwork.js';
