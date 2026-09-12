/**
 * Personal Library — default priority comparator (Personal Library Completion
 * pass, Phase 2, Mission 11).
 *
 * This is the fine-grained ordering used for "Recommended" over
 * PersonalLibraryGame-shaped data (src/core/personal-library/model.ts) — the
 * data shape that actually carries per-game running/installed/owned/
 * favorite/trainerAccuracy/canonicalConfidence evidence. It is deliberately
 * NOT a replacement for src/core/trainer-catalog/library-sections.ts's
 * section hierarchy (Installed > Owned-Supported > Owned-Unsupported >
 * Other > Missing) — that hierarchy still owns which SECTION a game lands
 * in. This comparator only orders games WITHIN a rendering context (e.g. a
 * flat "Recommended" list, or ordering inside a single section) and is
 * built so it can never contradict that hierarchy: its own top-level tier
 * order (RUNNING > INSTALLED > CONFIRMED_OWNED > FAVORITE/RECENT >
 * UNOWNED_CATALOG) puts every installed game strictly ahead of every
 * non-installed game, exactly like library-sections.ts's "installed always
 * wins" rule — so an unowned catalog game can never outrank an installed
 * one no matter how strong its trainer evidence is (see the accompanying
 * test suite for an explicit proof of this).
 *
 * Pure, deterministic, fully unit-testable: no I/O, no DB access, no
 * game/process access. Never mutates its input.
 */

import type { CanonicalConfidence, TrainerAvailability } from '../personal-library/model.js';
import type { TrainerAccuracyState } from './trainer-accuracy.js';

/**
 * Top-level tiers, highest priority first. A currently-running game always
 * outranks everything else (it's the thing the user is looking at right
 * now); after that, installed beats confirmed-owned beats
 * favorite-or-recently-detected beats everything else in the catalog.
 */
export type PersonalPriorityTier =
  | 'RUNNING'
  | 'INSTALLED'
  | 'CONFIRMED_OWNED'
  | 'FAVORITE_OR_RECENT'
  | 'UNOWNED_CATALOG';

export const PERSONAL_PRIORITY_TIER_ORDER: readonly PersonalPriorityTier[] = [
  'RUNNING',
  'INSTALLED',
  'CONFIRMED_OWNED',
  'FAVORITE_OR_RECENT',
  'UNOWNED_CATALOG',
];

const TIER_RANK: Record<PersonalPriorityTier, number> = PERSONAL_PRIORITY_TIER_ORDER.reduce(
  (acc, tier, index) => ({ ...acc, [tier]: index }),
  {} as Record<PersonalPriorityTier, number>,
);

/**
 * Minimal evidence shape this comparator needs. `PersonalLibraryGame`
 * (src/core/personal-library/model.ts) satisfies this structurally, so
 * callers can pass PersonalLibraryGame objects directly without adapting
 * them.
 */
export interface PersonalPriorityEvidence {
  title: string;
  running: boolean;
  installed: boolean;
  /** Tri-state per model.ts — only `true` (explicit user confirmation) counts as CONFIRMED_OWNED. */
  owned: true | false | 'unknown';
  favorite: boolean;
  recentlyDetected: boolean;
  trainerAccuracy: TrainerAccuracyState;
  canonicalConfidence: CanonicalConfidence;
  trainerAvailability: TrainerAvailability;
}

/**
 * Highest sub-priority evidence first, matching the mission-frozen order:
 * trainerAccuracy > canonicalConfidence > trainerAvailability > alphabetical.
 */
const ACCURACY_RANK: Record<TrainerAccuracyState, number> = {
  LOCALLY_VERIFIED: 6,
  EXACT_VERSION_MATCH: 5,
  STRONG_MATCH: 4,
  VERSION_UNKNOWN: 3,
  NEEDS_REVERIFY: 2,
  INCOMPATIBLE: 1,
  NONE: 0,
};

const CONFIDENCE_RANK: Record<CanonicalConfidence, number> = {
  EXACT: 3,
  HIGH: 2,
  POSSIBLE: 1,
  UNKNOWN: 0,
};

const AVAILABILITY_RANK: Record<TrainerAvailability, number> = {
  LOCAL: 3,
  VERIFIED: 2,
  COMMUNITY: 1,
  NONE: 0,
};

/** Assigns exactly one top-level tier per game. Order of checks matters — running always wins, then installed, etc. */
export function personalPriorityTierFor(game: PersonalPriorityEvidence): PersonalPriorityTier {
  if (game.running) return 'RUNNING';
  if (game.installed) return 'INSTALLED';
  if (game.owned === true) return 'CONFIRMED_OWNED';
  if (game.favorite || game.recentlyDetected) return 'FAVORITE_OR_RECENT';
  return 'UNOWNED_CATALOG';
}

/**
 * Deterministic comparator: sorts strongest-recommendation-first. Never
 * mutates its arguments. Ties always fall through to alphabetical title
 * (case-insensitive) as the final deterministic tiebreak.
 */
export function comparePersonalLibraryPriority(
  a: PersonalPriorityEvidence,
  b: PersonalPriorityEvidence,
): number {
  const tierDelta = TIER_RANK[personalPriorityTierFor(a)] - TIER_RANK[personalPriorityTierFor(b)];
  if (tierDelta !== 0) return tierDelta;

  const accuracyDelta = ACCURACY_RANK[b.trainerAccuracy] - ACCURACY_RANK[a.trainerAccuracy];
  if (accuracyDelta !== 0) return accuracyDelta;

  const confidenceDelta = CONFIDENCE_RANK[b.canonicalConfidence] - CONFIDENCE_RANK[a.canonicalConfidence];
  if (confidenceDelta !== 0) return confidenceDelta;

  const availabilityDelta = AVAILABILITY_RANK[b.trainerAvailability] - AVAILABILITY_RANK[a.trainerAvailability];
  if (availabilityDelta !== 0) return availabilityDelta;

  return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
}

/** Sorts a list of games by default personal-library priority. Never mutates the input array. */
export function sortByPersonalLibraryPriority<T extends PersonalPriorityEvidence>(games: T[]): T[] {
  return [...games].sort(comparePersonalLibraryPriority);
}
