import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  deriveRunningGameState,
  EMPTY_RUNNING_STATE,
  toRunningGameCardData,
  type RunningGameState,
} from '../src/app/hooks/personal-library-running-snapshot.ts';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');

describe('personal-library-running-snapshot — pure reducer used by usePersonalLibraryGames.ts', () => {
  test('toRunningGameCardData maps a bare detection into a running GameCardData with an honest NONE floor', () => {
    const card = toRunningGameCardData({ catalogGameId: 'game-a', displayName: 'Game A' });
    assert.equal(card.gameId, 'game-a');
    assert.equal(card.title, 'Game A');
    assert.equal(card.running, true);
    assert.equal(card.owned, 'unknown');
    assert.equal(card.favorite, false);
    assert.equal(card.trainerAvailability, 'NONE');
    assert.equal(card.trainerAccuracy, 'NONE');
  });

  // Behavior 1: SOLITH starts while a game is already running (fixture
  // snapshot response) -> sidebar Running state is populated immediately on
  // mount, without waiting for an event. The hook feeds the snapshot IPC's
  // `detection` straight into this reducer on mount.
  test('behavior 1 — a non-null snapshot detection populates running state immediately', () => {
    const snapshotDetection = { catalogGameId: 'game-already-running', displayName: 'Already Running Game' };
    const next = deriveRunningGameState(snapshotDetection, EMPTY_RUNNING_STATE);
    assert.equal(next.runningCatalogGameId, 'game-already-running');
    assert.ok(next.runningGame);
    assert.equal(next.runningGame?.gameId, 'game-already-running');
    assert.equal(next.runningGame?.running, true);
  });

  // Behavior 2: no process running at mount (fixture returns null/empty) ->
  // sidebar starts empty, exactly as before.
  test('behavior 2 — a null snapshot detection leaves running state empty', () => {
    const next = deriveRunningGameState(null, EMPTY_RUNNING_STATE);
    assert.deepEqual(next, EMPTY_RUNNING_STATE);
    assert.equal(next.runningCatalogGameId, null);
    assert.equal(next.runningGame, null);
  });

  test('behavior 2b — an undefined snapshot detection also leaves running state empty', () => {
    const next = deriveRunningGameState(undefined, EMPTY_RUNNING_STATE);
    assert.deepEqual(next, EMPTY_RUNNING_STATE);
  });

  // Behavior 3: game exits after mount (a subsequent onCatalogProcessDetected
  // event reports null) -> sidebar clears it.
  test('behavior 3 — a live event reporting null clears a previously-populated running state', () => {
    const populated: RunningGameState = deriveRunningGameState(
      { catalogGameId: 'game-x', displayName: 'Game X' },
      EMPTY_RUNNING_STATE,
    );
    assert.ok(populated.runningGame, 'precondition: running state must be populated before it can be cleared');

    const cleared = deriveRunningGameState(null, populated);
    assert.equal(cleared.runningCatalogGameId, null);
    assert.equal(cleared.runningGame, null);
  });

  // Behavior 4: game restarts with a new PID (event reports a new detection)
  // -> sidebar updates to the new one.
  test('behavior 4 — a live event reporting a different game updates running state to the new one', () => {
    const first = deriveRunningGameState({ catalogGameId: 'game-old', displayName: 'Old Game' }, EMPTY_RUNNING_STATE);
    const second = deriveRunningGameState({ catalogGameId: 'game-new', displayName: 'New Game' }, first);

    assert.equal(second.runningCatalogGameId, 'game-new');
    assert.equal(second.runningGame?.gameId, 'game-new');
    assert.equal(second.runningGame?.title, 'New Game');
  });

  test('a detection missing catalogGameId is treated the same as no detection (clears state)', () => {
    // Defensive: a malformed/half-populated payload should never leave a
    // stale or broken card behind.
    const next = deriveRunningGameState({ catalogGameId: '', displayName: 'Broken' }, EMPTY_RUNNING_STATE);
    assert.deepEqual(next, EMPTY_RUNNING_STATE);
  });

  test('re-detecting the SAME running game preserves its favorite flag across updates', () => {
    const first = deriveRunningGameState({ catalogGameId: 'game-fav', displayName: 'Fav Game' }, EMPTY_RUNNING_STATE);
    const withFavorite: RunningGameState = {
      ...first,
      runningGame: first.runningGame ? { ...first.runningGame, favorite: true } : null,
    };
    const reDetected = deriveRunningGameState({ catalogGameId: 'game-fav', displayName: 'Fav Game' }, withFavorite);
    assert.equal(reDetected.runningGame?.favorite, true);
  });
});

