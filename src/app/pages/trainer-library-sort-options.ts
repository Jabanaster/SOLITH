/**
 * Trainer Library — Sort control (owner-directed reversal of the Mission 3/24
 * sort-mode freeze; see tests/trainer-library-sort-ui.test.ts header comment
 * for the full history). This module is pure/testable logic only — no React,
 * no DOM — so the comparator behavior can be unit tested directly.
 *
 * Scope decision (documented per the owner's request): this sort applies to
 * the FLAT "All Games" / Flat A-Z browse view only. The 5-section hierarchy
 * (library-sections.ts's organizeLibrary) keeps its own frozen A-Z-within-
 * section behavior — sort mode is never applied across section boundaries,
 * so it cannot contradict or reorder the Installed > Owned > Other > Missing
 * hierarchy itself.
 */
import type { TrainerCatalogEntry } from '../../core/trainer-catalog/types.js';
import {
  sortAllGamesEntries,
  type AllGamesSortContext,
} from '../../core/trainer-catalog/all-games-sorting.js';
import type { TrainerAccuracyState } from '../../core/trainer-catalog/trainer-accuracy.js';
import {
  sortCatalogEntriesByPersonalPriority,
  type CatalogPersonalPriorityContext,
} from '../../core/trainer-catalog/personal-priority-catalog-adapter.js';

/**
 * Mission 12 (Personal Library Completion pass, Phase 2) — "Trainer quality"
 * now prefers the REAL per-game TrainerAccuracyState (Phase 1's
 * computeTrainerAccuracy) when the caller supplies it via
 * `trainerAccuracyByCatalogGameId`, instead of the verificationStatus/
 * hasModPack/cheatCount placeholder heuristic this sort used before the real
 * accuracy model existed. When the caller doesn't supply the map (older
 * callers, or tests exercising the plain TrainerCatalogEntry-only path),
 * behavior is unchanged from before — the placeholder heuristic still
 * applies, so nothing that already depended on it silently changes shape.
 */
export interface TrainerLibrarySortContext extends AllGamesSortContext {
  trainerAccuracyByCatalogGameId?: Map<string, TrainerAccuracyState>;
  /**
   * Mission 2 (Personal Library Completion — Final Closure Pass) — the real
   * per-render evidence sets 'Recommended' needs to route through the
   * authoritative personal-priority-comparator.ts policy instead of the
   * older, personalization-blind all-games-sorting.ts model. Absent/omitted
   * (older callers, or tests exercising the plain TrainerCatalogEntry-only
   * path) means "no evidence of this", not "assume none are" — see
   * personal-priority-catalog-adapter.ts's header comment for exactly which
   * fields fall back honestly rather than being fabricated.
   */
  runningCatalogGameIds?: Set<string>;
  favoriteCatalogGameIds?: Set<string>;
}

export type TrainerLibrarySortOption =
  | 'recommended'
  | 'a-z'
  | 'z-a'
  | 'recently-added'
  | 'trainer-quality';

export const DEFAULT_TRAINER_LIBRARY_SORT_OPTION: TrainerLibrarySortOption = 'recommended';

export const TRAINER_LIBRARY_SORT_LABELS: Record<TrainerLibrarySortOption, string> = {
  recommended: 'Recommended',
  'a-z': 'A → Z',
  'z-a': 'Z → A',
  'recently-added': 'Recently added',
  'trainer-quality': 'Trainer quality',
};

export const TRAINER_LIBRARY_SORT_OPTION_ORDER: readonly TrainerLibrarySortOption[] = [
  'recommended',
  'a-z',
  'z-a',
  'recently-added',
  'trainer-quality',
];

function compareByNameAsc(a: TrainerCatalogEntry, b: TrainerCatalogEntry): number {
  const byName = a.displayName.localeCompare(b.displayName);
  if (byName !== 0) return byName;
  return a.catalogGameId.localeCompare(b.catalogGameId);
}

/**
 * "Trainer quality" — the real, non-fabricated signal available on
 * TrainerCatalogEntry: verificationStatus (verified beats community beats
 * metadata-only), then whether a usable mod pack exists at all (hasModPack),
 * then how much content it has (cheatCount), then name as the final
 * deterministic tiebreak. No popularity/demand signal is mixed in here —
 * that is what "Popular now"/"Recommended" already cover.
 */
function verificationRank(entry: TrainerCatalogEntry): number {
  if (entry.verificationStatus === 'verified') return 2;
  if (entry.verificationStatus === 'community') return 1;
  return 0;
}

