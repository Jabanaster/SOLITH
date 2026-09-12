import { getGames } from '../games/index.js';
import { getCatalogEntry } from '../trainer-catalog/store.js';
import { resolveCatalogCoverUrl } from '../trainer-catalog/cover-url.js';
import type { VerificationStatus } from '../trainer-catalog/types.js';
import { planCanonicalMigration, applyCanonicalMigrationPlan } from './migration.js';
import { listCanonicalGames, listInstallationsForGame } from './store.js';
import type { CanonicalGame, CanonicalGameSupportState, GameInstallation } from './types.js';

/**
 * Lazy, idempotent activation point for the Phase 2A canonical migration (Step 22).
 * Phase 2A deliberately never wired this to app boot; Phase 2B activates it here,
 * at the point the Game Library is actually read, so a failure never blocks app
 * startup and never touches legacy `installed_games`/`games` rows — only the
 * additive canonical tables. Errors are caught and logged; legacy data is untouched
 * on failure, and a subsequent successful read will retry from scratch (idempotent).
 */
export function ensureCanonicalGamesMigrated(nowIso: string): void {
  try {
    const plan = planCanonicalMigration(nowIso);
    applyCanonicalMigrationPlan(plan);
  } catch (error) {
    console.error('Canonical game migration failed; legacy Game Library data is unaffected:', error);
  }
}

export type GameLibraryDetectionSource = 'auto-detected' | 'manual';

export interface GameLibraryInstallationRecord {
  installationId: string;
  launcher: GameInstallation['launcher'];
  edition?: string;
  installPath?: string;
  executablePath?: string;
  buildVersion?: string;
  launchUri?: string;
  lastSeenAt: string;
  detectionSource: GameLibraryDetectionSource;
  /** Whether the underlying source row (installed_games or legacy games) still exists. */
  active: boolean;
  /** The legacy `games` table id backing this installation, when detectionSource is 'manual'. Lets the renderer reuse existing edit/scan/remove flows, which are keyed off that table. */
  sourceGameId?: string;
}

export type GameLibraryTrainerAvailability = 'available' | 'unavailable' | 'unknown';

export interface GameLibraryRecord {
  canonicalGameId: string;
  title: string;
  aliases: string[];
  artworkUrl?: string;
  supportState: CanonicalGameSupportState;
  trainerAvailability: GameLibraryTrainerAvailability;
  verificationStatus: VerificationStatus | 'unknown';
  /** Only ever 'owned' when a trustworthy ownership evidence source exists (Step 16) — none does yet, so this is always undefined today. */
  ownershipStatus?: 'owned';
  manuallyAdded: boolean;
  installations: GameLibraryInstallationRecord[];
  saveLocations: string[];
}

function toGameLibraryRecord(game: CanonicalGame, activeLegacyGameIds: Set<string>, saveLocationsByLegacyId: Map<string, string[]>): GameLibraryRecord {
  const installations = listInstallationsForGame(game.id);
  const saveLocations = new Set<string>();
  let manuallyAdded = false;

  const installationRecords: GameLibraryInstallationRecord[] = installations.map((installation) => {
    // 'legacy-sourced' (this installation was migrated from the manually-managed `games`
    // table) is distinct from `launcher === 'manual'` — install-discovery can itself
    // produce platform:'manual' rows (a user-picked folder during a discovery scan) that
    // are NOT legacy `games` rows and have no edit/scan/remove flow to reuse.
    const legacyGameId = installation.sourceInstalledGameId?.startsWith('legacy-game:')
      ? installation.sourceInstalledGameId.slice('legacy-game:'.length)
      : undefined;
    const isLegacySourced = legacyGameId !== undefined;
    if (isLegacySourced) manuallyAdded = true;
    if (legacyGameId) {
      for (const location of saveLocationsByLegacyId.get(legacyGameId) ?? []) saveLocations.add(location);
    }
    // install-discovery has no row-removal/prune capability today (upsert-only) — every
    // detected installation stays known once seen, so 'active' for non-legacy-sourced
    // installations is always true. Legacy `games` rows DO support real deletion
    // (deleteGame), so legacy-sourced installations track that removal honestly instead.
    const active = isLegacySourced ? activeLegacyGameIds.has(legacyGameId as string) : true;
    return {
      installationId: installation.id,
      launcher: installation.launcher,
      edition: installation.edition,
      installPath: installation.installPath,
      executablePath: installation.executablePath,
      buildVersion: installation.buildVersion,
      launchUri: installation.launchUri,
      lastSeenAt: installation.lastSeenAt,
      detectionSource: isLegacySourced ? 'manual' : 'auto-detected',
      active,
      sourceGameId: legacyGameId,
    };
  });

  const catalogEntry = game.catalogGameId ? getCatalogEntry(game.catalogGameId) : null;
  const trainerAvailability: GameLibraryTrainerAvailability = game.catalogGameId
    ? (catalogEntry ? 'available' : 'unavailable')
    : 'unknown';
  // Audit + Mission 7 (partial) — `identityStatus` is exactly the tier-trust
  // signal computed at migration time (migration.ts: 'verified' when the
  // canonical identity key was tier 1-3/trusted, 'backfilled' when it was
  // only a tier-4 title-only match). A 'backfilled' game may have picked up
  // its catalogGameId link through a weak/ambiguous match (see
  // install-discovery/match.ts's executable-collision fallback), so the
  // linked catalog entry could be the wrong edition/remaster — provider-
  // derived (Steam CDN) artwork must not be trusted in that case.
  const artworkConfidence = game.identityStatus === 'verified' ? 'trusted' : 'weak';

  return {
    canonicalGameId: game.id,
    title: game.displayName,
    aliases: game.aliases,
    artworkUrl: game.artworkIdentity?.coverUrl ?? (catalogEntry ? resolveCatalogCoverUrl(catalogEntry, { canonicalConfidence: artworkConfidence }) : undefined),
    supportState: game.supportState,
    trainerAvailability,
    verificationStatus: catalogEntry?.verificationStatus ?? 'unknown',
    ownershipStatus: undefined,
    manuallyAdded,
    installations: installationRecords,
    saveLocations: [...saveLocations],
  };
}

export type GameLibraryView = 'installed' | 'all' | 'owned';

/**
 * Builds the renderer-facing Game Library model from the canonical game/installation
 * tables, lazily activating migration first (Step 22). 'installed' (the default per
 * ROADMAP.md 2.5) includes only canonical games with at least one still-active
 * installation; 'all' includes every canonical game regardless of current activity;
 * 'owned' is filtered to proven ownership only (Step 16) — always empty today since
 * no ownership evidence source exists yet, which is the truthful result, not a bug.
 */
export function buildGameLibraryRecords(view: GameLibraryView = 'installed', nowIso: string = new Date().toISOString()): GameLibraryRecord[] {
  ensureCanonicalGamesMigrated(nowIso);

  const legacyGames = getGames();
  const activeLegacyGameIds = new Set(legacyGames.map((g) => g.id));
  const saveLocationsByLegacyId = new Map<string, string[]>(
    legacyGames.map((g) => [g.id, g.saveLocations ?? []]),
  );

  const records = listCanonicalGames().map((game) =>
    toGameLibraryRecord(game, activeLegacyGameIds, saveLocationsByLegacyId),
  );

  if (view === 'owned') return records.filter((r) => r.ownershipStatus === 'owned');
  if (view === 'all') return records;
  return records.filter((r) => r.installations.some((installation) => installation.active));
}
