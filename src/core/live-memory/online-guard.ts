import type { OnlineGuardInput, OnlineGuardResult } from './types.js';

/**
 * Online-session guard for live memory writes.
 *
 * Fail-closed by design (mirrors the `isGameRunning` philosophy in
 * src/core/v2/lifecycle/types.ts: "assume NOT running if we can't verify" —
 * here inverted to "assume online/unsafe if we can't verify offline").
 *
 * A write is only allowed when ALL of:
 * 1. The user has explicitly confirmed this attach session is single-player/offline.
 * 2. Remote-connection evidence is available.
 * 3. The observed non-loopback connection count is at or under this game's
 *    declared baseline (default 0 — today's strict "any connection blocks"
 *    behavior — unless a reviewed PerGameConnectionBaseline entry says
 *    otherwise; see KI-017). A count above the baseline still blocks: that
 *    means something appeared beyond the reviewed platform-overhead noise
 *    floor, which is exactly the signal this guard exists to catch.
 *
 * Evidence overrides confirmation: unavailable evidence, or a count above
 * baseline, blocks the write even when the user has confirmed offline play.
 */
export function evaluateOnlineGuard(input: OnlineGuardInput): OnlineGuardResult {
  if (!input.userConfirmedOffline) {
    return {
      allowed: false,
      reason: 'User has not confirmed this session is single-player/offline.',
    };
  }

  const evidence = input.remoteConnections;
  const baseline = input.acceptedConnectionBaseline ?? 0;

  if (evidence.availability !== 'available') {
    return {
      allowed: false,
      reason: `Could not verify network state (${evidence.availability}); blocking as a precaution.`,
    };
  }

  if (evidence.remoteConnectionCount > baseline) {
    return {
      allowed: false,
      reason:
        baseline > 0
          ? `Target process has ${evidence.remoteConnectionCount} active remote connection(s), above the reviewed baseline of ${baseline}; this may be an online/multiplayer session.`
          : `Target process has ${evidence.remoteConnectionCount} active remote connection(s); this may be an online/multiplayer session.`,
    };
  }

  return {
    allowed: true,
    reason:
      baseline > 0
        ? `User confirmed offline play and remote-connection count (${evidence.remoteConnectionCount}) is at or under the reviewed baseline of ${baseline}.`
        : 'User confirmed offline play and no remote connections were observed for the target process.',
  };
}
