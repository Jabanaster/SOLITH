import {
  fingerprintBlocksAttach,
  verifyDefinitionFingerprint,
  type FingerprintVerifyResult,
} from '../definitions/fingerprint-verify.js';
import type { SolithDefinitionV1 } from '../definitions/schema.v1.js';
import {
  assessTargetProcessAuthorization,
  type TargetProcessAuthorizationResult,
} from '../runtime/protected-target-guard.js';

/**
 * NOTE on Phase 3: an earlier audit pass referenced a
 * `checkExecutableRoleApplicability` API as the intended executable-role
 * gate. It does not exist anywhere in this repository (confirmed by
 * exhaustive grep) — that audit note was stale. The real, already-production
 * mechanism for rejecting a launcher/helper/system/anti-cheat-protected
 * process as a trainer target is `assessTargetProcessAuthorization` +
 * `assessProtectedTarget` (src/core/runtime/protected-target-guard.ts),
 * which `LiveMemorySession.attach()` already calls internally. This module
 * composes the same exported, side-effect-free functions rather than
 * duplicating their logic or inventing a new Phase 3 surface:
 *   - `assessTargetProcessAuthorization` needs only pid/name/path, so it can
 *     run here as a PRE-BIND check (no open process handle required).
 *   - `assessProtectedTarget` needs the target's loaded module list, which is
 *     only available after `driver.openProcess()` — so protected-target
 *     (anti-cheat/DRM) rejection is inherently bind-time-only. This module
 *     does not fabricate a pre-bind answer for it; `runtime.ts`'s bind()
 *     step gets that enforcement for free by calling the real
 *     `capabilities.attach()` and classifying its result.
 */
export type CompatibilityStatus = 'compatible' | 'incompatible' | 'ambiguous' | 'unsupported';

export interface CompatibilityDecision {
  status: CompatibilityStatus;
  reason: string;
  fingerprint?: FingerprintVerifyResult;
  processAuthorization?: TargetProcessAuthorizationResult;
}

export interface PreBindCompatibilityInput {
  pid: number;
  executableName: string;
  executablePath?: string | null;
  /** Actual running executable's SHA-256, when known ahead of attach. */
  executableHashSHA256?: string | null;
  /** User already acknowledged a previously-reported fingerprint drift. */
  driftAcknowledged?: boolean;
}

/**
 * Pre-bind compatibility decision — everything checkable WITHOUT opening a
 * process handle: target-process self/system authorization, and executable
 * fingerprint (full hash / hash-prefix) against the canonical definition.
 * Never turns missing evidence into a false "compatible" — see the
 * 'unsupported' and 'ambiguous' branches below.
 */
export function checkPreBindCompatibility(
  definition: SolithDefinitionV1,
  input: PreBindCompatibilityInput,
): CompatibilityDecision {
  const auth = assessTargetProcessAuthorization({
    pid: input.pid,
    executableName: input.executableName,
    executablePath: input.executablePath,
  });
  if (!auth.allowed) {
    const status: CompatibilityStatus =
      auth.blockedKind === 'invalid_pid' || auth.blockedKind === 'no_executable_name' ? 'unsupported' : 'incompatible';
    return { status, reason: auth.reason, processAuthorization: auth };
  }

  const fingerprint = verifyDefinitionFingerprint({
    executableHashSHA256: input.executableHashSHA256 ?? null,
    executableHashPrefixes: definition.executableHashPrefixes,
    targetSHA256: definition.targetSHA256,
  });

  if (fingerprintBlocksAttach(fingerprint, input.driftAcknowledged)) {
    return {
      status: 'incompatible',
      reason: fingerprint.warning ?? 'Executable fingerprint mismatch.',
      fingerprint,
      processAuthorization: auth,
    };
  }

  if (fingerprint.status === 'mismatch' && input.driftAcknowledged) {
    // Blocked-by-default drift the user explicitly accepted: proceeding, but
    // under acknowledged uncertainty — not a clean "compatible".
    return {
      status: 'ambiguous',
      reason: fingerprint.warning ?? 'Executable drift acknowledged by user; proceeding under uncertainty.',
      fingerprint,
      processAuthorization: auth,
    };
  }

  if (fingerprint.status === 'skipped') {
    if (fingerprint.warning) {
      // verifyDefinitionFingerprint only attaches a warning to a 'skipped'
      // result when the definition DOES declare a constraint (prefixes or a
      // target hash) but no live hash was available to check it against —
      // genuinely unverifiable, not "nothing to check".
      return { status: 'unsupported', reason: fingerprint.warning, fingerprint, processAuthorization: auth };
    }
    // No warning: either nothing was declared, or a hash was available but
    // the definition declares no constraint — nothing to violate either way.
    return { status: 'compatible', reason: 'No fingerprint constraint declared by definition.', fingerprint, processAuthorization: auth };
  }

  return { status: 'compatible', reason: `Fingerprint ${fingerprint.status}.`, fingerprint, processAuthorization: auth };
}
