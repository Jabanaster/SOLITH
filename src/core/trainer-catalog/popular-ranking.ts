import type { TrainerCatalogEntry } from './types.js';
import { filterEligibleForTrainerLibrary } from './eligibility-classification.js';

/**
 * ROADMAP.md §3.3 bounded Popular projection size. If fewer eligible entries
 * exist than this limit, the full eligible set is returned (Step 9).
 */
export const POPULAR_TRAINER_LIMIT = 500;

/** Real local demand signal (src/core/catalog-demand/store.ts) — never fabricated. */
export interface TrainerCatalogPopularityEvidence {
  notifyCount?: number;
  verificationRequests?: number;
}

export interface TrainerCatalogRankingContext {
  /** catalogGameId set for installations detected on this PC. */
  installedCatalogGameIds?: Set<string>;
  /** catalogGameId -> existing local demand evidence (catalog_demand table). Absent entries use the deterministic fallback (Step 8) — never a fabricated score. */
  popularityByCatalogGameId?: Map<string, TrainerCatalogPopularityEvidence>;
}

export interface TrainerCatalogRankSignals {
  /** ROADMAP §3.3 ranking tier 1 — real signal (install-discovery). */
  installed: boolean;
  /** ROADMAP §3.3 ranking tier 2 — verified provenance AND a real trainer/mod pack present. */
  verifiedSolithSupport: boolean;
  /** ROADMAP §3.3 ranking tier 3 — sum of real local demand evidence (notifyCount + verificationRequests). 0 when no evidence exists; never fabricated. */
  popularityValue: number;
  /** True when popularityValue is 0 because no local demand evidence exists yet for this entry (fallback, not measured zero-popularity). */
  popularityIsFallback: boolean;
  /**
   * ROADMAP §3.3 ranking tier 4 ("Recently released"). No release-date evidence
   * field exists anywhere in the current catalog schema (Step 8: do not fabricate).
   * Always false — this tier deterministically ties for every entry until a real
   * release-date field is added in a future slice.
   */
  recentlyReleased: false;
  /**
   * ROADMAP §3.3 ranking tier 5 ("Enduring favorites"). No long-term-favorite
   * evidence field exists in the current catalog schema. Always false — ties for
   * every entry until a real evidence source exists (Step 8).
   */
  enduringFavorite: false;
  /** Final deterministic, stable tie-break — never depends on DB row order. */
  deterministicKey: string;
}

export interface RankedTrainerCatalogEntry {
  entry: TrainerCatalogEntry;
  rankSignals: TrainerCatalogRankSignals;
}

export function computeRankSignals(
  entry: TrainerCatalogEntry,
  context: TrainerCatalogRankingContext = {},
): TrainerCatalogRankSignals {
  const installed = context.installedCatalogGameIds?.has(entry.catalogGameId) ?? false;
  const verifiedSolithSupport = entry.verificationStatus === 'verified' && entry.hasModPack === true;
  const demand = context.popularityByCatalogGameId?.get(entry.catalogGameId);
  const popularityValue = (demand?.notifyCount ?? 0) + (demand?.verificationRequests ?? 0);
  return {
    installed,
    verifiedSolithSupport,
    popularityValue,
    popularityIsFallback: !demand || popularityValue === 0,
    recentlyReleased: false,
    enduringFavorite: false,
    deterministicKey: `${entry.displayName.toLowerCase()}::${entry.catalogGameId}`,
  };
}

function compareRanked(a: RankedTrainerCatalogEntry, b: RankedTrainerCatalogEntry): number {
  const sa = a.rankSignals;
  const sb = b.rankSignals;
  if (sa.installed !== sb.installed) return sa.installed ? -1 : 1;
  if (sa.verifiedSolithSupport !== sb.verifiedSolithSupport) return sa.verifiedSolithSupport ? -1 : 1;
  if (sa.popularityValue !== sb.popularityValue) return sb.popularityValue - sa.popularityValue;
  // recentlyReleased / enduringFavorite tiers always tie today (Step 8) — no
  // comparison performed, deliberately, rather than fabricating a signal.
  return sa.deterministicKey.localeCompare(sb.deterministicKey);
}

/**
 * ROADMAP §3.3 pure, deterministic ranking layer. Re-applies the Phase 3A
 * eligibility boundary itself (Step 4) so a caller can never accidentally rank
 * an excluded title in by forgetting to pre-filter.
 */
export function rankPopularTrainerEntries(
  entries: TrainerCatalogEntry[],
  context: TrainerCatalogRankingContext = {},
): RankedTrainerCatalogEntry[] {
  const eligible = filterEligibleForTrainerLibrary(entries);
  const dedupedByCatalogGameId = new Map<string, TrainerCatalogEntry>();
  for (const entry of eligible) {
    if (!dedupedByCatalogGameId.has(entry.catalogGameId)) {
      dedupedByCatalogGameId.set(entry.catalogGameId, entry);
    }
  }
  const ranked = Array.from(dedupedByCatalogGameId.values()).map((entry) => ({
    entry,
    rankSignals: computeRankSignals(entry, context),
  }));
  ranked.sort(compareRanked);
  return ranked;
}

/** Bounded Popular projection (Step 9) — first `POPULAR_TRAINER_LIMIT` ranked eligible entries, or all of them if fewer exist. */
export function projectPopularTrainerEntries(
  entries: TrainerCatalogEntry[],
  context: TrainerCatalogRankingContext = {},
): RankedTrainerCatalogEntry[] {
  return rankPopularTrainerEntries(entries, context).slice(0, POPULAR_TRAINER_LIMIT);
}
