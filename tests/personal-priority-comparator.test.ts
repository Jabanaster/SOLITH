import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  comparePersonalLibraryPriority,
  personalPriorityTierFor,
  sortByPersonalLibraryPriority,
  PERSONAL_PRIORITY_TIER_ORDER,
  type PersonalPriorityEvidence,
} from '../src/core/trainer-catalog/personal-priority-comparator.js';

function game(overrides: Partial<PersonalPriorityEvidence> & { title: string }): PersonalPriorityEvidence {
  return {
    running: false,
    installed: false,
    owned: 'unknown',
    favorite: false,
    recentlyDetected: false,
    trainerAccuracy: 'NONE',
    canonicalConfidence: 'UNKNOWN',
    trainerAvailability: 'NONE',
    ...overrides,
  };
}

describe('personalPriorityTierFor — one tier per game, deterministic', () => {
  test('running always wins regardless of other flags', () => {
    const g = game({ title: 'A', running: true, installed: false, owned: false, favorite: false });
    assert.equal(personalPriorityTierFor(g), 'RUNNING');
  });

  test('installed wins over confirmed-owned when both true', () => {
    const g = game({ title: 'A', installed: true, owned: true });
    assert.equal(personalPriorityTierFor(g), 'INSTALLED');
  });

  test('confirmed-owned (owned === true) -> CONFIRMED_OWNED', () => {
    const g = game({ title: 'A', owned: true });
    assert.equal(personalPriorityTierFor(g), 'CONFIRMED_OWNED');
  });

  test('owned === "unknown" is NOT confirmed-owned', () => {
    const g = game({ title: 'A', owned: 'unknown' });
    assert.notEqual(personalPriorityTierFor(g), 'CONFIRMED_OWNED');
  });

  test('owned === false is NOT confirmed-owned', () => {
    const g = game({ title: 'A', owned: false });
    assert.notEqual(personalPriorityTierFor(g), 'CONFIRMED_OWNED');
  });

  test('favorite alone (not owned/installed/running) -> FAVORITE_OR_RECENT', () => {
    const g = game({ title: 'A', favorite: true });
    assert.equal(personalPriorityTierFor(g), 'FAVORITE_OR_RECENT');
  });

  test('recentlyDetected alone -> FAVORITE_OR_RECENT', () => {
    const g = game({ title: 'A', recentlyDetected: true });
    assert.equal(personalPriorityTierFor(g), 'FAVORITE_OR_RECENT');
  });

  test('nothing at all -> UNOWNED_CATALOG', () => {
    const g = game({ title: 'A' });
    assert.equal(personalPriorityTierFor(g), 'UNOWNED_CATALOG');
  });
});

