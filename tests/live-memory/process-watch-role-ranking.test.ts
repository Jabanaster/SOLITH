import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { matchAllCatalogProcesses } from '../../src/core/live-memory/process-watcher.js';
import type { CatalogExecutableEntry } from '../../src/core/live-memory/process-watcher.js';
import type { LiveProcessListEntry } from '../../src/core/live-memory/native-memory-driver.js';

// Regression coverage for the real, evidenced Atomfall defect: a GDK/Xbox
// title ships a launcher/bootstrap binary (Launcher\Atomfall.exe) alongside
// the actual engine binary (bin\Atomfall_dx12.exe). When both are live at
// once, matchAllCatalogProcesses previously bound the session to whichever
// one the OS process snapshot happened to enumerate first — no awareness of
// which one is the real game process. This is a generic launcher-vs-engine
// candidate-ranking defect, not specific to Atomfall; the fixtures below
// name the real title only because it is the evidenced reproduction.

function proc(pid: number, name: string, executablePath?: string): LiveProcessListEntry {
  return { pid, name, executablePath };
}

const ATOMFALL_CATALOG: CatalogExecutableEntry[] = [
  {
    catalogGameId: 'atomfall',
    displayName: 'Atomfall',
    executables: ['Atomfall.exe', 'Atomfall_dx12.exe'],
  },
];

const LAUNCHER_PATH = 'Z:/XboxGames/Atomfall/Content/Launcher/Atomfall.exe';
const ENGINE_PATH = 'Z:/XboxGames/Atomfall/Content/bin/Atomfall_dx12.exe';

describe('matchAllCatalogProcesses — launcher-vs-engine candidate ranking', () => {
  test('the real engine process wins over the launcher when both are live, launcher-first process order', () => {
    const result = matchAllCatalogProcesses(
      [proc(111, 'Atomfall.exe', LAUNCHER_PATH), proc(222, 'Atomfall_dx12.exe', ENGINE_PATH)],
      ATOMFALL_CATALOG,
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].catalogGameId, 'atomfall');
    assert.equal(result[0].pid, 222, 'must bind the session to the real engine PID, not the launcher');
    assert.equal(result[0].executable, 'Atomfall_dx12.exe');
  });

  test('the real engine process wins over the launcher when both are live, engine-first process order (order-independence)', () => {
    const result = matchAllCatalogProcesses(
      [proc(222, 'Atomfall_dx12.exe', ENGINE_PATH), proc(111, 'Atomfall.exe', LAUNCHER_PATH)],
      ATOMFALL_CATALOG,
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].pid, 222, 'the winner must not depend on OS process-enumeration order');
    assert.equal(result[0].executable, 'Atomfall_dx12.exe');
  });

  test('launcher-only live (engine not yet started) still resolves a detection — existing fallback behavior preserved', () => {
    // Do not silently fail closed here: this is the ordinary "game is still
    // at the launcher screen" state, and the pre-existing Zero-Input design
    // already detects a game by any of its catalog-known executable names.
    // This test exists to prove the new ranking logic does not change that.
    const result = matchAllCatalogProcesses([proc(111, 'Atomfall.exe', LAUNCHER_PATH)], ATOMFALL_CATALOG);
    assert.equal(result.length, 1);
    assert.equal(result[0].pid, 111);
    assert.equal(result[0].executable, 'Atomfall.exe');
  });

  test('engine-only live resolves a detection for the engine PID', () => {
    const result = matchAllCatalogProcesses([proc(222, 'Atomfall_dx12.exe', ENGINE_PATH)], ATOMFALL_CATALOG);
    assert.equal(result.length, 1);
    assert.equal(result[0].pid, 222);
  });

  test('without executablePath (OS query unavailable), ranking falls back to first-found — a documented limitation, not a regression from pre-fix behavior', () => {
    // Same two live candidates as the first test, but with no `executablePath`
    // on either LiveProcessListEntry — this is the pre-existing possibility
    // documented on the type (native-memory-driver.ts: `executablePath?`).
    // With no path, neither basename alone matches any role pattern, so both
    // classify as bare GAME_CANDIDATEs and the result is order-dependent,
    // exactly as it was before this fix — the ranking fix can only help when
    // real path context is available.
    const result = matchAllCatalogProcesses([proc(111, 'Atomfall.exe'), proc(222, 'Atomfall_dx12.exe')], ATOMFALL_CATALOG);
    assert.equal(result.length, 1);
    assert.equal(result[0].pid, 111, 'documented fallback: first-found wins when no path context exists to rank by');
  });

  test('Palworld (no launcher/engine ambiguity) is unaffected by the ranking change', () => {
    const catalog: CatalogExecutableEntry[] = [
      { catalogGameId: 'palworld', displayName: 'Palworld', executables: ['Palworld-Win64-Shipping.exe'] },
    ];
    const result = matchAllCatalogProcesses(
      [proc(300, 'Palworld-Win64-Shipping.exe', 'C:/Games/Palworld/Pal/Binaries/Win64/Palworld-Win64-Shipping.exe')],
      catalog,
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].catalogGameId, 'palworld');
    assert.equal(result[0].pid, 300);
  });

  test('a generic (non-Atomfall) launcher+engine pair is also ranked correctly — proves this is not a title-specific hack', () => {
    const catalog: CatalogExecutableEntry[] = [
      { catalogGameId: 'generic-title', displayName: 'Generic Title', executables: ['GenericGame.exe', 'GenericGameEngine.exe'] },
    ];
    const result = matchAllCatalogProcesses(
      [
        proc(10, 'GenericGame.exe', 'C:/Games/GenericTitle/Launcher/GenericGame.exe'),
        proc(20, 'GenericGameEngine.exe', 'C:/Games/GenericTitle/bin/GenericGameEngine.exe'),
      ],
      catalog,
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].pid, 20, 'any game with a Launcher\\ folder + engine binary, not just Atomfall, must rank the engine first');
  });
});
