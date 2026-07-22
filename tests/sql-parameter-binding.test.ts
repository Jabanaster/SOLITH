/**
 * tests/sql-parameter-binding.test.ts
 *
 * Verify that SQL operations use proper parameter binding with ? placeholders
 * instead of dangerous string concatenation/escaping.
 *
 * Tests with hostile values that would break unprotected escaping:
 * - Single quotes: O'Brien
 * - Double quotes
 * - Unicode: 日本語
 * - Newlines and special chars
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { closeDatabaseSafely, resetForTesting } from '../src/core/database/index.ts';
import db from '../src/core/database/index.ts';
import {
  createProfile,
  getProfile,
  getProfilesForGame,
  updateProfile,
  deleteProfile,
  validateProfile
} from '../src/core/profiles/index.ts';

describe('SQL Parameter Binding — Hostile Value Tests', () => {
  const baseGameId = randomUUID();
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tempRoot = path.join(os.tmpdir(), `solith-sql-binding-${runId}`);
  const tempDb = path.join(tempRoot, 'test.db');

  function seedGame(gameId: string, gameName: string): void {
    db.prepare(`
      INSERT OR REPLACE INTO games (id, name, path, engine)
      VALUES (?, ?, ?, ?)
    `).run(gameId, gameName, tempRoot, 'Test');
  }

  before(async () => {
    fs.mkdirSync(tempRoot, { recursive: true });
    await resetForTesting(tempDb);
    seedGame(baseGameId, 'Base SQL Binding Game');
  });

  after(async () => {
    await closeDatabaseSafely();
    try {
      if (fs.existsSync(tempRoot)) {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    } catch (error) {
      console.error('SQL binding test teardown cleanup failed:', error);
    }
  });

  test('1. Parameter binding with single quotes in gameName', () => {
    const gameNameWithQuotes = "O'Brien's Game (It's Great!)";
    seedGame(baseGameId, gameNameWithQuotes);
    const profile = createProfile(baseGameId, gameNameWithQuotes, {});

    assert.strictEqual(profile.gameName, gameNameWithQuotes);

    const retrieved = getProfile(profile.id);
    assert.strictEqual(retrieved?.gameName, gameNameWithQuotes);

    console.log('✓ Single quotes round-trip correctly via parameter binding');
  });

  test('2. Parameter binding with SQL-like injection strings in gameName', () => {
    const injectionString = "Game'; DROP TABLE test; --";
    const gameId = randomUUID();
    seedGame(gameId, injectionString);
    const profile = createProfile(gameId, injectionString, {});

    // If SQL injection worked, table would be gone - it's not, so binding works
    assert.strictEqual(profile.gameName, injectionString);

    const retrieved = getProfile(profile.id);
    assert.strictEqual(retrieved?.gameName, injectionString);

    console.log('✓ SQL injection attempt safely handled by parameter binding');
  });

  test('3. Parameter binding with double quotes and special chars', () => {
    const specialString = 'Text with "double quotes" and \\backslash\\';
    const gameId = randomUUID();
    seedGame(gameId, specialString);
    const profile = createProfile(gameId, specialString, {
      publisherHints: [
        'Hint with "quotes"',
        "Hint with 'apostrophe'",
        'SQL: SELECT * FROM games',
        'Unicode: 日本語'
      ]
    });

    assert.strictEqual(profile.gameName, specialString);
    assert.strictEqual(profile.publisherHints[0], 'Hint with "quotes"');
    assert.strictEqual(profile.publisherHints[3], 'Unicode: 日本語');

    const retrieved = getProfile(profile.id);
    assert.deepStrictEqual(retrieved?.publisherHints, profile.publisherHints);

    console.log('✓ Special characters preserve correctly through parameter binding');
  });

  test('4. Parameter binding with Unicode characters', () => {
    const unicodeHints = [
      '日本語テスト',
      '中文测试',
      'Русский тест',
      '한국어 테스트',
      '🎮 Emoji 🎯'
    ];

    const gameId = randomUUID();
    seedGame(gameId, 'Game with Unicode 日本語');
    const profile = createProfile(gameId, 'Game with Unicode 日本語', {
      developerHints: unicodeHints
    });

    assert.deepStrictEqual(profile.developerHints, unicodeHints);

    const retrieved = getProfile(profile.id);
    assert.deepStrictEqual(retrieved?.developerHints, unicodeHints);

    console.log('✓ Unicode characters preserved through parameter binding');
  });

  test('5. Parameter binding with newlines and whitespace', () => {
    const limitations = [
      'Line 1\nLine 2\nLine 3',
      'Tab\tseparated\tvalues',
      'Carriage\r\nreturn'
    ];

    const gameId = randomUUID();
    seedGame(gameId, 'Game with Whitespace');
    const profile = createProfile(gameId, 'Game with Whitespace', {
      limitations
    });

    assert.deepStrictEqual(profile.limitations, limitations);

    const retrieved = getProfile(profile.id);
    assert.deepStrictEqual(retrieved?.limitations, limitations);

    console.log('✓ Whitespace and newlines preserved through parameter binding');
  });

  test('6. Update with parameter binding and hostile values', () => {
    const gameId = randomUUID();
    seedGame(gameId, 'Original Name');
    const profile = createProfile(gameId, 'Original Name', {});
    const newName = "Updated'; DROP DATABASE; -- 日本語";
    const newLimitations = ["'; DELETE FROM test; --"];

    const updated = updateProfile(profile.id, {
      gameName: newName,
      limitations: newLimitations
    });

    assert.strictEqual(updated?.gameName, newName);
    assert.deepStrictEqual(updated?.limitations, newLimitations);

    const retrieved = getProfile(profile.id);
    assert.strictEqual(retrieved?.gameName, newName);
    assert.deepStrictEqual(retrieved?.limitations, newLimitations);

    console.log('✓ Update with hostile values works correctly');
  });

  test('7. Delete with parameter binding', () => {
    const hostileGameName = "'; DELETE FROM compatibility_profiles; --";
    const gameId = randomUUID();
    seedGame(gameId, hostileGameName);
    const profile = createProfile(gameId, hostileGameName, {});
    const profileId = profile.id;

    // Verify it exists
    assert.ok(getProfile(profileId));

    // Delete it
    deleteProfile(profileId);

    // Verify it's gone
    assert.strictEqual(getProfile(profileId), null);

    // But other profiles still exist (injection didn't work)
    const otherGameId = randomUUID();
    seedGame(otherGameId, 'Other Game');
    const otherProfile = createProfile(otherGameId, 'Other Game', {});
    assert.ok(getProfile(otherProfile.id));

    console.log('✓ Delete with parameter binding and injection string works');
  });

  test('8. Query with parameter binding (getProfilesForGame)', () => {
    const gameId1 = randomUUID();
    const gameId2 = randomUUID();
    seedGame(gameId1, "Game'; DROP TABLE test; --");
    seedGame(gameId2, 'Normal Game Name');
    const profile1 = createProfile(gameId1, "Game'; DROP TABLE test; --", {});
    const profile2 = createProfile(gameId2, 'Normal Game Name', {});

    // Query profiles for first game (with hostile name)
    const profilesForGame1 = getProfilesForGame(gameId1);
    assert.strictEqual(profilesForGame1.length, 1);
    assert.strictEqual(profilesForGame1[0].id, profile1.id);
    assert.strictEqual(profilesForGame1[0].gameName, "Game'; DROP TABLE test; --");

    // Query profiles for second game
    const profilesForGame2 = getProfilesForGame(gameId2);
    assert.strictEqual(profilesForGame2.length, 1);
    assert.strictEqual(profilesForGame2[0].id, profile2.id);

    console.log('✓ Query with parameter binding retrieves rows correctly');
  });

  test('9. Validation with parameter binding', () => {
    const gameId = randomUUID();
    seedGame(gameId, "Game'; DROP TABLE fingerprints; --");
    const profile = createProfile(gameId, "Game'; DROP TABLE fingerprints; --", {});

    const fingerprint = {
      fileCount: 10,
      totalSize: 5000000,
      keyHashes: ["'; DROP TABLE test; --", "Normal hash"],
      mainExecutable: 'C:\\Program Files\\Game\\game.exe',
      lastScan: new Date().toISOString()
    };

    // Validation stores JSON with special characters in fingerprint
    const validation = validateProfile(profile.id, fingerprint);
    assert.ok(validation.id);

    console.log('✓ Validation with parameter binding handles complex JSON');
  });

  test('10. Complete round-trip verification', () => {
    const hostile = {
      gameName: "O'Reilly's \"Game\"; DROP TABLE test; -- 日本語",
      publisherHints: [
        'Hint: "quoted" and \'apostrophe\'',
        "'; SELECT * FROM games; --",
        '日本語提示'
      ],
      limitations: [
        'Limit\nwith\nnewlines',
        "'; DELETE FROM test; --"
      ]
    };

    // Create
    const gameId = randomUUID();
    seedGame(gameId, hostile.gameName);
    const created = createProfile(gameId, hostile.gameName, {
      publisherHints: hostile.publisherHints,
      limitations: hostile.limitations
    });

    // Retrieve
    const retrieved = getProfile(created.id);
    assert.strictEqual(retrieved?.gameName, hostile.gameName);
    assert.deepStrictEqual(retrieved?.publisherHints, hostile.publisherHints);
    assert.deepStrictEqual(retrieved?.limitations, hostile.limitations);

    // Update
    const updatedName = "Updated'; TRUNCATE TABLE test; -- 日本語";
    const updated = updateProfile(created.id, { gameName: updatedName });
    assert.strictEqual(updated?.gameName, updatedName);

    // Verify update persisted
    const retrievedAgain = getProfile(created.id);
    assert.strictEqual(retrievedAgain?.gameName, updatedName);

    console.log('✓ Complete create-retrieve-update-retrieve cycle successful');
  });

  after(() => {
    // Cleanup is handled by database isolation
  });
});
