/**
 * Cheat toggle persistence — trainer migration checkpoint coverage.
 *
 * Covers the gap left by the 806ba56 migration (removal of PalworldCheatMenu /
 * LiveTrainer / useFreezeValue / useLiveTrainerWorkflow in favor of the generic
 * GameSpecificCheatMenu + cheat-toggle-store persistence chain):
 *
 *  - cheat-toggle-store: set/get/clear against the real cheat_toggle_state table
 *  - scoping: state is keyed by (gameId, cheatId) — one game/cheat pair never
 *    leaks into or clobbers another
 *  - clear removes only the targeted row, not sibling rows
 *  - IPC validation: CheatToggleGetAll/Set/ClearSchema accept valid payloads
 *    and reject malformed ones before they reach the store
 *  - no remaining source file imports the components deleted in that migration
 */

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import db, { initDatabase } from '../src/core/database/index.ts';
import {
  getPersistedCheatStates,
  setPersistedCheatState,
  clearPersistedCheatState,
} from '../src/core/cheat-system/cheat-toggle-store.ts';
import {
  CheatToggleGetAllSchema,
  CheatToggleSetSchema,
  CheatToggleClearSchema,
} from '../electron/ipc-validation.ts';

describe('cheat-toggle-store — persistence', () => {
  before(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    // cheat_toggle_state has no game/cheat foreign keys to clean up via cascade,
    // so tests use unique gameId/cheatId per test rather than truncating the table.
  });

  test('set then get round-trips enabled, confirmedAddress, and dataType', () => {
    const gameId = 'test-palworld';
    const cheatId = 'infinite-health';

    setPersistedCheatState(gameId, cheatId, {
      enabled: true,
      confirmedAddress: '0x1A2B3C',
      dataType: 'float',
    });

    const states = getPersistedCheatStates(gameId);
    const row = states.find((s) => s.cheatId === cheatId);
    assert.ok(row, 'row was persisted');
    assert.equal(row!.gameId, gameId);
    assert.equal(row!.enabled, true);
    assert.equal(row!.confirmedAddress, '0x1A2B3C');
    assert.equal(row!.dataType, 'float');
  });

  test('set with enabled:false and null address/dataType persists nulls, not the string "null"', () => {
    const gameId = 'test-undisputed';
    const cheatId = 'unlimited-ammo';

    setPersistedCheatState(gameId, cheatId, {
      enabled: false,
      confirmedAddress: null,
      dataType: null,
    });

    const row = getPersistedCheatStates(gameId).find((s) => s.cheatId === cheatId);
    assert.ok(row);
    assert.equal(row!.enabled, false);
    assert.equal(row!.confirmedAddress, null);
    assert.equal(row!.dataType, null);
  });

  test('omitting confirmedAddress/dataType defaults to null rather than throwing', () => {
    const gameId = 'test-dredge';
    const cheatId = 'unlimited-crafting-resources';

    setPersistedCheatState(gameId, cheatId, { enabled: true });

    const row = getPersistedCheatStates(gameId).find((s) => s.cheatId === cheatId);
    assert.ok(row);
    assert.equal(row!.enabled, true);
    assert.equal(row!.confirmedAddress, null);
    assert.equal(row!.dataType, null);
  });

  test('re-setting the same gameId/cheatId updates in place (upsert), not a duplicate row', () => {
    const gameId = 'test-avowed';
    const cheatId = 'infinite-stamina';

    setPersistedCheatState(gameId, cheatId, { enabled: true, confirmedAddress: '0x100', dataType: 'int32' });
    setPersistedCheatState(gameId, cheatId, { enabled: false, confirmedAddress: '0x200', dataType: 'int64' });

    const rows = getPersistedCheatStates(gameId).filter((s) => s.cheatId === cheatId);
    assert.equal(rows.length, 1, 'upsert keeps exactly one row per (gameId, cheatId)');
    assert.equal(rows[0].enabled, false);
    assert.equal(rows[0].confirmedAddress, '0x200');
    assert.equal(rows[0].dataType, 'int64');
  });

  test('state is scoped by gameId — same cheatId under a different game does not collide', () => {
    const cheatId = 'gold';
    setPersistedCheatState('test-game-a', cheatId, { enabled: true, confirmedAddress: '0xAAA', dataType: 'int32' });
    setPersistedCheatState('test-game-b', cheatId, { enabled: false, confirmedAddress: '0xBBB', dataType: 'int32' });

    const a = getPersistedCheatStates('test-game-a').find((s) => s.cheatId === cheatId);
    const b = getPersistedCheatStates('test-game-b').find((s) => s.cheatId === cheatId);

    assert.ok(a && b);
    assert.equal(a!.enabled, true);
    assert.equal(a!.confirmedAddress, '0xAAA');
    assert.equal(b!.enabled, false);
    assert.equal(b!.confirmedAddress, '0xBBB');
  });

  test('getPersistedCheatStates only returns rows for the requested gameId', () => {
    setPersistedCheatState('test-scope-x', 'cheat-1', { enabled: true });
    setPersistedCheatState('test-scope-y', 'cheat-1', { enabled: true });
    setPersistedCheatState('test-scope-y', 'cheat-2', { enabled: true });

    const xStates = getPersistedCheatStates('test-scope-x');
    const yStates = getPersistedCheatStates('test-scope-y');

    assert.equal(xStates.length, 1);
    assert.equal(yStates.length, 2);
    assert.ok(xStates.every((s) => s.gameId === 'test-scope-x'));
    assert.ok(yStates.every((s) => s.gameId === 'test-scope-y'));
  });

  test('clear removes only the targeted (gameId, cheatId) row, leaving sibling cheats intact', () => {
    const gameId = 'test-crimson-desert';
    setPersistedCheatState(gameId, 'cheat-keep-1', { enabled: true });
    setPersistedCheatState(gameId, 'cheat-remove', { enabled: true });
    setPersistedCheatState(gameId, 'cheat-keep-2', { enabled: true });

    clearPersistedCheatState(gameId, 'cheat-remove');

    const remaining = getPersistedCheatStates(gameId).map((s) => s.cheatId).sort();
    assert.deepEqual(remaining, ['cheat-keep-1', 'cheat-keep-2']);
  });

  test('clear does not affect the same cheatId under a different gameId', () => {
    const cheatId = 'shared-cheat-id';
    setPersistedCheatState('test-clear-scope-a', cheatId, { enabled: true });
    setPersistedCheatState('test-clear-scope-b', cheatId, { enabled: true });

    clearPersistedCheatState('test-clear-scope-a', cheatId);

    assert.equal(getPersistedCheatStates('test-clear-scope-a').length, 0);
    assert.equal(getPersistedCheatStates('test-clear-scope-b').length, 1);
  });

  test('clear on a never-set (gameId, cheatId) pair is a safe no-op', () => {
    assert.doesNotThrow(() => clearPersistedCheatState('test-never-set', 'never-set-cheat'));
    assert.equal(getPersistedCheatStates('test-never-set').length, 0);
  });

  test('getPersistedCheatStates for an unknown gameId returns an empty array, not an error', () => {
    const states = getPersistedCheatStates('test-totally-unknown-game');
    assert.deepEqual(states, []);
  });
});

