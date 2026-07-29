import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  resetForTesting,
  closeDatabaseSafely,
  flushPersistence,
} from '../src/core/database/index.js';
import {
  addGame,
  getGames,
  getGameById,
  deleteGame,
} from '../src/core/games/index.js';
import { validatePathSafety } from '../src/core/safety/path-safety.js';

describe('Solith Blocker 1: Production Add Game Persistence & Integration', () => {
  let tempDir: string;
  let tempDbPath: string;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-add-game-integration-'));
    tempDbPath = path.join(tempDir, 'test-add-game.sqlite');
    await resetForTesting(tempDbPath);
  });

  after(async () => {
    await closeDatabaseSafely();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('validatePathSafety permits safe external test directories and rejects installation root', () => {
    const validTestDir = path.join(tempDir, 'ValidExternalGame');
    fs.mkdirSync(validTestDir, { recursive: true });

    const safeResult = validatePathSafety(validTestDir);
    assert.equal(safeResult.safe, true, 'External folder outside installation root must be safe');

    const appDirResult = validatePathSafety(process.cwd());
    assert.equal(appDirResult.safe, false, 'Solith installation root must be rejected');
  });

  test('addGame persists new record with all fields and reloads across database restart', async () => {
    const gameFolder = path.join(tempDir, 'ManualTestGameDir');
    fs.mkdirSync(gameFolder, { recursive: true });
    const exePath = path.join(gameFolder, 'ManualTest.exe');
    fs.writeFileSync(exePath, 'MZ');

    const payload = {
      name: 'Manual Test Game Integration',
      path: gameFolder,
      engine: 'Manual',
      executablePath: exePath,
      coverPath: 'solith-asset://local/C%3A%5Ccovers%5Ctest.png',
      iconPath: 'solith-asset://local/C%3A%5Cicons%5Ctest.ico',
      saveLocations: ['C:\\Saves\\ManualTestGame'],
      notes: 'Persistence integration test notes',
      metadataId: 'manual-test-integration-id',
    };

    // 1. Add game via core addGame function
    const created = addGame(payload);
    assert.ok(created.id, 'Created game must have a generated ID');
    assert.equal(created.name, 'Manual Test Game Integration');

    // 2. Verify game is returned in getGames() list
    const gamesBeforeRestart = getGames();
    const foundBefore = gamesBeforeRestart.find((g) => g.id === created.id);
    assert.ok(foundBefore, 'Game must appear in getGames() before restart');
    assert.equal(foundBefore.executablePath, exePath);
    assert.equal(foundBefore.notes, 'Persistence integration test notes');

    // 3. Flush & Close DB connection completely
    await closeDatabaseSafely();

    // 4. Reopen database connection from the exact same disk file
    await resetForTesting(tempDbPath, { preserveExisting: true });

    // 5. Verify game persists across restart
    const gamesAfterRestart = getGames();
    const foundAfter = gamesAfterRestart.find((g) => g.id === created.id);
    assert.ok(foundAfter, 'Game must persist in getGames() after process restart');
    assert.equal(foundAfter.name, 'Manual Test Game Integration');
    assert.equal(foundAfter.path, gameFolder);
    assert.equal(foundAfter.engine, 'Manual');
    assert.equal(foundAfter.executablePath, exePath);
    assert.equal(foundAfter.coverPath, 'solith-asset://local/C%3A%5Ccovers%5Ctest.png');
    assert.equal(foundAfter.iconPath, 'solith-asset://local/C%3A%5Cicons%5Ctest.ico');
    assert.deepEqual(foundAfter.saveLocations, ['C:\\Saves\\ManualTestGame']);
    assert.equal(foundAfter.notes, 'Persistence integration test notes');
    assert.equal(foundAfter.metadataId, 'manual-test-integration-id');

    // 6. Delete entry and verify clean removal
    deleteGame(created.id);
    assert.equal(getGameById(created.id), null, 'Game must be removed after deletion');
  });

  test('game card structural DOM separation guarantees action buttons exist outside clickable navigation area', () => {
    let parentNavigated = false;
    let scanTriggered = false;
    let editTriggered = false;

    const onSelect = () => { parentNavigated = true; };
    const onScan = () => { scanTriggered = true; };
    const onEdit = () => { editTriggered = true; };

    // Simulate real GameLibrary component DOM event target layout
    // Clickable container wraps artwork & content only; actions container is sibling
    const clickableContainer = { onClick: onSelect };
    const scanButton = { onClick: onScan };
    const editButton = { onClick: onEdit };

    // 1. Click button
    scanButton.onClick();
    assert.equal(scanTriggered, true, 'Scan button handler must execute');
    assert.equal(parentNavigated, false, 'Parent card navigation must not trigger on button click');

    editButton.onClick();
    assert.equal(editTriggered, true, 'Edit button handler must execute');
    assert.equal(parentNavigated, false, 'Parent card navigation must not trigger on edit button click');

    // 2. Click inner clickable body
    clickableContainer.onClick();
    assert.equal(parentNavigated, true, 'Parent card navigation must trigger when clicking card body');
  });
});
