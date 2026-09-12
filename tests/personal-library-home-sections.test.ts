import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PersonalLibraryGame } from '../src/core/personal-library/model.ts';
import {
  selectRunningOrTopPriorityGame,
  selectMyGamesShelf,
  selectTrainersReadyShelf,
  selectLocallyVerifiedShelf,
  selectRecentlyDetectedShelf,
  selectNeedsReverifyShelf,
} from '../src/core/personal-library/home-sections.ts';

function makeGame(overrides: Partial<PersonalLibraryGame> & { gameId: string }): PersonalLibraryGame {
  return {
    gameId: overrides.gameId,
    title: overrides.title ?? overrides.gameId,
    running: overrides.running ?? false,
    installed: overrides.installed ?? false,
    owned: overrides.owned ?? 'unknown',
    favorite: overrides.favorite ?? false,
    recentlyDetected: overrides.recentlyDetected ?? false,
    launchers: overrides.launchers ?? [],
    installEvidence: overrides.installEvidence ?? [],
    ownershipEvidence: overrides.ownershipEvidence ?? [],
    canonicalConfidence: overrides.canonicalConfidence ?? 'UNKNOWN',
    trainerAvailability: overrides.trainerAvailability ?? 'NONE',
    trainerCount: overrides.trainerCount ?? 0,
    trainerAccuracy: overrides.trainerAccuracy ?? 'NONE',
    versionEvidence: overrides.versionEvidence ?? [],
  };
}

