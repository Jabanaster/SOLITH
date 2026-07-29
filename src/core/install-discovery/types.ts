export type InstallPlatform = 'steam' | 'epic' | 'gog' | 'xbox' | 'manual';
export type InstallIdentityStatus = 'verified' | 'backfilled' | 'ambiguous' | 'legacy';

export interface RawInstalledGame {
  platform: InstallPlatform;
  installPath: string;
  executablePath?: string;
  displayName?: string;
  steamAppId?: number;
  launcherAppId?: string;
}

export interface InstalledGameRecord extends RawInstalledGame {
  id: string;
  installIdentity: string;
  canonicalInstallPath: string;
  canonicalExecutablePath?: string;
  identityVersion: number;
  identityStatus: InstallIdentityStatus;
  needsReverification: boolean;
  catalogGameId?: string;
  catalogDisplayName?: string;
  detectedAt: string;
  lastSeenAt: string;
}

export interface InstallDiscoveryOptions {
  /** Override Steam root (contains `steamapps/`). Tests only. */
  steamInstallPath?: string;
  /** Override Epic manifests directory. Tests only. */
  epicManifestsPath?: string;
  /**
   * Path to a GOG fixture JSON array (tests only):
   * `[{ "path": "<install>", "exe": "Game.exe", "gameName": "Title" }, ...]`
   */
  gogFixturePath?: string;
  /** Skip live registry / live Epic-default paths (fixture-only scan). */
  offlineRootsOnly?: boolean;
  /** User-selected library roots to inspect shallowly for local installs. */
  userSelectedRoots?: string[];
  /** Include conservative, shallow common install roots where accessible. */
  includeCommonRoots?: boolean;
}

export interface InstallDiscoveryScanResult {
  discovered: number;
  matched: number;
  platforms: Record<InstallPlatform, number>;
  scannedAt: string;
}

export interface InstallDiscoveryFailure {
  location: string;
  reason: string;
}

export interface InstallDiscoveryPreviewRecord extends InstalledGameRecord {
  previewCandidateId: string;
  duplicate: boolean;
  duplicateReason?: 'same_executable_path' | 'same_launcher_app_id_and_path' | 'same_install_identity';
  duplicateOfId?: string;
  source: string;
  unsupportedReason?: string;
  classification: 'likely_game' | 'uncertain';
  classificationReason: string;
}

/** Minimal, revalidated input accepted at the persistence boundary. */
export interface InstallDiscoveryCommitSelection {
  platform: InstallPlatform;
  installPath: string;
  executablePath?: string;
  displayName?: string;
  steamAppId?: number;
  launcherAppId?: string;
}

export interface InstallDiscoveryRejectedCandidate {
  installPath: string;
  executablePath?: string;
  displayName?: string;
  reason: string;
}

export interface InstallDiscoveryPreviewResult extends InstallDiscoveryScanResult {
  records: InstallDiscoveryPreviewRecord[];
  locationsChecked: string[];
  duplicatesSkipped: number;
  unsupported: InstallDiscoveryPreviewRecord[];
  rejected: InstallDiscoveryRejectedCandidate[];
  failures: InstallDiscoveryFailure[];
}