describe('cheat-toggle IPC validation schemas', () => {
  test('CheatToggleGetAllSchema accepts a valid gameId', () => {
    const parsed = CheatToggleGetAllSchema.parse({ gameId: 'palworld' });
    assert.equal(parsed.gameId, 'palworld');
  });

  test('CheatToggleGetAllSchema rejects an empty gameId', () => {
    assert.throws(() => CheatToggleGetAllSchema.parse({ gameId: '' }));
  });

  test('CheatToggleGetAllSchema rejects a missing gameId', () => {
    assert.throws(() => CheatToggleGetAllSchema.parse({}));
  });

  test('CheatToggleSetSchema accepts a full valid payload', () => {
    const parsed = CheatToggleSetSchema.parse({
      gameId: 'palworld',
      cheatId: 'infinite-health',
      enabled: true,
      confirmedAddress: '0x1A2B3C',
      dataType: 'float',
    });
    assert.equal(parsed.enabled, true);
  });

  test('CheatToggleSetSchema accepts a minimal payload (address/dataType omitted)', () => {
    const parsed = CheatToggleSetSchema.parse({
      gameId: 'palworld',
      cheatId: 'infinite-health',
      enabled: false,
    });
    assert.equal(parsed.enabled, false);
    assert.equal(parsed.confirmedAddress, undefined);
  });

  test('CheatToggleSetSchema rejects a malformed address (not decimal or 0x-hex)', () => {
    assert.throws(() =>
      CheatToggleSetSchema.parse({
        gameId: 'palworld',
        cheatId: 'infinite-health',
        enabled: true,
        confirmedAddress: 'not-an-address',
        dataType: 'float',
      }),
    );
  });

  test('CheatToggleSetSchema rejects an invalid dataType', () => {
    assert.throws(() =>
      CheatToggleSetSchema.parse({
        gameId: 'palworld',
        cheatId: 'infinite-health',
        enabled: true,
        dataType: 'not-a-real-type',
      }),
    );
  });

  test('CheatToggleSetSchema rejects a non-boolean enabled', () => {
    assert.throws(() =>
      CheatToggleSetSchema.parse({ gameId: 'palworld', cheatId: 'infinite-health', enabled: 'yes' }),
    );
  });

  test('CheatToggleClearSchema accepts a valid gameId/cheatId pair', () => {
    const parsed = CheatToggleClearSchema.parse({ gameId: 'palworld', cheatId: 'infinite-health' });
    assert.equal(parsed.cheatId, 'infinite-health');
  });

  test('CheatToggleClearSchema rejects a missing cheatId', () => {
    assert.throws(() => CheatToggleClearSchema.parse({ gameId: 'palworld' }));
  });
});

