import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import db, { initDatabase } from '../src/core/database/index.ts';
import { addGame } from '../src/core/games/index.ts';
import { validateSaveDataFileAccess } from '../electron/ipc-validation.ts';

describe('save/data IPC path approval', () => {
  let tempRoot = '';
  let gameDir = '';
  let externalDir = '';
  let gameId = '';

  beforeEach(async () => {
    await initDatabase();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-ipc-save-path-'));
    gameDir = path.join(tempRoot, 'game');
    externalDir = path.join(tempRoot, 'external');
    fs.mkdirSync(gameDir, { recursive: true });
    fs.mkdirSync(externalDir, { recursive: true });
    gameId = addGame({ name: `IPC Save Path ${Date.now()}`, path: gameDir, engine: 'Test' }).id;
  });

  afterEach(() => {
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('rejects parse-save path outside the approved game root', () => {
    const outsideFile = path.join(externalDir, 'outside.json');
    fs.writeFileSync(outsideFile, '{"player":{"gold":100}}', 'utf-8');

    const result = validateSaveDataFileAccess(gameId, outsideFile);

    assert.equal(result.safe, false);
    assert.equal(result.error, 'File is not approved for this game.');
    assert.equal(result.error.includes(outsideFile), false);
  });

  test('rejects compare-saves when either path is outside the approved game root', () => {
    const approvedFile = path.join(gameDir, 'inside.json');
    const outsideFile = path.join(externalDir, 'outside.json');
    fs.writeFileSync(approvedFile, '{"player":{"gold":100}}', 'utf-8');
    fs.writeFileSync(outsideFile, '{"player":{"gold":200}}', 'utf-8');

    const approved = validateSaveDataFileAccess(gameId, approvedFile);
    const rejected = validateSaveDataFileAccess(gameId, outsideFile);

    assert.equal(approved.safe, true);
    assert.equal(rejected.safe, false);
    assert.equal(rejected.error, 'File is not approved for this game.');
  });

  test('rejects suggest-data-edits path outside the approved game root', () => {
    const outsideFile = path.join(externalDir, 'data.json');
    fs.writeFileSync(outsideFile, '{"damage":10}', 'utf-8');

    const result = validateSaveDataFileAccess(gameId, outsideFile);

    assert.equal(result.safe, false);
    assert.equal(result.error, 'File is not approved for this game.');
    assert.equal(result.error.includes(os.tmpdir()), false);
  });

  test('allows registered game root paths', () => {
    const approvedFile = path.join(gameDir, 'save.json');
    fs.writeFileSync(approvedFile, '{"player":{"gold":100}}', 'utf-8');

    const result = validateSaveDataFileAccess(gameId, approvedFile);

    assert.equal(result.safe, true);
  });

  test('allows approved user-selected save locations', () => {
    const selectedDir = path.join(tempRoot, 'selected-saves');
    const selectedFile = path.join(selectedDir, 'save.json');
    fs.mkdirSync(selectedDir, { recursive: true });
    fs.writeFileSync(selectedFile, '{"player":{"gold":100}}', 'utf-8');
    db.prepare(`
      INSERT INTO save_locations (
        id, gameId, canonicalPath, locationType, discoverySource, confidence, approvalState,
        existsState, writableState, detectionEvidence, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      gameId,
      selectedDir.toLowerCase(),
      'USER_SELECTED',
      'USER_SELECTED',
      100,
      'Approved',
      1,
      1,
      'test',
      new Date().toISOString(),
      new Date().toISOString()
    );

    const result = validateSaveDataFileAccess(gameId, selectedFile);

    assert.equal(result.safe, true);
  });

  test('allows built-in demo game paths without approving arbitrary install files', () => {
    const demoSave = path.resolve(process.cwd(), 'demo-game', 'save', 'save1.json');
    const arbitraryInstallFile = path.resolve(process.cwd(), 'package.json');

    const approved = validateSaveDataFileAccess('demo-game-quest-id-000000000000', demoSave);
    const rejected = validateSaveDataFileAccess('demo-game-quest-id-000000000000', arbitraryInstallFile);

    assert.equal(approved.safe, true);
    assert.equal(rejected.safe, false);
    assert.equal(rejected.error, 'File is not approved for this game.');
  });
});
