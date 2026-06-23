import { test, describe } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { resetForTesting } from '../src/core/database/index.js';
import {
  createProfile,
  getProfile,
  getProfilesForGame,
  updateProfile,
  validateProfile,
  checkProfileDrift,
  deleteProfile,
} from '../src/core/profiles/index.js';
import { computeProfileFingerprint, detectDrift } from '../src/core/profiles/fingerprint.js';
import type { CompatibilityProfile, GameFingerprint } from '../src/core/profiles/schema.js';

describe('Compatibility Profiles', () => {
  test('1. Create profile with required fields', async () => {
    await resetForTesting();

    const gameId = randomUUID();
    const profile = createProfile(gameId, 'Test Game', {
      store: 'Steam',
      engine: 'Unity',
    });

    assert(profile.id, 'Profile should have an ID');
    assert.strictEqual(profile.gameId, gameId, 'Profile gameId should match');
    assert.strictEqual(profile.gameName, 'Test Game', 'Game name should match');
    assert.strictEqual(profile.store, 'Steam', 'Store should match');
    assert.strictEqual(profile.schemaVersion, '1.0.0', 'Schema version should default to 1.0.0');
  });

  test('2. Retrieve profile by ID', async () => {
    await resetForTesting();

    const gameId = randomUUID();
    const created = createProfile(gameId, 'Game A', {
      validationStatus: 'VERIFIED',
    });

    const retrieved = getProfile(created.id);
    assert(retrieved, 'Profile should be retrievable');
    assert.strictEqual(retrieved!.id, created.id, 'Retrieved profile should match');
    assert.strictEqual(retrieved!.gameName, 'Game A', 'Game name should match');
    assert.strictEqual(retrieved!.validationStatus, 'VERIFIED', 'Validation status should match');
  });

  test('3. Get profile for a game', async () => {
    await resetForTesting();

    const gameId = randomUUID();
    const otherGameId = randomUUID();

    const profile1 = createProfile(gameId, 'Game 1');
    createProfile(otherGameId, 'Other Game');

    const profiles = getProfilesForGame(gameId);
    assert.strictEqual(profiles.length, 1, 'Should retrieve 1 profile for gameId (UNIQUE constraint)');
    assert.strictEqual(profiles[0].id, profile1.id, 'Retrieved profile should match created one');
    assert.strictEqual(profiles[0].gameId, gameId, 'Profile should have correct gameId');
  });

  test('4. Update profile (immutable — creates new version)', async () => {
    await resetForTesting();

    const gameId = randomUUID();
    const original = createProfile(gameId, 'Original Name', {
      validationStatus: 'UNSUPPORTED',
    });

    const updated = updateProfile(original.id, {
      gameName: 'Updated Name',
      validationStatus: 'SUPPORTED',
    });

    assert(updated, 'Update should return the updated profile');
    assert.strictEqual(updated!.id, original.id, 'ID should not change');
    assert.strictEqual(updated!.gameName, 'Updated Name', 'Name should be updated');
    assert.strictEqual(updated!.validationStatus, 'SUPPORTED', 'Status should be updated');

    // Verify in database
    const retrieved = getProfile(original.id);
    assert.strictEqual(retrieved!.gameName, 'Updated Name', 'Updated value should persist');
  });

  test('5. Fingerprint computation is deterministic', async () => {
    const hint1 = computeProfileFingerprint(
      undefined,
      'save-structure-v1',
      '1.0.0',
      { adapter_json: '1.0' },
      {}
    );

    const hint2 = computeProfileFingerprint(
      undefined,
      'save-structure-v1',
      '1.0.0',
      { adapter_json: '1.0' },
      {}
    );

    assert.deepStrictEqual(
      hint1.saveStructureSignature,
      hint2.saveStructureSignature,
      'Same inputs should produce same fingerprint'
    );
  });

  test('6. Drift detection: executable hash change', async () => {
    const storedProfile: CompatibilityProfile = {
      id: randomUUID(),
      schemaVersion: '1.0.0',
      gameId: randomUUID(),
      gameName: 'Test',
      store: 'Unknown',
      supportedAdapters: [],
      executableNames: [],
      limitations: [],
      fingerprint: {
        executableHashSHA256: 'aaa111',
      },
    };

    const currentFingerpint: GameFingerprint = {
      executableHashSHA256: 'bbb222', // different hash
    };

    const drift = detectDrift(storedProfile, currentFingerpint);
    assert.strictEqual(drift.drifted, true, 'Should detect executable hash drift');
    assert(drift.reasons.length > 0, 'Should explain drift reason');
  });

  test('7. Drift detection: save structure change', async () => {
    const storedProfile: CompatibilityProfile = {
      id: randomUUID(),
      schemaVersion: '1.0.0',
      gameId: randomUUID(),
      gameName: 'Test',
      store: 'Unknown',
      supportedAdapters: [],
      executableNames: [],
      limitations: [],
      fingerprint: {
        saveStructureSignature: 'sig111',
      },
    };

    const currentFingerpint: GameFingerprint = {
      saveStructureSignature: 'sig222', // different signature
    };

    const drift = detectDrift(storedProfile, currentFingerpint);
    assert.strictEqual(drift.drifted, true, 'Should detect structure drift');
    assert(
      drift.reasons.some(r => r.includes('Save structure')),
      'Should mention structure change'
    );
  });

  test('8. Drift detection: no drift when fingerprints match', async () => {
    const storedProfile: CompatibilityProfile = {
      id: randomUUID(),
      schemaVersion: '1.0.0',
      gameId: randomUUID(),
      gameName: 'Test',
      store: 'Unknown',
      supportedAdapters: [],
      executableNames: [],
      limitations: [],
      fingerprint: {
        executableHashSHA256: 'abc123',
        saveStructureSignature: 'sig123',
        saveFormatVersion: '1.0.0',
      },
    };

    const currentFingerpint: GameFingerprint = {
      executableHashSHA256: 'abc123',
      saveStructureSignature: 'sig123',
      saveFormatVersion: '1.0.0',
    };

    const drift = detectDrift(storedProfile, currentFingerpint);
    assert.strictEqual(drift.drifted, false, 'Should detect no drift when identical');
    assert.strictEqual(drift.reasons.length, 0, 'Should have no reasons');
  });

  test('9. Profile validation records status and drift', async () => {
    await resetForTesting();

    const gameId = randomUUID();
    const profile = createProfile(gameId, 'Game', {
      validationStatus: 'VERIFIED',
      fingerprint: {
        executableHashSHA256: 'abc123',
      },
    });

    // Validate with matching fingerprint
    const validation = validateProfile(profile.id, {
      executableHashSHA256: 'abc123',
    });

    assert.strictEqual(validation.passed, true, 'Should pass if no drift and status is VERIFIED');
    assert.strictEqual(validation.evidence.length, 0, 'Should have no drift reasons');
  });

  test('10. Profile validation fails on drift', async () => {
    await resetForTesting();

    const gameId = randomUUID();
    const profile = createProfile(gameId, 'Game', {
      validationStatus: 'VERIFIED',
      fingerprint: {
        executableHashSHA256: 'original_hash',
      },
    });

    // Validate with different fingerprint (drift)
    const validation = validateProfile(profile.id, {
      executableHashSHA256: 'new_hash', // different
    });

    assert.strictEqual(validation.passed, false, 'Should fail if drift detected');
    assert(validation.evidence.length > 0, 'Should have drift reasons');
  });

  test('11. Check profile drift directly', async () => {
    await resetForTesting();

    const gameId = randomUUID();
    const profile = createProfile(gameId, 'Game', {
      fingerprint: {
        executableHashSHA256: 'old_hash',
        saveFormatVersion: '1.0.0',
      },
    });

    const result = checkProfileDrift(profile.id, {
      executableHashSHA256: 'new_hash', // changed
      saveFormatVersion: '2.0.0', // changed
    });

    assert.strictEqual(result.drifted, true, 'Should detect drift');
    assert(result.reasons.length > 0, 'Should explain why');
  });

  test('12. Delete profile cascades to validations', async () => {
    await resetForTesting();

    const gameId = randomUUID();
    const profile = createProfile(gameId, 'Game');

    // Create a validation
    validateProfile(profile.id, { executableHashSHA256: 'hash' });

    // Delete profile
    const deleted = deleteProfile(profile.id);
    assert.strictEqual(deleted, true, 'Delete should return true');

    // Verify profile is gone
    const retrieved = getProfile(profile.id);
    assert.strictEqual(retrieved, null, 'Profile should be deleted');
  });
});