describe('trainer migration checkpoint — no dangling references to deleted files', () => {
  const DELETED_SYMBOLS = [
    { name: 'LiveTrainer component', pattern: /\bLiveTrainer\b(?!Control)/ },
    { name: 'PalworldCheatMenu', pattern: /\bPalworldCheatMenu\b/ },
    { name: 'PalworldTrainerPage', pattern: /\bPalworldTrainerPage\b/ },
    { name: 'useFreezeValue', pattern: /\buseFreezeValue\b/ },
    { name: 'useLiveTrainerWorkflow', pattern: /\buseLiveTrainerWorkflow\b/ },
  ];

  const SCAN_ROOTS = ['src', 'electron'];
  const SCAN_EXTENSIONS = new Set(['.ts', '.tsx']);

  function listSourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...listSourceFiles(full));
      } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
        out.push(full);
      }
    }
    return out;
  }

  const repoRoot = path.resolve(import.meta.dirname, '..');
  const files = SCAN_ROOTS.flatMap((root) => listSourceFiles(path.join(repoRoot, root)));

  test('scan covers a non-trivial number of source files (sanity check on the scan itself)', () => {
    assert.ok(files.length > 20, `expected to scan more than 20 files, found ${files.length}`);
  });

  for (const { name, pattern } of DELETED_SYMBOLS) {
    test(`no src/ or electron/ file references ${name}`, () => {
      const offenders = files.filter((f) => pattern.test(fs.readFileSync(f, 'utf8')));
      assert.deepEqual(
        offenders.map((f) => path.relative(repoRoot, f)),
        [],
        `${name} should have no remaining references after the migration`,
      );
    });
  }

  const DELETED_FILES = [
    'src/app/components/LiveTrainer.tsx',
    'src/app/components/LiveTrainer.module.css',
    'src/app/components/LiveTrainer.test.tsx',
    'src/app/components/PalworldCheatMenu.tsx',
    'src/app/components/PalworldCheatMenu.module.css',
    'src/app/components/PalworldCheatMenu.test.tsx',
    'src/app/pages/PalworldTrainerPage.tsx',
    'src/app/pages/PalworldTrainerPage.module.css',
    'src/app/hooks/useFreezeValue.ts',
    'src/app/hooks/useLiveTrainerWorkflow.ts',
  ];

  test('deleted migration files do not exist on disk', () => {
    const stillPresent = DELETED_FILES.filter((f) => fs.existsSync(path.join(repoRoot, f)));
    assert.deepEqual(stillPresent, [], 'deleted files should not have been restored');
  });
});
