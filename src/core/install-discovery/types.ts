export type InstallPlatform = 'steam' | 'epic' | 'gog' | 'manual';

export interface RawInstalledGame {
  platform: InstallPlatform;
  installPath: string;
  executablePath?: string;
  displayName?: string;
  steamAppId?: number;
}

export interface InstalledGameRecord extends RawInstalledGame {
  id: string;
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
}

export interface InstallDiscoveryScanResult {
  discovered: number;
  matched: number;
  platforms: Record<InstallPlatform, number>;
  scannedAt: string;
}
