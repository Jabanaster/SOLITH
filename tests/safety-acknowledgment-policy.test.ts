import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateSafetyAckState,
  SAFETY_POLICY_VERSION,
  SAFETY_REMINDER_INTERVAL_DAYS,
} from '../src/core/safety-acknowledgment/policy.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 30, 12, 0, 0); // fixed instant, never Date.now()

test('SAFETY_POLICY_VERSION is 1 and the reminder interval is 30 days', () => {
  assert.equal(SAFETY_POLICY_VERSION, 1);
  assert.equal(SAFETY_REMINDER_INTERVAL_DAYS, 30);
});

// ── Mission 4 — versioned re-ack ────────────────────────────────────────────

test('no stored version at all -> ACK_REQUIRED', () => {
  assert.equal(evaluateSafetyAckState({}, NOW), 'ACK_REQUIRED');
});

test('stored version 0, current 1 -> ACK_REQUIRED', () => {
  assert.equal(
    evaluateSafetyAckState({ safetyAckPolicyVersion: 0, safetyAckAt: NOW }, NOW),
    'ACK_REQUIRED',
  );
});

test('stored version 1, current 1, fresh ack -> NO_ACTION (not required)', () => {
  assert.equal(
    evaluateSafetyAckState({ safetyAckPolicyVersion: 1, safetyAckAt: NOW }, NOW),
    'NO_ACTION',
  );
});

test('a future stored version (e.g. downgraded app, corrupted settings) -> ACK_REQUIRED, never trusted as already-covered', () => {
  assert.equal(
    evaluateSafetyAckState({ safetyAckPolicyVersion: 2, safetyAckAt: NOW }, NOW),
    'ACK_REQUIRED',
  );
  assert.equal(
    evaluateSafetyAckState({ safetyAckPolicyVersion: 999, safetyAckAt: NOW }, NOW),
    'ACK_REQUIRED',
  );
});

test('malformed stored version values all fail safe to ACK_REQUIRED', () => {
  const malformedVersions: unknown[] = [null, undefined, '1', NaN, -1, 1.5, {}, [], true];
  for (const bad of malformedVersions) {
    assert.equal(
      evaluateSafetyAckState({ safetyAckPolicyVersion: bad, safetyAckAt: NOW }, NOW),
      'ACK_REQUIRED',
      `expected ACK_REQUIRED for malformed version ${JSON.stringify(bad)}`,
    );
  }
});

test('a valid version but missing/malformed safetyAckAt -> ACK_REQUIRED', () => {
  const malformedTimestamps: unknown[] = [undefined, null, 'not-a-date', NaN, -1, {}, [], true, ''];
  for (const bad of malformedTimestamps) {
    assert.equal(
      evaluateSafetyAckState({ safetyAckPolicyVersion: 1, safetyAckAt: bad }, NOW),
      'ACK_REQUIRED',
      `expected ACK_REQUIRED for malformed safetyAckAt ${JSON.stringify(bad)}`,
    );
  }
});

test('a future safetyAckAt (later than "now") is untrusted -> ACK_REQUIRED', () => {
  assert.equal(
    evaluateSafetyAckState({ safetyAckPolicyVersion: 1, safetyAckAt: NOW + DAY_MS }, NOW),
    'ACK_REQUIRED',
  );
});

test('safetyAckAt as an ISO string (settings round-trip format) is accepted', () => {
  assert.equal(
    evaluateSafetyAckState({ safetyAckPolicyVersion: 1, safetyAckAt: new Date(NOW).toISOString() }, NOW),
    'NO_ACTION',
  );
});

// ── Mission 5 — 30-day reminder boundaries ──────────────────────────────────

test('29 days since acknowledgment -> NO_ACTION (reminder not yet due)', () => {
  assert.equal(
    evaluateSafetyAckState({ safetyAckPolicyVersion: 1, safetyAckAt: NOW - 29 * DAY_MS }, NOW),
    'NO_ACTION',
  );
});

test('exactly 30 days since acknowledgment -> REMINDER_DUE', () => {
  assert.equal(
    evaluateSafetyAckState({ safetyAckPolicyVersion: 1, safetyAckAt: NOW - 30 * DAY_MS }, NOW),
    'REMINDER_DUE',
  );
});

test('31+ days since acknowledgment -> REMINDER_DUE', () => {
  assert.equal(
    evaluateSafetyAckState({ safetyAckPolicyVersion: 1, safetyAckAt: NOW - 31 * DAY_MS }, NOW),
    'REMINDER_DUE',
  );
  assert.equal(
    evaluateSafetyAckState({ safetyAckPolicyVersion: 1, safetyAckAt: NOW - 90 * DAY_MS }, NOW),
    'REMINDER_DUE',
  );
});

test('dismissing the reminder resets the clock — the most recent of ack/dismiss timestamps governs', () => {
  const ackAt = NOW - 40 * DAY_MS; // long past due on its own
  const dismissedAt = NOW - 5 * DAY_MS; // recent dismissal
  assert.equal(
    evaluateSafetyAckState({ safetyAckPolicyVersion: 1, safetyAckAt: ackAt, safetyReminderDismissedAt: dismissedAt }, NOW),
    'NO_ACTION',
  );
});

test('30 days after a dismissal (well past the original ack) -> REMINDER_DUE again', () => {
  const ackAt = NOW - 90 * DAY_MS;
  const dismissedAt = NOW - 30 * DAY_MS;
  assert.equal(
    evaluateSafetyAckState({ safetyAckPolicyVersion: 1, safetyAckAt: ackAt, safetyReminderDismissedAt: dismissedAt }, NOW),
    'REMINDER_DUE',
  );
});

test('a fresh re-acknowledgment (e.g. after a version bump) resets the reminder clock, ignoring a stale prior dismissal', () => {
  const staleDismissedAt = NOW - 200 * DAY_MS;
  const freshAckAt = NOW; // just re-acknowledged
  assert.equal(
    evaluateSafetyAckState({ safetyAckPolicyVersion: 1, safetyAckAt: freshAckAt, safetyReminderDismissedAt: staleDismissedAt }, NOW),
    'NO_ACTION',
  );
});

test('a malformed safetyReminderDismissedAt is ignored (falls back to safetyAckAt), not fatal', () => {
  assert.equal(
    evaluateSafetyAckState(
      { safetyAckPolicyVersion: 1, safetyAckAt: NOW - 5 * DAY_MS, safetyReminderDismissedAt: 'garbage' },
      NOW,
    ),
    'NO_ACTION',
  );
});

// ── Mission 8 — tamper / corrupted-state fail-closed tests ──────────────────

test('corrupted state object (unexpected extra shape) never throws and fails safe', () => {
  assert.doesNotThrow(() => {
    evaluateSafetyAckState({ safetyAckPolicyVersion: 'corrupt' as unknown, safetyAckAt: { foo: 'bar' } as unknown } as never, NOW);
  });
  const result = evaluateSafetyAckState(
    { safetyAckPolicyVersion: 'corrupt' as unknown, safetyAckAt: { foo: 'bar' } as unknown } as never,
    NOW,
  );
  assert.equal(result, 'ACK_REQUIRED');
});

test('completely empty persisted object never throws', () => {
  assert.doesNotThrow(() => evaluateSafetyAckState({}, NOW));
});
