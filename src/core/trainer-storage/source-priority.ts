import type { TrainerModPackRow } from '../trainer-catalog/store.js';
import type { TrainerDefinitionSourceType } from './types.js';

/**
 * Deterministic source-priority ordering for when multiple trainer_mod_packs
 * rows exist for the same catalogGameId (mission §21, conflict
 * reconciliation). The prior behavior (store.ts's `ORDER BY syncedAt DESC
 * LIMIT 1`) picked whichever row happened to sync most recently — an
 * accident of sync timing, not a deliberate rule. This formalizes the
 * ordering the codebase already informally implies elsewhere
 * (`hasUserAuthoredDefinition()` already treats 'user'/'ct-import' as more
 * authoritative than generic content):
 *
 *   user > ct-import > solith-hub > community listing providers > bundled
 *
 * A user's own edit or import should win over a generic default even though
 * 'bundled' content carries the highest CERTIFICATION level (L3) — priority
 * here is about content specificity/intent, not certification trust. The
 * winning row's own cert_level is always returned as-is (never escalated to
 * a shadowed row's level), so this never inflates certification (mission
 * §21: "no certification escalation").
 */
const SOURCE_PRIORITY: Record<string, number> = {
  user: 0,
  'ct-import': 1,
  'solith-hub': 2,
  community: 3,
  mrantifun: 3,
  fling: 3,
  plitch: 3,
  fearless: 3,
  'remote-listing': 3,
  bundled: 4,
};

const UNKNOWN_PROVIDER_PRIORITY = 3; // treated alongside the other community-listing providers

export function sourcePriorityRank(sourceProvider: string): number {
  return SOURCE_PRIORITY[sourceProvider] ?? UNKNOWN_PROVIDER_PRIORITY;
}

export function sourceTypeForProvider(sourceProvider: string): TrainerDefinitionSourceType {
  switch (sourceProvider) {
    case 'bundled':
      return 'bundled';
    case 'user':
      return 'manual';
    case 'ct-import':
      return 'ct_import';
    case 'solith-hub':
      return 'hub_sync';
    case 'community':
    case 'mrantifun':
    case 'fling':
    case 'plitch':
    case 'fearless':
    case 'remote-listing':
      return 'community_listing';
    default:
      return 'unknown';
  }
}

export interface PickedRow {
  winner: TrainerModPackRow;
  conflicts: TrainerModPackRow[];
}

/**
 * Picks the single row to treat as canonical for a game with one or more
 * persisted trainer_mod_packs rows. Never silent about the others — every
 * row that was NOT picked is returned in `conflicts` so a caller can surface
 * it (provenance.conflictingSources) instead of it silently disappearing.
 *
 * @throws if `rows` is empty — callers must have already handled the
 * zero-rows / NOT_FOUND case before calling this.
 */
export function pickPreferredRow(rows: TrainerModPackRow[]): PickedRow {
  if (rows.length === 0) {
    throw new Error('pickPreferredRow: rows must be non-empty.');
  }
  const sorted = [...rows].sort((a, b) => {
    const rankDiff = sourcePriorityRank(a.sourceProvider) - sourcePriorityRank(b.sourceProvider);
    if (rankDiff !== 0) return rankDiff;
    // Same priority tier: most recently synced wins as the final tiebreaker.
    return b.syncedAt.localeCompare(a.syncedAt);
  });
  const [winner, ...conflicts] = sorted;
  return { winner, conflicts };
}
