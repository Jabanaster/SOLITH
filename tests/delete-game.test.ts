/**
 * tests/delete-game.test.ts
 *
 * Gate 11: deleteGame IPC regression tests.
 * Tests the full delete-game contract at the database layer:
 *  - Valid deletion succeeds and returns true
 *  - Deleting a non-existent game returns false
 *  - Zod schema rejects non-UUID game IDs
 *  - Zod schema accepts the demo game literal ID
 *  - Deleted game can no longer be found
 *  - Deleting demo game sets demoGameDeleted flag
 *
 * Isolation: each suite uses a unique temp DB via resetForTesting().
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

const uuidv4 = () => crypto.randomUUID();

import db, { resetForTesting } from '../src/core/database/index.ts';
import { addGame, deleteGame, getGameById } from '../src/core/games/index.ts';
import { DeleteGameSchema } from '../electron/ipc-validation.ts';

const RUN_ID    = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const TEMP_ROOT = path.join(os.tmpdir(), `resourceforge-delete-game-${RUN_ID}`);
const TEMP_DB   = path.join(TEMP_ROOT, 'test.db');

describe('deleteGame — IPC Regression Tests', () => {
  before(async () => {
    fs.mkdirSync(TEMP_ROOT, { recursive: true });
    await resetForTesting(TEMP_DB);
  });

  after(() => {
    try {
      if (fs.existsSync(TEMP_ROOT)) {
        fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
      }
    } catch { /* ignore */ }
  });

  test('1. valid deletion returns true', () => {
    const game = addGame({ name: 'Delete Me', path: TEMP_ROOT, engine: 'Unity' });
    assert.ok(game, 'addGame must succeed');

    const result = deleteGame(game.id);
    assert.strictEqual(result, true, 'deleteGame should return true on success');
  });

  test('2. deleted game is no longer found', () => {
    const game = addGame({ name: 'Gone After Delete', path: TEMP_ROOT, engine: 'Godot' });
    assert.ok(game, 'addGame must succeed');

    deleteGame(game.id);

    const found = getGameById(game.id);
    assert.strictEqual(found, null, 'getGameById must return null after deletion');
  });

  test('3. deleting a non-existent ID returns false', () => {
    const fakeId = uuidv4();
    const result = deleteGame(fakeId);
    assert.strictEqual(result, false, 'deleteGame on non-existent ID should return false');
  });

  test('4. Zod schema rejects malformed game ID (not UUID)', () => {
    assert.throws(
      () => DeleteGameSchema.parse({ gameId: 'not-a-uuid' }),
      (err: unknown) => err instanceof Error && err.message.includes('gameId'),
      'DeleteGameSchema should throw for non-UUID string'
    );
  });

  test('5. Zod schema rejects empty string', () => {
    assert.throws(
      () => DeleteGameSchema.parse({ gameId: '' }),
      'DeleteGameSchema should throw for empty string'
    );
  });

  test('6. Zod schema accepts the demo game literal ID', () => {
    const DEMO_ID = 'demo-game-quest-id-000000000000';
    const result = DeleteGameSchema.safeParse({ gameId: DEMO_ID });
    assert.strictEqual(result.success, true, 'DeleteGameSchema should accept demo-game literal ID');
  });

  test('7. Zod schema accepts a valid UUID', () => {
    const validId = uuidv4();
    const result = DeleteGameSchema.safeParse({ gameId: validId });
    assert.strictEqual(result.success, true, 'DeleteGameSchema should accept valid UUID');
  });

  test('8. demo game deletion sets demoGameDeleted flag in settings', () => {
    const DEMO_ID = 'demo-game-quest-id-000000000000';

    // Ensure demo game row exists (insert directly to bypass ensureDemoGame logic)
    db.prepare(`
      INSERT OR IGNORE INTO games (id, name, path, engine)
      VALUES (?, ?, ?, ?)
    `).run(DEMO_ID, 'Demo Game', TEMP_ROOT, 'Demo');

    deleteGame(DEMO_ID);

    const row = db.prepare("SELECT value FROM settings WHERE key = 'demoGameDeleted'").get() as { value: string } | undefined;
    assert.strictEqual(row?.value, 'true', "demoGameDeleted setting must be 'true' after demo game is deleted");
  });
});