describe('usePersonalLibraryGames.ts — wires the mount-time snapshot before the live event subscription', () => {
  const HOOK_SOURCE = fs.readFileSync(path.join(ROOT, 'src/app/hooks/usePersonalLibraryGames.ts'), 'utf8');

  test('the hook calls getCurrentDetectedProcess() on mount', () => {
    assert.match(HOOK_SOURCE, /api\.getCurrentDetectedProcess\(\)/);
  });

  test('the mount-time snapshot effect is declared textually before the onCatalogProcessDetected subscription effect', () => {
    const snapshotIndex = HOOK_SOURCE.indexOf('api.getCurrentDetectedProcess()');
    const eventIndex = HOOK_SOURCE.indexOf('api?.onCatalogProcessDetected?.(');
    assert.ok(snapshotIndex >= 0, 'snapshot call not found');
    assert.ok(eventIndex >= 0, 'event subscription not found');
    assert.ok(snapshotIndex < eventIndex, 'snapshot effect must be declared before the event subscription effect');
  });

  test('both the snapshot effect and the event effect route through the shared deriveRunningGameState reducer (no duplicated mapping logic)', () => {
    const matches = [...HOOK_SOURCE.matchAll(/deriveRunningGameState\(/g)];
    assert.equal(matches.length, 2, 'expected exactly two call sites: the mount snapshot and the live event handler');
  });

  test('imports the reducer from the pure, React-free snapshot module', () => {
    assert.match(
      HOOK_SOURCE,
      /import \{\s*deriveRunningGameState,\s*EMPTY_RUNNING_STATE,[\s\S]*?\} from '\.\/personal-library-running-snapshot\.js';/,
    );
  });
});

describe('electron/preload.ts — exposes the new read-only IPC channel', () => {
  const PRELOAD_SOURCE = fs.readFileSync(path.join(ROOT, 'electron/preload.ts'), 'utf8');

  test('getCurrentDetectedProcess is bridged to the get-current-detected-process channel', () => {
    assert.match(
      PRELOAD_SOURCE,
      /getCurrentDetectedProcess: \(\) => ipcRenderer\.invoke\('get-current-detected-process'\),/,
    );
  });
});

describe('electron/main.ts — registers get-current-detected-process with the handleGuarded pattern', () => {
  const MAIN_SOURCE = fs.readFileSync(path.join(ROOT, 'electron/main.ts'), 'utf8');

  test('the channel is registered via handleGuarded, matching the pattern used by other simple read-only queries', () => {
    assert.match(MAIN_SOURCE, /handleGuarded\('get-current-detected-process', async \(\) => \{/);
  });

  test('the handler returns the existing catalog-process-watch.ts snapshot, and creates no new watcher', () => {
    const match = MAIN_SOURCE.match(
      /handleGuarded\('get-current-detected-process', async \(\) => \{[\s\S]*?\}\);/,
    );
    assert.ok(match, 'handler body not found');
    assert.match(match![0], /getLastProcessDetection\(\)/);
    assert.doesNotMatch(match![0], /startCatalogProcessWatch/);
  });

  test('main.ts imports getLastProcessDetection from the existing catalog-process-watch module (no new watcher module)', () => {
    assert.match(
      MAIN_SOURCE,
      /import \{ startCatalogProcessWatch, getLastProcessDetection \} from '\.\/catalog-process-watch\.js';/,
    );
  });
});
