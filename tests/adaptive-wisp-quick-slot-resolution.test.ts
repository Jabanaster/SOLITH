import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWispQuickSlotAction, isWispQuickSlot, WISP_QUICK_SLOT_COUNT } from '../src/core/adaptive-wisp/index.ts';
import type { BoundWispProfile } from '../src/core/adaptive-wisp/index.ts';

function boundProfile(actions: BoundWispProfile['actions']): BoundWispProfile {
  return { profileId: 'p1', gameId: 'game-alpha', source: 'builtin', sessionId: 's1', sessionGeneration: 1, groups: [], actions, diagnostics: [] };
}

describe('resolveWispQuickSlotAction — pure lookup against the already-bound profile (Sections 4-8)', () => {
  test('resolves the action whose slot matches', () => {
    const profile = boundProfile([
      { actionId: 'a-hp', entryId: 'hp', label: 'HP', controlType: 'freeze', slot: 1, availability: 'available' },
      { actionId: 'a-xp', entryId: 'xp', label: 'XP', controlType: 'set', slot: 2, availability: 'available' },
    ]);
    const action = resolveWispQuickSlotAction(profile, 2);
    assert.equal(action?.actionId, 'a-xp');
  });

  test('returns null for an empty slot', () => {
    const profile = boundProfile([{ actionId: 'a-hp', entryId: 'hp', label: 'HP', controlType: 'freeze', slot: 1, availability: 'available' }]);
    assert.equal(resolveWispQuickSlotAction(profile, 5), null);
  });

  test('does not fall back to a different slot when the requested one is empty', () => {
    const profile = boundProfile([{ actionId: 'a-hp', entryId: 'hp', label: 'HP', controlType: 'freeze', slot: 1, availability: 'available' }]);
    assert.equal(resolveWispQuickSlotAction(profile, 3), null, 'must never silently substitute another slot\'s action');
  });

  test('two actions never declare the same slot in a well-formed bound profile — the first match wins deterministically if they did', () => {
    const profile = boundProfile([
      { actionId: 'a-first', entryId: 'e1', label: 'First', controlType: 'toggle', slot: 1, availability: 'available' },
      { actionId: 'a-second', entryId: 'e2', label: 'Second', controlType: 'toggle', slot: 1, availability: 'available' },
    ]);
    assert.equal(resolveWispQuickSlotAction(profile, 1)?.actionId, 'a-first');
  });
});

describe('isWispQuickSlot', () => {
  test('accepts 1 through WISP_QUICK_SLOT_COUNT', () => {
    for (let i = 1; i <= WISP_QUICK_SLOT_COUNT; i += 1) assert.equal(isWispQuickSlot(i), true);
  });
  test('rejects 0, negative, non-integer, and out-of-range values', () => {
    assert.equal(isWispQuickSlot(0), false);
    assert.equal(isWispQuickSlot(-1), false);
    assert.equal(isWispQuickSlot(1.5), false);
    assert.equal(isWispQuickSlot(7), false);
  });
});