function compareByTrainerQuality(a: TrainerCatalogEntry, b: TrainerCatalogEntry): number {
  const verificationDelta = verificationRank(b) - verificationRank(a);
  if (verificationDelta !== 0) return verificationDelta;
  const modPackDelta = Number(Boolean(b.hasModPack)) - Number(Boolean(a.hasModPack));
  if (modPackDelta !== 0) return modPackDelta;
  const cheatCountDelta = (b.cheatCount ?? 0) - (a.cheatCount ?? 0);
  if (cheatCountDelta !== 0) return cheatCountDelta;
  return compareByNameAsc(a, b);
}

/**
 * Mission 12's exact frozen order: LOCALLY_VERIFIED > EXACT_VERSION_MATCH >
 * STRONG_MATCH > VERSION_UNKNOWN > NEEDS_REVERIFY > INCOMPATIBLE > NONE.
 * An entry absent from the map has no accuracy evidence at all, which is
 * honestly equivalent to NONE (rather than a guess).
 */
const TRAINER_ACCURACY_SORT_RANK: Record<TrainerAccuracyState, number> = {
  LOCALLY_VERIFIED: 6,
  EXACT_VERSION_MATCH: 5,
  STRONG_MATCH: 4,
  VERSION_UNKNOWN: 3,
  NEEDS_REVERIFY: 2,
  INCOMPATIBLE: 1,
  NONE: 0,
};

function compareByRealTrainerAccuracy(
  a: TrainerCatalogEntry,
  b: TrainerCatalogEntry,
  accuracyByCatalogGameId: Map<string, TrainerAccuracyState>,
): number {
  const aAccuracy = accuracyByCatalogGameId.get(a.catalogGameId) ?? 'NONE';
  const bAccuracy = accuracyByCatalogGameId.get(b.catalogGameId) ?? 'NONE';
  const delta = TRAINER_ACCURACY_SORT_RANK[bAccuracy] - TRAINER_ACCURACY_SORT_RANK[aAccuracy];
  if (delta !== 0) return delta;
  return compareByNameAsc(a, b);
}

/**
 * Sorts a flat list of catalog entries per the selected option. Never
 * mutates the input array.
 */
export function sortTrainerLibraryFlatEntries(
  entries: TrainerCatalogEntry[],
  option: TrainerLibrarySortOption,
  context: TrainerLibrarySortContext = {},
): TrainerCatalogEntry[] {
  switch (option) {
    case 'a-z':
      return entries.slice().sort(compareByNameAsc);
    case 'z-a':
      return entries.slice().sort((a, b) => compareByNameAsc(b, a));
    case 'recently-added':
      return sortAllGamesEntries(entries, 'recently-added', context);
    case 'trainer-quality':
      return context.trainerAccuracyByCatalogGameId
        ? entries.slice().sort((a, b) => compareByRealTrainerAccuracy(a, b, context.trainerAccuracyByCatalogGameId!))
        : entries.slice().sort(compareByTrainerQuality);
    case 'recommended':
    default: {
      // Mission 2 (Personal Library Completion — Final Closure Pass): wired
      // to the authoritative personal-priority-comparator.ts policy (RUNNING
      // > INSTALLED > CONFIRMED_OWNED > FAVORITE_OR_RECENT > UNOWNED_CATALOG,
      // sub-ordered by trainerAccuracy > canonicalConfidence >
      // trainerAvailability > title) via the adapter in
      // personal-priority-catalog-adapter.ts, rather than
      // all-games-sorting.ts's older installed/popularity-only ranking model
      // (see tests/trainer-library-sort-ui.test.ts's reversal notice for the
      // history). Because that comparator's top-level tier order puts every
      // installed/owned/running game strictly ahead of every unowned catalog
      // game, an unowned catalog entry with an excellent trainer can never
      // outrank an installed or confirmed-owned game here, in the RENDERED
      // sort, not merely in the standalone comparator test.
      const priorityContext: CatalogPersonalPriorityContext = {
        installedCatalogGameIds: context.installedCatalogGameIds ?? new Set(),
        runningCatalogGameIds: context.runningCatalogGameIds ?? new Set(),
        favoriteCatalogGameIds: context.favoriteCatalogGameIds ?? new Set(),
        trainerAccuracyByCatalogGameId: context.trainerAccuracyByCatalogGameId ?? new Map(),
      };
      return sortCatalogEntriesByPersonalPriority(entries, priorityContext);
    }
  }
}
