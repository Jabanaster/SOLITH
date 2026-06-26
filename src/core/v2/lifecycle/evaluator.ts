import type {
  EvidenceBundle,
  EvidenceConfidence,
  LifecycleState,
  LifecycleStateSnapshot,
  ProcessIdentity,
} from './types.js';

/**
 * Combines available evidence into a single LifecycleState.
 *
 * A single weak signal never advances to 'external_session_observed'.
 * Multiple corroborating signals are required for high-confidence states.
 */
export function evaluateEvidence(
  evidence: EvidenceBundle,
  previousState: LifecycleState,
  previousIdentity: ProcessIdentity | null
): LifecycleStateSnapshot {
  const { process: proc, endpoints, marker } = evidence;

  const gamePresent = proc.availability === 'available' && proc.identity !== null;
  const pidReused = detectPidReuse(proc.identity, previousIdentity);

  // Endpoint signals
  const hasListener = endpoints.availability === 'available' && endpoints.listeners.length > 0;
  const hasConnection = endpoints.availability === 'available' && endpoints.connections.length > 0;

  // Marker signal
  const hasMarker = marker.availability === 'available' && marker.markerPresent;

  // PID reuse → stale evidence for any state that depended on process identity
  if (pidReused) {
    return snapshot('stale_evidence', 'contradictory', null, false,
      `PID reuse detected: previous identity no longer matches current process`, evidence);
  }

  // ── No game ─────────────────────────────────────────────────────────────
  if (!gamePresent) {
    // Was there a session before? Game exited while session was active.
    const hadSession = previousState === 'external_session_observed' ||
      previousState === 'session_ended_game_running' ||
      previousState === 'observing';

    if (hadSession) {
      return snapshot('game_exited', 'observed', null, false,
        `Game process not found. Session evidence was present in prior state.`, evidence);
    }

    // Stale markers without a game = stale evidence
    if (hasMarker || hasListener) {
      return snapshot('stale_evidence', 'stale', null, false,
        `Session markers present but game process is not running`, evidence);
    }

    return snapshot('game_not_running', 'observed', null, false,
      `Game process not detected`, evidence);
  }

  // ── Game is running ─────────────────────────────────────────────────────
  const identity = proc.identity!;

  // Count active session signals
  const sessionSignals = [hasListener, hasConnection, hasMarker].filter(Boolean).length;

  // Strong session: all three corroborating
  if (sessionSignals >= 3) {
    return snapshot('external_session_observed', 'verified', identity, true,
      `Game running · Localhost listener observed · Connection pair observed · Session marker present`, evidence);
  }

  // Good session: two out of three
  if (sessionSignals === 2) {
    const confidence: EvidenceConfidence = 'observed';
    return snapshot('external_session_observed', confidence, identity, true,
      buildSessionSummary(hasListener, hasConnection, hasMarker, identity), evidence);
  }

  // Partial session: one signal only → 'observing' (accumulating)
  if (sessionSignals === 1) {
    return snapshot('observing', 'likely', identity, false,
      buildSessionSummary(hasListener, hasConnection, hasMarker, identity), evidence);
  }

  // Session was active, now all markers gone → session ended
  if (previousState === 'external_session_observed' ||
      previousState === 'session_ended_game_running' ||
      previousState === 'observing') {
    return snapshot('session_ended_game_running', 'observed', identity, false,
      `The observed trainer session ended. The game is still running.`, evidence);
  }

  // Game running, no session evidence
  return snapshot('game_running', 'observed', identity, false,
    `Game running · No session markers detected`, evidence);
}

function detectPidReuse(
  current: ProcessIdentity | null,
  previous: ProcessIdentity | null
): boolean {
  if (!current || !previous) return false;
  // Same PID but different start time = OS reused the PID for a new process
  return current.pid === previous.pid && current.startTime !== previous.startTime;
}

function buildSessionSummary(
  hasListener: boolean,
  hasConnection: boolean,
  hasMarker: boolean,
  identity: ProcessIdentity
): string {
  const signals: string[] = [`Game running (PID ${identity.pid})`];
  if (hasListener) signals.push('Localhost listener observed');
  if (hasConnection) signals.push('Connection pair observed');
  if (hasMarker) signals.push('Session marker present');
  return signals.join(' · ');
}

function snapshot(
  state: LifecycleState,
  confidence: EvidenceConfidence,
  gameIdentity: ProcessIdentity | null,
  externalSessionActive: boolean,
  evidenceSummary: string,
  evidence: EvidenceBundle
): LifecycleStateSnapshot {
  return {
    state,
    confidence,
    gameIdentity,
    externalSessionActive,
    evidenceSummary,
    observedAt: evidence.collectedAt,
  };
}
