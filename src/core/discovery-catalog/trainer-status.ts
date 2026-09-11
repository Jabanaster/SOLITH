/**
 * Discovery Catalog — trainer status derivation (Mission 17, Phase 1
 * online-foundation).
 *
 * Pure function only — no UI, no I/O. `NO_TRAINER` is the signal a later UI
 * pass uses to offer "BUILD TRAINER"; this module does not implement that
 * affordance itself.
 */

import type { DiscoveryCatalogEntry } from './types.js';

export type DiscoveryTrainerStatus =
  | 'TRAINER_AVAILABLE'
  | 'COMMUNITY_TRAINER'
  | 'NEEDS_UPDATE'
  | 'NO_TRAINER';

/**
 * Precedence (checked in order): an available update takes priority over
 * either trainer signal so callers never show a stale "available" state;
 * otherwise a first-party trainer (entry.trainerAvailable) wins over a
 * community one; otherwise a community trainer; otherwise NO_TRAINER.
 */
export function deriveDiscoveryTrainerStatus(
  entry: DiscoveryCatalogEntry,
  hasCommunityTrainer: boolean,
  needsUpdate: boolean,
): DiscoveryTrainerStatus {
  if (needsUpdate && (entry.trainerAvailable || hasCommunityTrainer)) {
    return 'NEEDS_UPDATE';
  }
  if (entry.trainerAvailable) {
    return 'TRAINER_AVAILABLE';
  }
  if (hasCommunityTrainer) {
    return 'COMMUNITY_TRAINER';
  }
  return 'NO_TRAINER';
}
