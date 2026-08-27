import type { CanonicalGameId } from './types.js';

/**
 * Adaptive Wisp Increment 6 — live canonical-game resolution (Sections
 * "Increment 6 objectives"/"required behavior").
 *
 * Pure, injectable, no I/O. Answers exactly one question: given the V2
 * Session Monitor's current status snapshot, is there a verified,
 * unambiguous, currently-attached canonical game right now?
 *
 * Reuses two existing authorities rather than inventing a third:
 *   - SessionMonitorService (src/core/v2/session-monitor.ts, unchanged) —
 *     the only place in the codebase that already tracks process identity
 *     (pid + startTime, PID-reuse-aware) for a game the user explicitly
 *     started monitoring via 'v2-monitor-start'.
 *   - the canonical-games store (src/core/canonical-games/store.ts,
 *     unchanged) — the only existing authoritative registry of canonical
 *     game identities, looked up by exact primary key.
 *
 * `MonitorConfig.gameId` is a renderer-supplied string (validated only for
 * shape by V2MonitorStartSchema, not for registry membership) — it must
 * never be trusted as a canonical game id on its own. This resolver treats
 * it only as a CANDIDATE id and requires the injected `lookup` (an exact,
 * non-fuzzy canonical-games/store.js query in production) to confirm it
 * before returning anything. An unrecognized candidate resolves to `null`,
 * never to a best-guess/fuzzy match — matching Increment 4's own identity
 * discipline (no fuzzy/executable-substring/display-name/cast-based
 * mapping) and this closeout's explicit prohibition on the same.
 */

const ATTACHED_LIFECYCLE_STATES = new Set([
  'game_running',
  'observing',
  'external_session_observed',
  'solith_session_connected',
  'session_ended_game_running',
]);

const REJECTED_EVIDENCE_CONFIDENCE = new Set(['stale', 'contradictory', 'unavailable']);

export interface WispLiveProcessIdentity {
  pid: number;
  /** ISO 8601 process creation timestamp — combined with pid to detect PID reuse (unchanged from ProcessIdentity in v2/lifecycle/types.ts). */
  startTime: string;
}

/** Structural subset of SessionMonitorService's LifecycleStateSnapshot this resolver actually reads — kept narrow so this file needs no import of v2/session-monitor.js or v2/lifecycle/types.js, preserving the adaptive-wisp domain's static purity boundary. */
export interface WispSessionMonitorSnapshotLike {
  state: string;
  confidence: string;
  gameIdentity: WispLiveProcessIdentity | null;
}

/** Structural subset of SessionMonitorService's MonitorStatus.config — a sibling field to `snapshot`, not nested inside it (see MonitorStatus in v2/session-monitor.ts). */
export interface WispSessionMonitorConfigLike {
  gameId: string;
}

export interface WispCanonicalGameLookupResult {
  canonicalGameId: CanonicalGameId;
}

/** Exact, non-fuzzy lookup of a candidate id against the real canonical-games registry. Returns null for anything not an exact primary-key match — never a best guess. */
export type WispCanonicalGameLookup = (candidateId: string) => WispCanonicalGameLookupResult | null;

export interface WispResolvedLiveGameIdentity {
  gameId: CanonicalGameId;
  process: WispLiveProcessIdentity;
}

/**
 * Resolves the currently-attached canonical game, or `null` when there is
 * none, the evidence is not trustworthy, or the candidate id does not match
 * any real canonical game. Fail-closed on every branch — never throws, never
 * returns a partial/best-effort identity.
 */
export function resolveLiveCanonicalGameIdentity(
  snapshot: WispSessionMonitorSnapshotLike | null,
  config: WispSessionMonitorConfigLike | null,
  lookup: WispCanonicalGameLookup,
): WispResolvedLiveGameIdentity | null {
  if (!snapshot) return null;
  if (!ATTACHED_LIFECYCLE_STATES.has(snapshot.state)) return null;
  if (REJECTED_EVIDENCE_CONFIDENCE.has(snapshot.confidence)) return null;
  if (!snapshot.gameIdentity) return null;
  if (!config?.gameId) return null;

  const resolved = lookup(config.gameId);
  if (!resolved) return null;

  return {
    gameId: resolved.canonicalGameId,
    process: snapshot.gameIdentity,
  };
}
