/**
 * Trainer Library — TrainerCatalogEntry adapter for personal-priority-comparator.ts
 * (Personal Library Completion — Final Closure Pass, Mission 2).
 *
 * personal-priority-comparator.ts is the authoritative "Recommended" ordering
 * policy (RUNNING > INSTALLED > CONFIRMED_OWNED > FAVORITE_OR_RECENT >
 * UNOWNED_CATALOG, sub-ordered by trainerAccuracy > canonicalConfidence >
 * trainerAvailability > title), but it operates on `PersonalPriorityEvidence`
 * — a structural subset of `PersonalLibraryGame`
 * (src/core/personal-library/model.ts). The Trainer Library page's flat/
 * All-Games browse view works with `TrainerCatalogEntry[]`, not
 * `PersonalLibraryGame[]`, so prior to this mission "Recommended" quietly
 * used a DIFFERENT, older comparator (all-games-sorting.ts's 'recommended'
 * mode) that has no owned/favorite/recentlyDetected/trainerAccuracy concept
 * at all — meaning an unowned catalog game with a great trainer could
 * outrank an installed or confirmed-owned game in the actual rendered page,
 * even though the standalone comparator unit tests proved this could never
 * happen. This adapter closes that gap by mapping the real, already-tracked
 * per-render evidence (installed/running/favorite id sets, computed trainer
 * accuracy) onto `PersonalPriorityEvidence` and delegating straight to
 * `sortByPersonalLibraryPriority` — no comparator logic is duplicated here.
 *
 * Two fields are honestly left at their "no evidence" default rather than
 * fabricated, because the flat catalog-browse layer does not carry them:
 *   - `canonicalConfidence`: always 'UNKNOWN'. The page has no per-catalog-
 *     entry canonical-match confidence today — that signal lives on
 *     install-discovery preview records tied to one detected installation,
 *     not a catalog browse entry — so inventing a value would fabricate
 *     evidence. This only affects sub-ordering WITHIN a tier, never which
 *     tier a game lands in.
 *   - `recentlyDetected`: always false. The page has no per-catalog-entry
 *     "installed within the recency window" timestamp at this layer (that
 *     lives on PersonalLibraryGame's install evidence). This never shrinks
 *     the INSTALLED or CONFIRMED_OWNED tiers — those still win on
 *     `installed`/`owned` alone — it only means a catalog entry that is
 *     merely favorited still lands in FAVORITE_OR_RECENT via `favorite`,
 *     and one that is neither favorited nor owned/installed/running cannot
 *     additionally claim recency it has no proof of.
 */
import type { TrainerCatalogEntry } from './types.js';
import type { TrainerAccuracyState } from './trainer-accuracy.js';
import { sortByPersonalLibraryPriority, type PersonalPriorityEvidence } from './personal-priority-comparator.js';

export interface CatalogPersonalPriorityContext {
  installedCatalogGameIds: Set<string>;
  runningCatalogGameIds: Set<string>;
  favoriteCatalogGameIds: Set<string>;
  trainerAccuracyByCatalogGameId: Map<string, TrainerAccuracyState>;
}

export const EMPTY_CATALOG_PERSONAL_PRIORITY_CONTEXT: CatalogPersonalPriorityContext = {
  installedCatalogGameIds: new Set(),
  runningCatalogGameIds: new Set(),
  favoriteCatalogGameIds: new Set(),
  trainerAccuracyByCatalogGameId: new Map(),
};

/**
 * Mirrors src/core/personal-library/model.ts's resolveTrainerAvailability
 * ordering (verified > community/hasModPack > none) minus the LOCAL
 * (user-authored definition) tier, which the flat catalog-browse layer has
 * no signal for — never fabricated.
 */
function trainerAvailabilityFor(entry: TrainerCatalogEntry): PersonalPriorityEvidence['trainerAvailability'] {
  if (entry.verificationStatus === 'verified') return 'VERIFIED';
  if (entry.hasModPack || entry.verificationStatus === 'community') return 'COMMUNITY';
  return 'NONE';
}

/** Real, distinct tri-state — never fabricates `true`/`false` from any other signal. */
function ownershipFor(entry: TrainerCatalogEntry): true | false | 'unknown' {
  if (entry.ownedConfirmed === true) return true;
  if (entry.ownedConfirmed === false) return false;
  return 'unknown';
}

export function catalogEntryToPersonalPriorityEvidence(
  entry: TrainerCatalogEntry,
  context: CatalogPersonalPriorityContext,
): PersonalPriorityEvidence {
  return {
    title: entry.displayName,
    running: context.runningCatalogGameIds.has(entry.catalogGameId),
    installed: context.installedCatalogGameIds.has(entry.catalogGameId),
    owned: ownershipFor(entry),
    favorite: context.favoriteCatalogGameIds.has(entry.catalogGameId),
    recentlyDetected: false,
    trainerAccuracy: context.trainerAccuracyByCatalogGameId.get(entry.catalogGameId) ?? 'NONE',
    canonicalConfidence: 'UNKNOWN',
    trainerAvailability: trainerAvailabilityFor(entry),
  };
}

/**
 * Sorts TrainerCatalogEntry[] by the authoritative personal-priority policy.
 * Never mutates its input. This is the function wired into the real
 * "Recommended" sort option (trainer-library-sort-options.ts).
 */
export function sortCatalogEntriesByPersonalPriority(
  entries: TrainerCatalogEntry[],
  context: CatalogPersonalPriorityContext,
): TrainerCatalogEntry[] {
  const wrapped = entries.map((entry) => ({
    entry,
    ...catalogEntryToPersonalPriorityEvidence(entry, context),
  }));
  return sortByPersonalLibraryPriority(wrapped).map((item) => item.entry);
}
