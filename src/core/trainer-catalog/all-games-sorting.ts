import type { TrainerCatalogEntry } from './types.js';
import { rankPopularTrainerEntries, type TrainerCatalogRankingContext } from './popular-ranking.js';

/** ROADMAP §3.5 — all 10 required sort keys. */
export type AllGamesSortMode =
  | 'installed-first'
  | 'a-z'
  | 'verified-first'
  | 'popular-now'
  | 'most-trainer-options'
  | 'recommended'
  | 'all-time-popular'
  | 'newest-release'
  | 'recently-added'
  | 'recently-updated';

export interface AllGamesSortPopularityEvidence {
  notifyCount?: number;
  verificationRequests?: number;
}

export interface AllGamesSortContext {
  installedCatalogGameIds?: Set<string>;
  /** "Popular now" — pre-fulfillment demand (catalog_demand: notifyCount + verificationRequests). Same signal Phase 3B uses. */
  popularityByCatalogGameId?: Map<string, AllGamesSortPopularityEvidence>;
  /**
   * "All-time popular" — genuinely distinct cumulative signal: lifetime positive
   * "Confirm works" community feedback (definition_feedback, rating > 0), which never
   * resets or decays. Deliberately NOT the same map as popularityByCatalogGameId.
   */
  allTimePopularityByCatalogGameId?: Map<string, number>;
}

function popularityValueFor(entry: TrainerCatalogEntry, context: AllGamesSortContext): number {
  const demand = context.popularityByCatalogGameId?.get(entry.catalogGameId);
  return (demand?.notifyCount ?? 0) + (demand?.verificationRequests ?? 0);
}

function allTimePopularityValueFor(entry: TrainerCatalogEntry, context: AllGamesSortContext): number {
  return context.allTimePopularityByCatalogGameId?.get(entry.catalogGameId) ?? 0;
}

function compareByName(a: TrainerCatalogEntry, b: TrainerCatalogEntry): number {
  return a.displayName.localeCompare(b.displayName);
}

/**
 * Parses an ISO date/datetime string to epoch millis. Returns undefined for
 * missing or malformed values so callers can treat them identically to "unknown"
 * (sorts last) rather than crashing or silently coercing to 0/Date.now().
 */
function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Descending by a possibly-missing timestamp; missing/malformed values always sort last, then falls back to name. */
function compareByTimestampDesc(
  a: TrainerCatalogEntry,
  b: TrainerCatalogEntry,
  read: (entry: TrainerCatalogEntry) => string | undefined,
): number {
  const aTime = parseTimestamp(read(a));
  const bTime = parseTimestamp(read(b));
  if (aTime === undefined && bTime === undefined) return compareByName(a, b);
  if (aTime === undefined) return 1;
  if (bTime === undefined) return -1;
  if (aTime !== bTime) return bTime - aTime;
  return compareByName(a, b);
}

/**
 * All Games sort projection — a derived, non-mutating view over the eligible catalog.
 * Does not alter Popular's Phase 3B ranking model or any canonical catalog data.
 */
export function sortAllGamesEntries(
  entries: TrainerCatalogEntry[],
  sortMode: AllGamesSortMode,
  context: AllGamesSortContext = {},
): TrainerCatalogEntry[] {
  const installed = context.installedCatalogGameIds ?? new Set<string>();

  if (sortMode === 'recommended') {
    // ROADMAP §3.5 "Recommended" — reuses the existing §3.3 ranking model verbatim
    // (Installed -> Verified SOLITH support -> Popular now -> ...). No personalization,
    // no new signal; this is the same deterministic model Popular already uses.
    const rankingContext: TrainerCatalogRankingContext = {
      installedCatalogGameIds: context.installedCatalogGameIds,
      popularityByCatalogGameId: context.popularityByCatalogGameId,
    };
    return rankPopularTrainerEntries(entries, rankingContext).map((ranked) => ranked.entry);
  }

  return entries.slice().sort((a, b) => {
    switch (sortMode) {
      case 'a-z':
        return compareByName(a, b);
      case 'verified-first': {
        const aVerified = a.verificationStatus === 'verified' ? 1 : 0;
        const bVerified = b.verificationStatus === 'verified' ? 1 : 0;
        if (aVerified !== bVerified) return bVerified - aVerified;
        return compareByName(a, b);
      }
      case 'popular-now': {
        const diff = popularityValueFor(b, context) - popularityValueFor(a, context);
        if (diff !== 0) return diff;
        return compareByName(a, b);
      }
      case 'all-time-popular': {
        const diff = allTimePopularityValueFor(b, context) - allTimePopularityValueFor(a, context);
        if (diff !== 0) return diff;
        return compareByName(a, b);
      }
      case 'most-trainer-options': {
        const diff = (b.cheatCount ?? 0) - (a.cheatCount ?? 0);
        if (diff !== 0) return diff;
        return compareByName(a, b);
      }
      case 'newest-release':
        return compareByTimestampDesc(a, b, (entry) => entry.releaseDate);
      case 'recently-added':
        return compareByTimestampDesc(a, b, (entry) => entry.createdAt);
      case 'recently-updated':
        return compareByTimestampDesc(a, b, (entry) => entry.contentUpdatedAt);
      case 'installed-first':
      default: {
        const aInstalled = installed.has(a.catalogGameId) ? 1 : 0;
        const bInstalled = installed.has(b.catalogGameId) ? 1 : 0;
        if (aInstalled !== bInstalled) return bInstalled - aInstalled;
        return compareByName(a, b);
      }
    }
  });
}

export const ALL_GAMES_SORT_MODE_LABELS: Record<AllGamesSortMode, string> = {
  recommended: 'Recommended',
  'popular-now': 'Popular now',
  'all-time-popular': 'All-time popular',
  'newest-release': 'Newest release',
  'recently-added': 'Recently added to SOLITH',
  'recently-updated': 'Recently updated',
  'a-z': 'A–Z',
  'installed-first': 'Installed first',
  'verified-first': 'Verified first',
  'most-trainer-options': 'Most trainer options',
};
