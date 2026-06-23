import { test, describe } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { isGameRunning } from '../src/core/process/index.js';
import type { CompatibilityProfile } from '../src/core/profiles/schema.js';

describe('Game-Running Detection', () => {
  test('1. Return false when no executable names registered', () => {
    const profile: CompatibilityProfile = {
      id: randomUUID(),
      schemaVersion: '1.0.0',
      gameId: randomUUID(),
      gameName: 'Test Game',
      store: 'Unknown',
      supportedAdapters: [],
      executableNames: [], // empty
      limitations: [],
      fingerprint: {},
    };

    const result = isGameRunning(profile);
    assert.strictEqual(result.running, false, 'Should return false with no executables');
    assert(result.evidence.includes('No executable names'), 'Should explain no names');
  });

  test('2. Return false when executable not found in process list', () => {
    const profile: CompatibilityProfile = {
      id: randomUUID(),
      schemaVersion: '1.0.0',
      gameId: randomUUID(),
      gameName: 'Test Game',
      store: 'Unknown',
      supportedAdapters: [],
      executableNames: ['nonexistent-game-that-should-never-run.exe'],
      limitations: [],
      fingerprint: {},
    };

    const result = isGameRunning(profile);
    assert.strictEqual(result.running, false, 'Should return false if not found');
    assert(result.evidence, 'Should return evidence');
  });

  test('3. Return string evidence on error (safe fallback)', () => {
    const profile: CompatibilityProfile = {
      id: randomUUID(),
      schemaVersion: '1.0.0',
      gameId: randomUUID(),
      gameName: 'Test Game',
      store: 'Unknown',
      supportedAdapters: [],
      executableNames: ['test.exe'],
      limitations: [],
      fingerprint: {},
    };

    const result = isGameRunning(profile);
    // Should always return an object with running: boolean and evidence: string
    assert.strictEqual(typeof result.running, 'boolean', 'Should return boolean');
    assert.strictEqual(typeof result.evidence, 'string', 'Should return evidence string');
  });

  test('4. Check is read-only (no side effects)', () => {
    const profile: CompatibilityProfile = {
      id: randomUUID(),
      schemaVersion: '1.0.0',
      gameId: randomUUID(),
      gameName: 'Test Game',
      store: 'Unknown',
      supportedAdapters: [],
      executableNames: ['nonexistent.exe'],
      limitations: [],
      fingerprint: {},
    };

    // Call multiple times — should not have any lasting effects
    const result1 = isGameRunning(profile);
    const result2 = isGameRunning(profile);

    assert.deepStrictEqual(result1, result2, 'Multiple calls should be idempotent');
  });
});
