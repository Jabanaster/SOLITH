import type { LivePointerPath } from '../live-memory/pointer-resolver.js';

export type ModPackSourceProvider =
  | 'bundled'
  | 'mrantifun'
  | 'fling'
  | 'plitch'
  | 'remote-listing'
  | 'fearless'
  | 'community'
  | 'solith-hub'
  | 'user'
  | 'ct-import';

export type VerificationStatus = 'verified' | 'community' | 'metadata-only' | 'unverified';

/**
 * Phase 3A (§3.1/§3.2) safety-classification evidence. 'unknown' (or the field
 * being absent) means no trusted evidence exists yet — it must never be treated
 * as a safe default. Never derived from title/genre/launcher/popularity.
 */
export type AntiCheatStatus = 'none' | 'protected-multiplayer' | 'protected-online-only' | 'unknown';

/** Phase 3A (§3.2) catalog exclusion categories — explicit evidence only, never inferred. */
export type CatalogExclusionFlag =
  | 'mmo'
  | 'competitive-online-only'
  | 'no-meaningful-offline-play'
  | 'cloud-only'
  | 'dedicated-server'
  | 'demo'
  | 'soundtrack'
  | 'editor-tool'
  | 'dlc-only'
  | 'unsupported-delisted';

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
  certificationLevel?: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
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
  certLevel?: 'L0_Community' | 'L3_Certified';
  sources: Array<{ provider: ModPackSourceProvider; url: string; lastSyncedAt?: string }>;
  hasModPack: boolean;
  modPackId?: string;
  cheatCount: number;
  searchableText: string;
  /**
   * Optional Phase 1 schema.v1 capability lanes (advisory).
   * Filled by search/load IPC when a definition payload exists — not a second SoT.
   */
  capabilities?: import('../definitions/load-catalog-definition.js').CatalogDefinitionCapabilities | null;
  /** Phase 3A safety/exclusion evidence — absent means no known evidence (see AntiCheatStatus). */
  antiCheat?: AntiCheatStatus;
  offlinePlayAvailable?: boolean;
  catalogExclusionFlags?: CatalogExclusionFlag[];
  explicitlyUnsupported?: boolean;
  /** ROADMAP §3.5 "Newest release" — real release date from seed/import sources only; undefined = unknown. */
  releaseDate?: string;
  /** ROADMAP §3.5 "Recently added to SOLITH" — set once on first insert; undefined on legacy pre-migration rows. */
  createdAt?: string;
  /** ROADMAP §3.5 "Recently updated" — set only on a meaningful content change, not every sync/upsert; undefined = never meaningfully updated. */
  contentUpdatedAt?: string;
  /** ROADMAP §3.6 Mode — curated capability evidence only; undefined field = unknown, never inferred from categories/antiCheat/offlinePlayAvailable. */
  modeCapabilities?: GameModeCapabilities;
  /** ROADMAP §3.6 Catalog "All-time classic" — curated flag only; no age/popularity threshold is fabricated. */
  isAllTimeClassic?: boolean;
  /** ROADMAP §3.6 Availability "Owned" — explicit local user confirmation only (never inferred from installation/launcher/catalog presence). Set via a deliberate "Mark as owned" action, distinct from `installations` evidence in the canonical Game Library model. */
  ownedConfirmed?: boolean;
}

/**
 * ROADMAP §3.6 Mode capability lanes. `undefined` on any field means unknown —
 * it must never be silently treated as `false`. Populated only by explicit
 * curated evidence (seed/import/manual curation), never inferred.
 */
export interface GameModeCapabilities {
  singlePlayer?: boolean;
  offlineCoop?: boolean;
  localMultiplayer?: boolean;
  onlineFeaturesPresent?: boolean;
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
