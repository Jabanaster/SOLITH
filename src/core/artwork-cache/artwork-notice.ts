import { setSetting } from '../settings/index.js';

/**
 * Artwork Notice — Policy v1 (ROADMAP Phase 1 online-foundation, Mission 15).
 * Reuses the EXACT versioned-acknowledgment settings-key pattern already
 * established by the Offline Safety Acknowledgment mechanism
 * (src/core/safety-acknowledgment/policy.ts +
 * src/core/settings/index.ts#recordSafetyAcknowledgment/getSafetyAckState):
 * a policy-version column plus an epoch-ms acknowledgment timestamp,
 * persisted through the generic key/value `settings` table (no schema
 * change required — `setSetting`/`getSetting` already operate on arbitrary
 * `keyof Settings` string keys).
 *
 * This is a ONE-TIME, APPLICATION-LEVEL notice — it is never shown per-game,
 * and unlike the safety acknowledgment it has no 30-day recurring reminder.
 * This module only exposes read/write functions; no UI is wired here.
 */

/**
 * Bump ONLY for a MATERIAL change to what the notice discloses (e.g. a
 * meaningfully different rights/provenance policy for cached artwork). Do
 * NOT bump for wording/copy or layout changes — see the identical guidance
 * on SAFETY_POLICY_VERSION in src/core/safety-acknowledgment/policy.ts.
 */
export const ARTWORK_NOTICE_POLICY_VERSION = 1;

/**
 * Owner's verbatim draft text, ARTWORK NOTICE section of the Phase 1
 * online-foundation master prompt. Do not reword — only replace via an
 * explicit owner-approved revision (and bump ARTWORK_NOTICE_POLICY_VERSION
 * only for a material policy change, per the guidance above).
 */
export const ARTWORK_NOTICE_TEXT =
  'GAME ARTWORK NOTICE\n\n' +
  'SOLITH does not own or distribute the copyrights to third-party game artwork, logos, screenshots, or promotional images.\n\n' +
  'When Online Services are enabled, SOLITH may retrieve artwork on demand from the platform associated with a game and cache it locally on your device for personal library display.\n\n' +
  'SOLITH does not ship a bundled library of third-party game artwork.\n\n' +
  'You may replace platform artwork with your own custom local image at any time.';

/**
 * Raw, UNTRUSTED persisted values as read from settings — mirrors
 * SafetyAckPersistedState's contract in safety-acknowledgment/policy.ts.
 */
export interface ArtworkNoticePersistedState {
  artworkNoticeAckPolicyVersion?: unknown;
  artworkNoticeAckAt?: unknown;
}

/** A valid version is a non-negative integer. Anything else is invalid — same rule as safety-acknowledgment/policy.ts#parseValidVersion. */
function parseValidVersion(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isInteger(value) || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/** A valid timestamp is a finite, non-negative epoch-ms number or an ISO string that parses to one — same rule as safety-acknowledgment/policy.ts#parseValidTimestamp (no "future" check needed here since this module never compares against `now`). */
function parseValidTimestamp(value: unknown): number | null {
  let ms: number;
  if (typeof value === 'number') {
    ms = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    ms = Date.parse(value);
  } else {
    return null;
  }
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms;
}

/**
 * Deterministic, pure evaluation of whether the current Artwork Notice
 * policy version has been acknowledged. Fail-closed: any malformed,
 * missing, or version-mismatched persisted state (including a stored
 * version higher than ARTWORK_NOTICE_POLICY_VERSION, e.g. a downgrade)
 * reads as "not acknowledged" — the worst-case UX outcome is the notice
 * being shown again, never a silent bypass.
 */
export function hasAcknowledgedArtworkNotice(settings: ArtworkNoticePersistedState): boolean {
  const storedVersion = parseValidVersion(settings.artworkNoticeAckPolicyVersion);
  const ackAtMs = parseValidTimestamp(settings.artworkNoticeAckAt);
  return storedVersion !== null && storedVersion === ARTWORK_NOTICE_POLICY_VERSION && ackAtMs !== null;
}

/**
 * Records a fresh Artwork Notice acknowledgment at the CURRENT policy
 * version and the current (or injected) time — mirrors
 * recordSafetyAcknowledgment's shape exactly. This is the only writer for
 * these two settings.
 */
export function recordArtworkNoticeAcknowledgement(nowMs: number = Date.now()): void {
  setSetting('artworkNoticeAckPolicyVersion', ARTWORK_NOTICE_POLICY_VERSION);
  setSetting('artworkNoticeAckAt', nowMs);
}
