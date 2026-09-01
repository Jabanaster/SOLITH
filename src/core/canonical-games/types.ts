import type { InstallPlatform } from '../install-discovery/types.js';

export type CanonicalGameEligibility =
  | 'eligible'
  | 'listed'
  | 'community'
  | 'verified'
  | 'unsupported'
  | 'excluded';

export type CanonicalGameSupportState = 'supported' | 'partial' | 'unsupported' | 'unknown';

/** Mirrors InstallIdentityStatus (install-discovery/types.ts) at the canonical-game level. */
export type CanonicalIdentityStatus = 'verified' | 'backfilled' | 'ambiguous';

export interface CanonicalGameArtworkIdentity {
  headerUrl?: string;
  coverUrl?: string;
  iconUrl?: string;
}

export interface CanonicalGamePopularityMetadata {
  notifyCount?: number;
  verificationRequests?: number;
}

export interface CanonicalGame {
  id: string;
  displayName: string;
  normalizedTitle: string;
  aliases: string[];
  developer?: string;
  publisher?: string;
  releaseDate?: string;
  genres: string[];
  playModes: string[];
  eligibility: CanonicalGameEligibility;
  supportState: CanonicalGameSupportState;
  artworkIdentity?: CanonicalGameArtworkIdentity;
  popularityMetadata?: CanonicalGamePopularityMetadata;
  /** Bridge to trainer_catalog_games.catalogGameId — see canonical-games/identity.ts. Never a second source of truth. */
  catalogGameId?: string;
  identityStatus: CanonicalIdentityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface GameInstallation {
  id: string;
  canonicalGameId: string;
  launcher: InstallPlatform;
  launcherGameId?: string;
  installPath?: string;
  executablePath?: string;
  processNames?: string[];
  edition?: string;
  buildVersion?: string;
  launchUri?: string;
  trainerProfileCompatible?: boolean;
  /** installed_games.install_identity this installation was migrated/derived from, for traceability. */
  installIdentity: string;
  /** installed_games.id this installation was migrated from, when applicable. */
  sourceInstalledGameId?: string;
  detectedAt: string;
  lastSeenAt: string;
}

/** Evidence extracted from one installed_games row (or a fresh detection) used to group installations into canonical games. */
export interface CanonicalIdentityEvidence {
  sourceId: string;
  platform: InstallPlatform;
  steamAppId?: number;
  catalogGameId?: string;
  installIdentity: string;
  canonicalExecutablePath?: string;
  launcherAppId?: string;
  displayName?: string;
  installPath?: string;
  executablePath?: string;
  detectedAt: string;
  lastSeenAt: string;
}

export type CanonicalIdentityTier = 1 | 2 | 3 | 4 | 5;

export interface CanonicalIdentityKey {
  key: string;
  tier: CanonicalIdentityTier;
  trusted: boolean;
}
