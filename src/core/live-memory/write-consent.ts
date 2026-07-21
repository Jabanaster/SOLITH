/**
 * Write-time consent guard (Trust Shift).
 *
 * Blocks only when the user has not accepted the single-player / private-play
 * waiver. Connection counts are advisory in the reason string and never block.
 * Legacy evaluateOnlineGuard remains for diagnostics / KI-017 history.
 */
import type { OnlineGuardResult, RemoteConnectionEvidence } from './types.js';

export interface WriteConsentInput {
  userConfirmedOffline: boolean;
  /** Optional advisory observation — logged in reason, never blocks. */
  remoteConnections?: RemoteConnectionEvidence;
}

export function evaluateWriteConsent(input: WriteConsentInput): OnlineGuardResult {
  if (!input.userConfirmedOffline) {
    return {
      allowed: false,
      reason:
        'Single-player / private-play waiver not accepted. Solith will not modify memory until you confirm responsibility.',
    };
  }

  const evidence = input.remoteConnections;
  if (evidence && evidence.availability === 'available') {
    return {
      allowed: true,
      reason: `Single-player waiver accepted (advisory: ${evidence.remoteConnectionCount} remote connection(s) observed; not blocking).`,
    };
  }

  if (evidence && evidence.availability !== 'available') {
    return {
      allowed: true,
      reason: `Single-player waiver accepted (advisory: network state ${evidence.availability}; not blocking).`,
    };
  }

  return {
    allowed: true,
    reason: 'Single-player waiver accepted.',
  };
}
