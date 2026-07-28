import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import db, {
  closeDatabaseSafely,
  flushPersistence,
  resetForTesting,
} from '../src/core/database/index.ts';
import {
  addGame,
  deleteGame,
  getGameById,
  updateGame,
} from '../src/core/games/index.ts';

const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const tempRoot = path.join(os.tmpdir(), `solith-game-metadata-${runId}`);
const tempDb = path.join(tempRoot, 'solith.db');
const gameRoot = path.join(tempRoot, 'GameRoot');

describe('game metadata persistence', () => {
  before(async () => {
    fs.mkdirSync(gameRoot, { recursive: true });
    await resetForTesting(tempDb);
  });

  after(async () => {
    await closeDatabaseSafely();
    try {
      if (fs.existsSync(tempRoot)) {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    } catch (error) {
      console.error('Game metadata persistence test cleanup failed:', error);
    }
  });

  test('creates and reloads optional manual metadata from durable storage', async () => {
    const executablePath = path.join(gameRoot, 'Game.exe');
    const coverPath = path.join(gameRoot, 'cover.png');
    const iconPath = path.join(gameRoot, 'icon.png');
    fs.writeFileSync(executablePath, 'fixture exe');
    fs.writeFileSync(coverPath, 'fixture cover');
    fs.writeFileSync(iconPath, 'fixture icon');

    const created = addGame({
      name: 'Manual Metadata Quest',
      path: gameRoot,
      engine: 'Manual',
      executablePath,
      coverPath,
      iconPath,
      saveLocations: [path.join(gameRoot, 'Saves'), path.join(gameRoot, 'Profiles')],
      notes: 'User-authored notes survive restart.',
      metadataId: 'manual-metadata-quest',
    });

    await flushPersistence();
    await closeDatabaseSafely();
    await resetForTesting(tempDb, { preserveExisting: true });

    const reloaded = getGameById(created.id);
    assert.ok(reloaded);
    assert.equal(reloaded.name, 'Manual Metadata Quest');
    assert.equal(reloaded.executablePath, executablePath);
    assert.equal(reloaded.coverPath, coverPath);
    assert.equal(reloaded.iconPath, iconPath);
    assert.deepEqual(reloaded.saveLocations, [
      path.join(gameRoot, 'Saves'),
      path.join(gameRoot, 'Profiles'),
    ]);
    assert.equal(reloaded.notes, 'User-authored notes survive restart.');
    assert.equal(reloaded.metadataId, 'manual-metadata-quest');
  });

  test('updates one optional field without clearing the others', () => {
    const game = addGame({
      name: 'Partial Update Quest',
      path: path.join(tempRoot, 'PartialUpdateQuest'),
      engine: 'Manual',
      executablePath: path.join(tempRoot, 'PartialUpdateQuest', 'Game.exe'),
      coverPath: path.join(tempRoot, 'PartialUpdateQuest', 'cover.png'),
      iconPath: path.join(tempRoot, 'PartialUpdateQuest', 'icon.png'),
      saveLocations: [path.join(tempRoot, 'PartialUpdateQuest', 'SaveA')],
      notes: 'Before',
      metadataId: 'partial-update',
    });

    const updated = updateGame(game.id, { notes: 'After' });
    assert.ok(updated);
    assert.equal(updated.notes, 'After');
    assert.equal(updated.executablePath, game.executablePath);
    assert.equal(updated.coverPath, game.coverPath);
    assert.equal(updated.iconPath, game.iconPath);
    assert.deepEqual(updated.saveLocations, game.saveLocations);
    assert.equal(updated.metadataId, game.metadataId);
  });

  test('clears optional fields intentionally without corrupting core fields', () => {
    const game = addGame({
      name: 'Clear Optional Quest',
      path: path.join(tempRoot, 'ClearOptionalQuest'),
      engine: 'Manual',
      coverPath: path.join(tempRoot, 'ClearOptionalQuest', 'cover.png'),
      saveLocations: [path.join(tempRoot, 'ClearOptionalQuest', 'SaveA')],
      notes: 'Clear me',
    });

    const updated = updateGame(game.id, {
      coverPath: '',
      saveLocations: [],
      notes: '',
    });

    assert.ok(updated);
    assert.equal(updated.name, 'Clear Optional Quest');
    assert.equal(updated.path, path.join(tempRoot, 'ClearOptionalQuest'));
    assert.equal(updated.coverPath, undefined);
    assert.equal(updated.saveLocations, undefined);
    assert.equal(updated.notes, undefined);
  });

  test('migrates and reads existing core-only records without damage', () => {
    const legacyPath = path.join(tempRoot, 'LegacyCoreOnlyQuest');
    db.prepare(`
      INSERT INTO games (id, name, path, engine)
      VALUES (?, ?, ?, ?)
    `).run('legacy-core-only', 'Legacy Core Only Quest', legacyPath, 'Generic');

    const migrated = getGameById('legacy-core-only');
    assert.ok(migrated);
    assert.equal(migrated.name, 'Legacy Core Only Quest');
    assert.equal(migrated.path, legacyPath);
    assert.equal(migrated.coverPath, undefined);
    assert.equal(migrated.iconPath, undefined);
    assert.equal(migrated.saveLocations, undefined);
    assert.equal(migrated.notes, undefined);
  });

  test('removes the library entry without deleting referenced files', () => {
    const ownedRoot = path.join(tempRoot, 'ReferencedFilesQuest');
    const coverPath = path.join(ownedRoot, 'cover.png');
    const executablePath = path.join(ownedRoot, 'Game.exe');
    fs.mkdirSync(ownedRoot, { recursive: true });
    fs.writeFileSync(coverPath, 'cover bytes');
    fs.writeFileSync(executablePath, 'exe bytes');

    const game = addGame({
      name: 'Referenced Files Quest',
      path: ownedRoot,
      engine: 'Manual',
      executablePath,
      coverPath,
      notes: 'Deletion must only remove Solith metadata.',
    });

    assert.equal(deleteGame(game.id), true);
    assert.equal(getGameById(game.id), null);
    assert.equal(fs.existsSync(ownedRoot), true);
    assert.equal(fs.existsSync(coverPath), true);
    assert.equal(fs.existsSync(executablePath), true);
  });
});
