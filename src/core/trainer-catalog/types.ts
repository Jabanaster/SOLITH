import type { LivePointerPath } from '../live-memory/pointer-resolver.js';

export type ModPackSourceProvider =
  | 'bundled'
  | 'mrantifun'
  | 'fling'
  | 'plitch'
  | 'wemod'
  | 'fearless'
  | 'community'
  | 'user';

export type VerificationStatus = 'verified' | 'community' | 'metadata-only' | 'unverified';

export interface ModPackSource {
  provider: ModPackSourceProvider;
  url?: string;
  trainerTitle?: string;
  lastSyncedAt?: string;
}

export interface ModPackVersionFingerprint {
  /** Human label such as "1.2.3" or "*" for any */
  versionLabel: string;
  /** Process executable names for this build */
  executables: string[];
  /** Optional SHA256 prefixes of the main executable */
  executableHashPrefixes?: string[];
}

export interface ModPackCheat {
  id: string;
  name: string;
  description: string;
  category: string;
  valueType: string;
  requiresDiscovery: boolean;
  verified: boolean;
  pointerPath?: LivePointerPath;
  infiniteValue?: number;
  defaultValue?: number;
  tags?: string[];
}

export interface ModPack {
  packId: string;
  catalogGameId: string;
  gameName: string;
  source: ModPackSource;
  verificationStatus: VerificationStatus;
  versions: ModPackVersionFingerprint[];
  cheats: ModPackCheat[];
  connectionBaseline: number;
  platform: 'steam' | 'epic' | 'xbox-game-pass' | 'standalone' | 'unknown';
  syncedAt: string;
  notes?: string[];
}

export interface TrainerCatalogEntry {
  catalogGameId: string;
  displayName: string;
  steamAppId?: number;
  executables: string[];
  categories: string[];
  headerUrl?: string;
  coverUrl?: string;
  iconUrl?: string;
  verificationStatus: VerificationStatus;
  sources: Array<{ provider: ModPackSourceProvider; url: string; lastSyncedAt?: string }>;
  hasModPack: boolean;
  modPackId?: string;
  cheatCount: number;
  searchableText: string;
}

export interface TrainerCatalogSearchResult {
  entries: TrainerCatalogEntry[];
  total: number;
  query: string;
  offset: number;
  limit: number;
}

export interface TrainerSyncSourceConfig {
  id: ModPackSourceProvider;
  displayName: string;
  baseUrl: string;
  listPath: string;
  enabled: boolean;
  /** Definitions only — never download third-party .exe binaries */
  definitionsOnly: true;
}

export function slugifyGameId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function steamCdnImages(appId: number): Pick<TrainerCatalogEntry, 'headerUrl' | 'coverUrl' | 'iconUrl'> {
  const base = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}`;
  return {
    headerUrl: `${base}/header.jpg`,
    coverUrl: `${base}/library_600x900_2x.jpg`,
    iconUrl: `${base}/capsule_231x87.jpg`,
  };
}

export function buildSearchableText(entry: Pick<TrainerCatalogEntry, 'displayName' | 'executables' | 'categories'>): string {
  return [entry.displayName, ...entry.executables, ...entry.categories].join(' ').toLowerCase();
}

export function validateModPack(pack: ModPack): string[] {
  const errors: string[] = [];
  if (!pack.packId) errors.push('packId required');
  if (!pack.catalogGameId) errors.push('catalogGameId required');
  if (!pack.gameName) errors.push('gameName required');
  if (!Array.isArray(pack.cheats)) errors.push('cheats must be an array');
  if (!Array.isArray(pack.versions) || pack.versions.length === 0) errors.push('versions required');
  for (const cheat of pack.cheats ?? []) {
    if (!cheat.id || !cheat.name) errors.push(`cheat missing id/name: ${cheat.id ?? '?'}`);
    if (cheat.verified && !cheat.pointerPath && !cheat.requiresDiscovery) {
      errors.push(`verified cheat ${cheat.id} needs pointerPath or requiresDiscovery`);
    }
  }
  return errors;
}
