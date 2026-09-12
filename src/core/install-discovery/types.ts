export type InstallPlatform = 'steam' | 'epic' | 'gog' | 'xbox' | 'ubisoft' | 'ea' | 'battlenet' | 'manual';
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
  /**
   * Diagnostic-only outcome of catalog resolution for this scan pass (see
   * install-discovery/match.ts's CatalogMatchStatus doc for the ranking). Not a
   * persisted column (store.ts's upsertInstalledGames does not write it) — it exists
   * so callers can distinguish "no catalog match at all" from "multiple plausible
   * catalog entries were found and none was safe to auto-pick" without silently
   * treating the latter as an ordinary unmatched game.
   */
  catalogMatchStatus?: 'EXACT' | 'HIGH' | 'AMBIGUOUS' | 'NO_MATCH';
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
  /**
   * Path to a Ubisoft Connect fixture JSON array (tests only):
   * `[{ "gameId": "123", "installDir": "<install>", "exe": "Game.exe", "displayName": "Title" }, ...]`
   */
  ubisoftFixturePath?: string;
  /**
   * Path to an EA app / Origin fixture JSON array (tests only):
   * `[{ "offerId": "abc", "installDir": "<install>", "exe": "Game.exe", "displayName": "Title" }, ...]`
   * An entry may instead set `"source": "ea-desktop"` with `"publisher"` and
   * `"uninstallKey"` fields to simulate a standard Windows uninstall-registry
   * record (see ea.ts) instead of the classic Origin Games key shape.
   */
  eaFixturePath?: string;
  /**
   * Path to an Xbox / Microsoft Store (AppX) fixture JSON array (tests only):
   * `[{ "packageFullName": "Publisher.Game_1.0.0.0_x64__abc", "installDir": "<install>", "displayName": "Title" }, ...]`
   */
  xboxFixturePath?: string;
  /**
   * Path to a Battle.net fixture JSON array, shaped like Windows Uninstall
   * registry subkey values (tests only):
   * `[{ "displayName": "Title", "publisher": "Blizzard Entertainment", "uninstallString": "...\\Battle.net\\Agent\\Blizzard Uninstaller.exe", "displayIcon": "<exe>", "installLocation": "<install>" }, ...]`
   */
  battleNetFixturePath?: string;
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
