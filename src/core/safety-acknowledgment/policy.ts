/**
 * Offline Safety Acknowledgment — Policy v1 (Core Product Completion,
 * BLOCKER-01). Single authoritative module for the acknowledgment policy
 * version, the reminder interval, and the deterministic state evaluator.
 * Every date/version decision lives here — never scatter this logic into
 * React components; components only render whatever state this returns.
 *
 * CRITICAL: this module is UX policy only. It has no relationship to, and
 * must never be imported by, any runtime safety/authorization code path
 * (AuthorityService, attach/read/write/freeze gates, protected-target
 * checks, canonical game binding). See
 * tests/safety-acknowledgment-runtime-independence.test.ts for the
 * regression test proving that boundary holds.
 */

/**
 * Bump ONLY for a MATERIAL safety-policy change — e.g. a newly supported
 * class of memory mutation with meaningfully different risk, a changed
 * online/offline or anti-cheat restriction, a materially changed scope of
 * what trainer actions can affect, or a materially changed acknowledgment
 * ask itself. Do NOT bump for wording/copy cleanup, visual redesign,
 * layout changes, localization, or an ordinary SOLITH app version change —
 * none of those are safety-behavior changes, and re-prompting for them
 * trains users to click through the dialog without reading it.
 */
export const SAFETY_POLICY_VERSION = 1;

export const SAFETY_REMINDER_INTERVAL_DAYS = 30;
const SAFETY_REMINDER_INTERVAL_MS = SAFETY_REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000;

export type SafetyAckState = 'ACK_REQUIRED' | 'REMINDER_DUE' | 'NO_ACTION';

/**
 * Raw, UNTRUSTED persisted values as read from settings — every field must
 * be validated before use. Never assume a stored value is well-formed:
 * settings storage round-trips through string serialization
 * (src/core/settings/index.ts), and this module must behave safely even if
 * the underlying row is missing, deleted, or hand-edited.
 */
export interface SafetyAckPersistedState {
  safetyAckPolicyVersion?: unknown;
  safetyAckAt?: unknown;
  safetyReminderDismissedAt?: unknown;
}

/** A valid version is a non-negative integer. Anything else (string, NaN, negative, float, missing) is invalid. */
function parseValidVersion(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isInteger(value) || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * A valid timestamp is an epoch-ms number (or an ISO string, since settings
 * values round-trip as strings) that parses to a finite, non-negative
 * instant that is not AFTER `nowMs`. A future timestamp is deliberately
 * treated as invalid/untrusted, not as "already acknowledged ahead of
 * time" — persisted state must never be trusted more than the clock it
 * claims to precede.
 */
function parseValidTimestamp(value: unknown, nowMs: number): number | null {
  let ms: number;
  if (typeof value === 'number') {
    ms = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    ms = Date.parse(value);
  } else {
    return null;
  }
  if (!Number.isFinite(ms) || ms < 0 || ms > nowMs) return null;
  return ms;
}

/**
 * Deterministic policy evaluation. Pure function of (persisted state, now)
 * — no I/O, no Date.now() default in production call sites (callers pass
 * the current time explicitly so tests can inject fake time).
 *
 * Fail-closed rule: ANY malformed, missing, or unexpected value (including
 * a stored version that is HIGHER than the current SAFETY_POLICY_VERSION —
 * e.g. from a downgrade, or corrupted/hand-edited settings) results in
 * ACK_REQUIRED. The worst-case UX outcome of any bad persisted state is
 * "the acknowledgment dialog appears again" — never a silent bypass.
 */
export function evaluateSafetyAckState(persisted: SafetyAckPersistedState, nowMs: number): SafetyAckState {
  const storedVersion = parseValidVersion(persisted.safetyAckPolicyVersion);
  const ackAtMs = parseValidTimestamp(persisted.safetyAckAt, nowMs);

  if (storedVersion === null || storedVersion !== SAFETY_POLICY_VERSION || ackAtMs === null) {
    return 'ACK_REQUIRED';
  }

  const dismissedAtMs = parseValidTimestamp(persisted.safetyReminderDismissedAt, nowMs);
  const mostRecentMs = dismissedAtMs !== null ? Math.max(ackAtMs, dismissedAtMs) : ackAtMs;

  return nowMs - mostRecentMs >= SAFETY_REMINDER_INTERVAL_MS ? 'REMINDER_DUE' : 'NO_ACTION';
}
