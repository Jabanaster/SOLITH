import type { CanonicalGameId } from './types.js';

/**
 * Adaptive Wisp Increment 6 — live canonical-game resolution.
 *
 * Pure, injectable, no I/O. Answers exactly one question: given the V2
 * Session Monitor's current status snapshot, is there a verified,
 * unambiguous, currently-attached canonical game right now?
 *
 * Reuses existing authorities rather than inventing new ones:
 *   - SessionMonitorService (src/core/v2/session-monitor.ts, unchanged) —
 *     tracks process identity (pid + startTime, PID-reuse-aware) for a game
 *     the user explicitly started monitoring via 'v2-monitor-start'.
 *   - the canonical-games store (src/core/canonical-games/store.ts,
 *     unchanged) — the sole authoritative registry of canonical game
 *     identities and their real, install-discovery-populated executable
 *     identities (GameInstallation.executablePath/processNames).
 *   - LiveMemorySession (src/core/live-memory/live-memory-session.ts,
 *     unchanged, independently reviewed in the Increment 4 review) — the
 *     actual attach authority Increment 4's executor mutates through.
 *
 * Increment 6 Tasks 1-4 independent review finding (Finding 1, High):
 * `MonitorConfig.gameId` is a renderer-supplied string, validated only for
 * shape at 'v2-monitor-start' — never against the canonical registry, and
 * never against the executable SessionMonitorService is actually watching.
 * The ORIGINAL Increment 6 implementation validated only that the candidate
 * id EXISTS in the canonical registry. A valid canonical ID string proves
 * that the ID exists; it does NOT prove that the currently attached process
 * IS that game — a renderer could label any real, unrelated running
 * executable as any real, unrelated canonical game id, causing Increment 4's
 * executor to resolve a totally different game's memory-feature schema
 * (module name / offset / pointer chain) and apply it against whatever
 * `LiveMemorySession` is actually attached to.
 *
 * Fixed here with two independent checks, both fail-closed:
 *   1. `verifyObservedExecutableAgainstGame` — the OBSERVED executable
 *      (from SessionMonitorService's own real OS query, not the renderer's
 *      search string) must match one of the CLAIMED canonical game's own
 *      registered installations (`listInstallationsForGame`, unchanged,
 *      populated only by the existing install-discovery/migration pipeline
 *      — never by Adaptive Wisp, never by a renderer at request time).
 *   2. `liveMemoryAttachmentAgreesWithObservedProcess` — if a
 *      LiveMemorySession is currently attached to something, it must be
 *      the SAME pid SessionMonitorService is observing. Closes the
 *      cross-system mismatch where two independently-correct subsystems
 *      silently point at two different processes (Finding 2, Medium).
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
  /** Real OS-queried executable name/path for the observed process (see v2/observers/process-observer.ts's Win32_Process WMI query) — independent evidence, not an echo of the renderer's search string. */
  name?: string;
  executablePath?: string;
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

/** A canonical game's own registered, install-discovery-sourced executable identity — never renderer-supplied, never Adaptive-Wisp-authored (see GameInstallation in canonical-games/types.ts). */
export interface WispRegisteredExecutableIdentity {
  executablePath?: string;
  processNames?: string[];
}

export interface WispCanonicalGameLookupResult {
  canonicalGameId: CanonicalGameId;
  /** That specific game's OWN registered executable identities — used to verify the observed process actually belongs to this game, not merely that this game id exists. */
  registeredExecutables: readonly WispRegisteredExecutableIdentity[];
}

/** Exact, non-fuzzy lookup of a candidate id against the real canonical-games registry. Returns null for anything not an exact primary-key match — never a best guess. */
export type WispCanonicalGameLookup = (candidateId: string) => WispCanonicalGameLookupResult | null;

export interface WispResolvedLiveGameIdentity {
  gameId: CanonicalGameId;
  process: WispLiveProcessIdentity;
}

function normalizeExecutableComparable(value: string): string {
  return value.trim().toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
}

/** Exact basename comparison only (case-insensitive, separator-normalized) — never substring/fuzzy. */
function executableBasename(pathOrName: string): string | null {
  const normalized = normalizeExecutableComparable(pathOrName);
  if (!normalized) return null;
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

/**
 * Does the OBSERVED process's executable identity match ANY of the claimed
 * game's own registered installations? Exact basename match only. Fails
 * closed (false) when there is no observed evidence at all, or when the
 * claimed game has zero registered installations to check against — an
 * unrecognized/undiscovered game is never trusted just because its ID
 * exists in the registry.
 */
export function verifyObservedExecutableAgainstGame(
  observed: Pick<WispLiveProcessIdentity, 'name' | 'executablePath'>,
  registeredExecutables: readonly WispRegisteredExecutableIdentity[],
): boolean {
  const observedBasename = observed.executablePath ? executableBasename(observed.executablePath) : observed.name ? executableBasename(observed.name) : null;
  if (!observedBasename) return false;

  for (const installation of registeredExecutables) {
    if (installation.executablePath) {
      const registeredBasename = executableBasename(installation.executablePath);
      if (registeredBasename && registeredBasename === observedBasename) return true;
    }
    if (installation.processNames) {
      for (const name of installation.processNames) {
        const registeredBasename = executableBasename(name);
        if (registeredBasename && registeredBasename === observedBasename) return true;
      }
    }
  }
  return false;
}

/**
 * Do the two independent process-tracking subsystems agree on WHICH
 * physical process is in play? `liveMemoryAttachedPid` is `null` when no
 * live-memory session is attached at all — nothing to cross-check against
 * yet, so this is trivially satisfied (Increment 4's own executor already
 * fails closed on every mutation when nothing is attached, independent of
 * this check).
 */
export function liveMemoryAttachmentAgreesWithObservedProcess(liveMemoryAttachedPid: number | null, observedPid: number | null): boolean {
  if (liveMemoryAttachedPid === null) return true;
  return liveMemoryAttachedPid === observedPid;
}

/**
 * Resolves the currently-attached canonical game, or `null` when there is
 * none, the evidence is not trustworthy, the candidate id does not match
 * any real canonical game, the observed executable does not belong to that
 * game, or the two independent process-tracking subsystems disagree on
 * which process is in play. Fail-closed on every branch — never throws,
 * never returns a partial/best-effort identity.
 */
export function resolveLiveCanonicalGameIdentity(
  snapshot: WispSessionMonitorSnapshotLike | null,
  config: WispSessionMonitorConfigLike | null,
  lookup: WispCanonicalGameLookup,
  liveMemoryAttachedPid: number | null,
): WispResolvedLiveGameIdentity | null {
  if (!snapshot) return null;
  if (!ATTACHED_LIFECYCLE_STATES.has(snapshot.state)) return null;
  if (REJECTED_EVIDENCE_CONFIDENCE.has(snapshot.confidence)) return null;
  if (!snapshot.gameIdentity) return null;
  if (!config?.gameId) return null;

  const resolved = lookup(config.gameId);
  if (!resolved) return null;

  if (!liveMemoryAttachmentAgreesWithObservedProcess(liveMemoryAttachedPid, snapshot.gameIdentity.pid)) return null;

  if (!verifyObservedExecutableAgainstGame(snapshot.gameIdentity, resolved.registeredExecutables)) return null;

  return {
    gameId: resolved.canonicalGameId,
    process: snapshot.gameIdentity,
  };
}