describe('personal-library home-sections selectors', () => {
  describe('empty input', () => {
    test('all selectors return empty/undefined for an empty game list', () => {
      assert.equal(selectRunningOrTopPriorityGame([]), undefined);
      assert.deepEqual(selectMyGamesShelf([], 10), []);
      assert.deepEqual(selectTrainersReadyShelf([], 10), []);
      assert.deepEqual(selectLocallyVerifiedShelf([], 10), []);
      assert.deepEqual(selectRecentlyDetectedShelf([], 10), []);
      assert.deepEqual(selectNeedsReverifyShelf([], 10), []);
    });
  });

  describe('selectRunningOrTopPriorityGame', () => {
    test('picks the running game over a higher-priority-but-not-running game', () => {
      const running = makeGame({ gameId: 'running-game', running: true, installed: false });
      const topPriorityNotRunning = makeGame({
        gameId: 'top-priority',
        running: false,
        installed: true,
        trainerAccuracy: 'LOCALLY_VERIFIED',
      });
      const result = selectRunningOrTopPriorityGame([topPriorityNotRunning, running]);
      assert.equal(result?.gameId, 'running-game');
    });

    test('with no running game, picks the highest personal-priority game', () => {
      const low = makeGame({ gameId: 'low', installed: false, owned: 'unknown' });
      const high = makeGame({ gameId: 'high', installed: true, trainerAccuracy: 'LOCALLY_VERIFIED' });
      const result = selectRunningOrTopPriorityGame([low, high]);
      assert.equal(result?.gameId, 'high');
    });

    test('returns undefined for an empty list, never a fabricated game', () => {
      assert.equal(selectRunningOrTopPriorityGame([]), undefined);
    });
  });

  describe('selectMyGamesShelf', () => {
    test('includes only installed games and respects the limit cap', () => {
      const games = [
        makeGame({ gameId: 'a', installed: true }),
        makeGame({ gameId: 'b', installed: false }),
        makeGame({ gameId: 'c', installed: true }),
        makeGame({ gameId: 'd', installed: true }),
      ];
      const result = selectMyGamesShelf(games, 2);
      assert.equal(result.length, 2);
      assert.ok(result.every((g) => g.installed));
      assert.ok(!result.some((g) => g.gameId === 'b'));
    });
  });

  describe('selectTrainersReadyShelf', () => {
    test('excludes games with trainerAvailability NONE and respects the limit', () => {
      const games = [
        makeGame({ gameId: 'no-trainer', trainerAvailability: 'NONE' }),
        makeGame({ gameId: 'community', trainerAvailability: 'COMMUNITY' }),
        makeGame({ gameId: 'verified', trainerAvailability: 'VERIFIED' }),
        makeGame({ gameId: 'local', trainerAvailability: 'LOCAL' }),
      ];
      const result = selectTrainersReadyShelf(games, 2);
      assert.equal(result.length, 2);
      assert.ok(!result.some((g) => g.gameId === 'no-trainer'));
    });

    test('returns empty array when no games have a usable trainer', () => {
      const games = [makeGame({ gameId: 'a', trainerAvailability: 'NONE' })];
      assert.deepEqual(selectTrainersReadyShelf(games, 10), []);
    });
  });

  describe('selectLocallyVerifiedShelf', () => {
    test('only includes games with trainerAccuracy exactly LOCALLY_VERIFIED', () => {
      const games = [
        makeGame({ gameId: 'none', trainerAccuracy: 'NONE' }),
        makeGame({ gameId: 'unknown-version', trainerAccuracy: 'VERSION_UNKNOWN' }),
        makeGame({ gameId: 'verified', trainerAccuracy: 'LOCALLY_VERIFIED' }),
        makeGame({ gameId: 'needs-reverify', trainerAccuracy: 'NEEDS_REVERIFY' }),
      ];
      const result = selectLocallyVerifiedShelf(games, 10);
      assert.equal(result.length, 1);
      assert.equal(result[0].gameId, 'verified');
    });

    test('respects the limit cap', () => {
      const games = [
        makeGame({ gameId: 'a', trainerAccuracy: 'LOCALLY_VERIFIED' }),
        makeGame({ gameId: 'b', trainerAccuracy: 'LOCALLY_VERIFIED' }),
        makeGame({ gameId: 'c', trainerAccuracy: 'LOCALLY_VERIFIED' }),
      ];
      assert.equal(selectLocallyVerifiedShelf(games, 2).length, 2);
    });

    test('a game with trainerAccuracy NONE never appears in this shelf', () => {
      const games = [makeGame({ gameId: 'none-game', trainerAccuracy: 'NONE' })];
      const result = selectLocallyVerifiedShelf(games, 10);
      assert.ok(!result.some((g) => g.gameId === 'none-game'));
    });
  });

  describe('selectRecentlyDetectedShelf', () => {
    test('only includes games with recentlyDetected true, respects limit', () => {
      const games = [
        makeGame({ gameId: 'old', recentlyDetected: false }),
        makeGame({ gameId: 'new1', recentlyDetected: true }),
        makeGame({ gameId: 'new2', recentlyDetected: true }),
      ];
      const result = selectRecentlyDetectedShelf(games, 1);
      assert.equal(result.length, 1);
      assert.ok(result[0].recentlyDetected);
    });

    test('returns empty array when no games were recently detected', () => {
      const games = [makeGame({ gameId: 'old', recentlyDetected: false })];
      assert.deepEqual(selectRecentlyDetectedShelf(games, 10), []);
    });
  });

  describe('selectNeedsReverifyShelf', () => {
    test('only includes games with trainerAccuracy exactly NEEDS_REVERIFY', () => {
      const games = [
        makeGame({ gameId: 'verified', trainerAccuracy: 'LOCALLY_VERIFIED' }),
        makeGame({ gameId: 'reverify1', trainerAccuracy: 'NEEDS_REVERIFY' }),
        makeGame({ gameId: 'reverify2', trainerAccuracy: 'NEEDS_REVERIFY' }),
        makeGame({ gameId: 'none', trainerAccuracy: 'NONE' }),
      ];
      const result = selectNeedsReverifyShelf(games, 10);
      assert.equal(result.length, 2);
      assert.ok(result.every((g) => g.trainerAccuracy === 'NEEDS_REVERIFY'));
    });

    test('respects the limit cap', () => {
      const games = [
        makeGame({ gameId: 'a', trainerAccuracy: 'NEEDS_REVERIFY' }),
        makeGame({ gameId: 'b', trainerAccuracy: 'NEEDS_REVERIFY' }),
      ];
      assert.equal(selectNeedsReverifyShelf(games, 1).length, 1);
    });
  });
});