describe('comparePersonalLibraryPriority — the hard guarantee', () => {
  test('an unowned catalog game with a stronger trainer can NEVER outrank an installed game', () => {
    const unownedButStrongTrainer = game({
      title: 'Zzz Amazing Trainer Game',
      installed: false,
      owned: 'unknown',
      favorite: false,
      recentlyDetected: false,
      trainerAccuracy: 'LOCALLY_VERIFIED',
      canonicalConfidence: 'EXACT',
      trainerAvailability: 'LOCAL',
    });
    const installedWeakTrainer = game({
      title: 'Aaa Weak Trainer Game',
      installed: true,
      owned: 'unknown',
      trainerAccuracy: 'NONE',
      canonicalConfidence: 'UNKNOWN',
      trainerAvailability: 'NONE',
    });

    // Even though the unowned game's title would sort first alphabetically,
    // and every sub-priority signal favors it, it must still rank AFTER the
    // installed game.
    const result = comparePersonalLibraryPriority(unownedButStrongTrainer, installedWeakTrainer);
    assert.ok(result > 0, 'unowned strong-trainer game must sort AFTER installed weak-trainer game');

    const sorted = sortByPersonalLibraryPriority([unownedButStrongTrainer, installedWeakTrainer]);
    assert.equal(sorted[0].title, 'Aaa Weak Trainer Game');
    assert.equal(sorted[1].title, 'Zzz Amazing Trainer Game');
  });

  test('a confirmed-owned game with a stronger trainer can never outrank an installed game', () => {
    const ownedStrong = game({
      title: 'Owned Strong',
      owned: true,
      trainerAccuracy: 'LOCALLY_VERIFIED',
      canonicalConfidence: 'EXACT',
      trainerAvailability: 'LOCAL',
    });
    const installedWeak = game({ title: 'Installed Weak', installed: true });
    const sorted = sortByPersonalLibraryPriority([ownedStrong, installedWeak]);
    assert.equal(sorted[0].title, 'Installed Weak');
  });

  test('within the same tier, trainerAccuracy is the first tiebreak', () => {
    const strongAccuracy = game({ title: 'B', installed: true, trainerAccuracy: 'EXACT_VERSION_MATCH' });
    const weakAccuracy = game({ title: 'A', installed: true, trainerAccuracy: 'VERSION_UNKNOWN' });
    const sorted = sortByPersonalLibraryPriority([weakAccuracy, strongAccuracy]);
    assert.equal(sorted[0].title, 'B');
  });

  test('within the same tier and accuracy, canonicalConfidence is the second tiebreak', () => {
    const highConfidence = game({ title: 'B', installed: true, trainerAccuracy: 'STRONG_MATCH', canonicalConfidence: 'HIGH' });
    const lowConfidence = game({ title: 'A', installed: true, trainerAccuracy: 'STRONG_MATCH', canonicalConfidence: 'POSSIBLE' });
    const sorted = sortByPersonalLibraryPriority([lowConfidence, highConfidence]);
    assert.equal(sorted[0].title, 'B');
  });

  test('within the same tier/accuracy/confidence, trainerAvailability is the third tiebreak', () => {
    const local = game({
      title: 'B',
      installed: true,
      trainerAccuracy: 'STRONG_MATCH',
      canonicalConfidence: 'HIGH',
      trainerAvailability: 'LOCAL',
    });
    const community = game({
      title: 'A',
      installed: true,
      trainerAccuracy: 'STRONG_MATCH',
      canonicalConfidence: 'HIGH',
      trainerAvailability: 'COMMUNITY',
    });
    const sorted = sortByPersonalLibraryPriority([community, local]);
    assert.equal(sorted[0].title, 'B');
  });

  test('fully identical evidence falls back to alphabetical title, case-insensitive', () => {
    const b = game({ title: 'banana' });
    const a = game({ title: 'Apple' });
    const sorted = sortByPersonalLibraryPriority([b, a]);
    assert.equal(sorted[0].title, 'Apple');
    assert.equal(sorted[1].title, 'banana');
  });

  test('full tier ordering end to end matches PERSONAL_PRIORITY_TIER_ORDER', () => {
    const running = game({ title: 'Running Game', running: true });
    const installed = game({ title: 'Installed Game', installed: true });
    const owned = game({ title: 'Owned Game', owned: true });
    const favorite = game({ title: 'Favorite Game', favorite: true });
    const other = game({ title: 'Other Game' });

    const shuffled = [other, favorite, owned, installed, running];
    const sorted = sortByPersonalLibraryPriority(shuffled);
    assert.deepEqual(
      sorted.map((g) => personalPriorityTierFor(g)),
      PERSONAL_PRIORITY_TIER_ORDER,
    );
  });

  test('comparator never mutates its input array', () => {
    const list = [game({ title: 'Z' }), game({ title: 'A' })];
    const snapshot = list.map((g) => g.title);
    sortByPersonalLibraryPriority(list);
    assert.deepEqual(list.map((g) => g.title), snapshot);
  });

  test('comparator is stable/deterministic across repeated calls on the same input', () => {
    const list = [
      game({ title: 'Same', installed: true }),
      game({ title: 'Same', installed: true }),
    ];
    const first = sortByPersonalLibraryPriority(list).map((g) => g.title);
    const second = sortByPersonalLibraryPriority(list).map((g) => g.title);
    assert.deepEqual(first, second);
  });
});
