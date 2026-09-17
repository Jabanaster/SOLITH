import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { matchAllCatalogProcesses } from '../../src/core/live-memory/process-watcher.js';
import type { CatalogExecutableEntry } from '../../src/core/live-memory/process-watcher.js';

// Regression coverage for D-P3-8.1 (Phase 3): a catalog entry whose declared
// executables include both a launcher/wrapper stub and the real engine
// binary used to bind whichever one happened to appear first in the live OS
// process-list snapshot — not necessarily the engine — because
// matchAllCatalogProcesses stopped at the first live hit per game. It now
// collects every live match per game and prefers a recognized
// engine/build-suffixed binary (executable-role.ts's ENGINE_BUILD_SUFFIX_RE)
// over an unsuffixed sibling, falling back to the original first-live-match
// behavior when role evidence cannot distinguish them.

const ATOMFALL: CatalogExecutableEntry = {
  catalogGameId: 'atomfall',
  displayName: 'Atomfall',
  executables: ['Atomfall.exe', 'Atomfall_dx12.exe'],
};

const PALWORLD: CatalogExecutableEntry = {
  catalogGameId: 'palworld',
  displayName: 'Palworld',
  executables: ['Palworld-Win64-Shipping.exe', 'Palworld.exe'],
};

const DREDGE: CatalogExecutableEntry = {
  catalogGameId: 'dredge',
  displayName: 'Dredge',
  executables: ['Dredge.exe'],
};

const STARFIELD: CatalogExecutableEntry = {
  catalogGameId: 'starfield',
  displayName: 'Starfield',
  executables: ['Starfield.exe'],
};

function proc(pid: number, name: string) {
  return { pid, name };
}

describe('matchAllCatalogProcesses — launcher/engine role tie-break', () => {
  test('Xbox package with launcher + engine alive: selects the engine binary', () => {
    const result = matchAllCatalogProcesses(
      [proc(1000, 'Atomfall.exe'), proc(1005, 'Atomfall_dx12.exe')],
      [ATOMFALL],
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].catalogGameId, 'atomfall');
    assert.equal(result[0].executable, 'Atomfall_dx12.exe');
    assert.equal(result[0].pid, 1005);
  });

  test('engine executable preference holds regardless of live process-list order', () => {
    const engineFirst = matchAllCatalogProcesses(
      [proc(2005, 'Atomfall_dx12.exe'), proc(2000, 'Atomfall.exe')],
      [ATOMFALL],
    );
    assert.equal(engineFirst[0].executable, 'Atomfall_dx12.exe');

    const launcherFirst = matchAllCatalogProcesses(
      [proc(3000, 'Atomfall.exe'), proc(3005, 'Atomfall_dx12.exe')],
      [ATOMFALL],
    );
    assert.equal(launcherFirst[0].executable, 'Atomfall_dx12.exe');
  });

  test('launcher-only startup state: before the engine spawns, the launcher itself is detected', () => {
    const result = matchAllCatalogProcesses([proc(4000, 'Atomfall.exe')], [ATOMFALL]);
    assert.equal(result.length, 1);
    assert.equal(result[0].executable, 'Atomfall.exe');
    assert.equal(result[0].pid, 4000);
  });

  test('engine appears after launcher (next poll): detection upgrades from launcher to engine', () => {
    const firstPoll = matchAllCatalogProcesses([proc(5000, 'Atomfall.exe')], [ATOMFALL]);
    assert.equal(firstPoll[0].executable, 'Atomfall.exe');

    const secondPoll = matchAllCatalogProcesses(
      [proc(5000, 'Atomfall.exe'), proc(5010, 'Atomfall_dx12.exe')],
      [ATOMFALL],
    );
    assert.equal(secondPoll[0].executable, 'Atomfall_dx12.exe');
    assert.equal(secondPoll[0].pid, 5010);
  });

  test('engine exits, launcher remains: detection falls back to the launcher', () => {
    const bothAlive = matchAllCatalogProcesses(
      [proc(6000, 'Atomfall.exe'), proc(6010, 'Atomfall_dx12.exe')],
      [ATOMFALL],
    );
    assert.equal(bothAlive[0].executable, 'Atomfall_dx12.exe');

    const engineExited = matchAllCatalogProcesses([proc(6000, 'Atomfall.exe')], [ATOMFALL]);
    assert.equal(engineExited[0].executable, 'Atomfall.exe');
    assert.equal(engineExited[0].pid, 6000);
  });

  test('multiple engine-like candidates with no role evidence: falls back to the earliest live match', () => {
    const ambiguous: CatalogExecutableEntry = {
      catalogGameId: 'ambiguous-game',
      displayName: 'Ambiguous Game',
      executables: ['AmbiguousGame.exe', 'AmbiguousGame64.exe'],
    };
    const result = matchAllCatalogProcesses(
      [proc(7000, 'AmbiguousGame.exe'), proc(7010, 'AmbiguousGame64.exe')],
      [ambiguous],
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].executable, 'AmbiguousGame.exe');
    assert.equal(result[0].pid, 7000);
  });

  test('Palworld wrapper regression: wrapper + Shipping binary alive selects the Shipping binary', () => {
    const result = matchAllCatalogProcesses(
      [proc(8000, 'Palworld.exe'), proc(8010, 'Palworld-Win64-Shipping.exe')],
      [PALWORLD],
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].catalogGameId, 'palworld');
    assert.equal(result[0].executable, 'Palworld-Win64-Shipping.exe');
    assert.equal(result[0].pid, 8010);
  });

  test('Steam/GOG/Epic single-executable catalog entries are unaffected', () => {
    const result = matchAllCatalogProcesses(
      [proc(9000, 'Dredge.exe'), proc(9010, 'Starfield.exe')],
      [DREDGE, STARFIELD],
    );
    assert.equal(result.length, 2);
    assert.deepEqual(
      result.map((r) => r.catalogGameId).sort(),
      ['dredge', 'starfield'],
    );
  });
});
