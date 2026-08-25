import type { WispGameProfile, WispProfileSource } from './types.js';
import type { WispResolutionContext } from './resolution-types.js';

/**
 * Centralized Adaptive Wisp resolution policy (Increment 2, Sections 16,
 * 19-20, 38-40, 49-50) — every precedence/applicability/tie-break rule the
 * resolver uses lives here, not scattered as `if (source === 'creator')`
 * checks through the resolver itself.
 */

/**
 * Default (no explicit selection) source precedence — lower number wins.
 * 'community' is deliberately absent: a community profile is only ever a
 * resolution candidate when it is the user's explicit `selectedProfileId`
 * (Section 39) — it never wins automatic precedence.
 */
export const WISP_DEFAULT_SOURCE_PRECEDENCE: Readonly<Partial<Record<WispProfileSource, number>>> = {
  user: 0,
  creator: 1,
  builtin: 2,
  generated: 3,
};

export function isEligibleForAutomaticPrecedence(source: WispProfileSource): boolean {
  return source in WISP_DEFAULT_SOURCE_PRECEDENCE;
}

/**
 * gameId must match exactly. A profile that specifies trainerId/tableId
 * constrains applicability to an exact match on that field; a profile that
 * leaves a field unset applies generally (Section 19). tableVersion is
 * informational metadata only at this increment — no semver range logic is
 * invented (Section 20); enforcing it is future work if the repository ever
 * needs real version-range semantics for trainer/table compatibility.
 */
export function isProfileApplicable(profile: WispGameProfile, context: WispResolutionContext): boolean {
  if (profile.gameId !== context.gameId) return false;
  if (profile.trainerId !== undefined && profile.trainerId !== context.trainerId) return false;
  if (profile.tableId !== undefined && profile.tableId !== context.tableId) return false;
  return true;
}

/** Higher score = more specific. Section 50: game+table+trainer > game+table > game+trainer > game-only. */
export function specificityScore(profile: WispGameProfile): number {
  const hasTable = profile.tableId !== undefined;
  const hasTrainer = profile.trainerId !== undefined;
  if (hasTable && hasTrainer) return 3;
  if (hasTable) return 2;
  if (hasTrainer) return 1;
  return 0;
}

/**
 * Deterministic ordering among candidates that are otherwise tied: source
 * precedence first, then specificity (more specific wins), then a stable
 * ascending profileId compare (Section 48-49) — never registry/map insertion
 * order.
 */
export function compareCandidates(a: WispGameProfile, b: WispGameProfile): number {
  const sourceRankA = WISP_DEFAULT_SOURCE_PRECEDENCE[a.source] ?? Number.MAX_SAFE_INTEGER;
  const sourceRankB = WISP_DEFAULT_SOURCE_PRECEDENCE[b.source] ?? Number.MAX_SAFE_INTEGER;
  if (sourceRankA !== sourceRankB) return sourceRankA - sourceRankB;

  const specificityDelta = specificityScore(b) - specificityScore(a);
  if (specificityDelta !== 0) return specificityDelta;

  return a.profileId < b.profileId ? -1 : a.profileId > b.profileId ? 1 : 0;
}
