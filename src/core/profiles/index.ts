import { randomUUID } from 'node:crypto';
import { getDb, schedulePersistence } from '../database/index.js';
import type { CompatibilityProfile, ProfileValidation } from './schema.js';
import { CompatibilityProfileSchema, ProfileValidationSchema } from './schema.js';
import {
  computeProfileFingerprint,
  detectDrift,
  type GameFingerprint,
} from './fingerprint.js';

/**
 * Profile CRUD and validation operations
 *
 * Profiles are immutable by design — updates create a new version.
 * Recipes link to profiles via gameId, and profile.fingerprint is used
 * to detect when the game has changed (version update, engine update, etc.)
 * and recipes should be marked STALE.
 */

/**
 * Create a new compatibility profile for a game
 * Never mutates existing profiles; always creates a new record.
 */
export function createProfile(
  gameId: string,
  gameName: string,
  profileData: Partial<CompatibilityProfile> = {}
): CompatibilityProfile {
  // Build profile with defaults
  const profile = {
    id: randomUUID(),
    schemaVersion: '1.0.0',
    gameId,
    gameName,
    store: 'Unknown' as const,
    engine: 'Unknown' as const,
    supportedAdapters: [] as string[],
    executableNames: [] as string[],
    publisherHints: [] as string[],
    developerHints: [] as string[],
    saveLocationPatterns: [] as string[],
    configLocationPatterns: [] as string[],
    limitations: [] as string[],
    fingerprint: {} as Record<string, unknown>,
    validationStatus: 'UNSUPPORTED' as const,
    hasCloudSync: false,
    ...profileData,
  };

  // Validate before persisting
  const validated = CompatibilityProfileSchema.parse(profile) as CompatibilityProfile;

  const db = getDb();

  // Use sql.js run with bound parameters
  const sql = `
    INSERT INTO compatibility_profiles (
      id, gameId, gameName, schemaVersion, store, storeAppId,
      executableNames, executableHash, engine,
      publisherHints, developerHints, saveLocationPatterns, configLocationPatterns,
      supportedAdapters, gameVersion, saveFormatVersion, fingerprint,
      validationStatus, limitations, hasCloudSync, cloudSyncWarning,
      createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [
    validated.id,
    validated.gameId,
    validated.gameName,
    validated.schemaVersion,
    validated.store,
    validated.storeAppId ?? null,
    JSON.stringify(validated.executableNames),
    validated.executableHash ?? null,
    validated.engine,
    JSON.stringify(validated.publisherHints),
    JSON.stringify(validated.developerHints),
    JSON.stringify(validated.saveLocationPatterns),
    JSON.stringify(validated.configLocationPatterns),
    JSON.stringify(validated.supportedAdapters),
    validated.gameVersion ?? null,
    validated.saveFormatVersion ?? null,
    JSON.stringify(validated.fingerprint),
    validated.validationStatus,
    JSON.stringify(validated.limitations),
    validated.hasCloudSync ? 1 : 0,
    validated.cloudSyncWarning ?? null,
    validated.createdAt || new Date().toISOString(),
    validated.updatedAt || new Date().toISOString()
  ];

  db.run(sql, params);

  schedulePersistence();
  return validated;
}

/**
 * Get a profile by ID
 */
export function getProfile(profileId: string): CompatibilityProfile | null {
  const db = getDb();

  // Use sql.js exec with bound parameter (? placeholders)
  const sql = 'SELECT * FROM compatibility_profiles WHERE id = ?';
  const results = db.exec(sql, [profileId]);

  if (!results || !results[0] || !results[0].values || results[0].values.length === 0) {
    return null;
  }

  // Convert array result to object
  const columns = results[0].columns as string[];
  const values = results[0].values[0] as any[];
  const row: any = {};
  columns.forEach((col: string, idx: number) => {
    row[col] = values[idx];
  });

  return parseProfileRow(row);
}

/**
 * Get all profiles for a specific game
 */
export function getProfilesForGame(gameId: string): CompatibilityProfile[] {
  const db = getDb();

  // Use sql.js exec with bound parameter
  const sql = 'SELECT * FROM compatibility_profiles WHERE gameId = ? ORDER BY updatedAt DESC';
  const results = db.exec(sql, [gameId]);

  if (!results || !results[0] || !results[0].values) {
    return [];
  }

  // Convert array results to objects
  const columns = results[0].columns as string[];
  return results[0].values.map((rowValues: any[]) => {
    const row: any = {};
    columns.forEach((col: string, idx: number) => {
      row[col] = rowValues[idx];
    });
    return parseProfileRow(row);
  });
}

/**
 * Update a profile (creates a new version with updated metadata)
 * Never mutates the original; all updates are immutable.
 */
export function updateProfile(
  profileId: string,
  updates: Partial<CompatibilityProfile>
): CompatibilityProfile | null {
  const existing = getProfile(profileId);
  if (!existing) return null;

  // Create updated profile (immutable merge)
  const updated: CompatibilityProfile = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  const validated = CompatibilityProfileSchema.parse(updated);

  const db = getDb();

  // Use sql.js run with bound parameters
  const sql = `
    UPDATE compatibility_profiles SET
      gameName = ?,
      store = ?,
      storeAppId = ?,
      executableNames = ?,
      executableHash = ?,
      engine = ?,
      publisherHints = ?,
      developerHints = ?,
      saveLocationPatterns = ?,
      configLocationPatterns = ?,
      supportedAdapters = ?,
      gameVersion = ?,
      saveFormatVersion = ?,
      fingerprint = ?,
      validationStatus = ?,
      limitations = ?,
      hasCloudSync = ?,
      cloudSyncWarning = ?,
      updatedAt = ?
    WHERE id = ?
  `;

  const params = [
    validated.gameName,
    validated.store,
    validated.storeAppId ?? null,
    JSON.stringify(validated.executableNames),
    validated.executableHash ?? null,
    validated.engine,
    JSON.stringify(validated.publisherHints),
    JSON.stringify(validated.developerHints),
    JSON.stringify(validated.saveLocationPatterns),
    JSON.stringify(validated.configLocationPatterns),
    JSON.stringify(validated.supportedAdapters),
    validated.gameVersion ?? null,
    validated.saveFormatVersion ?? null,
    JSON.stringify(validated.fingerprint),
    validated.validationStatus,
    JSON.stringify(validated.limitations),
    validated.hasCloudSync ? 1 : 0,
    validated.cloudSyncWarning ?? null,
    validated.updatedAt,
    profileId
  ];

  db.run(sql, params);

  schedulePersistence();
  return validated;
}

/**
 * Validate a profile and record the validation result
 * Returns the validation record with passed/failed status
 */
export function validateProfile(
  profileId: string,
  currentFingerprint: GameFingerprint
): ProfileValidation {
  const profile = getProfile(profileId);
  if (!profile) {
    throw new Error(`Profile ${profileId} not found`);
  }

  // Check for drift
  const drift = detectDrift(profile, currentFingerprint);

  const validation: ProfileValidation = {
    id: randomUUID(),
    status: profile.validationStatus,
    checkedAt: new Date().toISOString(),
    passed: !drift.drifted && profile.validationStatus !== 'UNSUPPORTED',
    evidence: drift.reasons,
    fingerprint: currentFingerprint,
  };

  const validated = ProfileValidationSchema.parse(validation);

  const db = getDb();

  // Use sql.js run with bound parameters
  const sql = `
    INSERT INTO profile_validations (
      id, profileId, status, checkedAt, passed, evidence, fingerprint
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [
    validated.id,
    profileId,
    validated.status,
    validated.checkedAt,
    validated.passed ? 1 : 0,
    JSON.stringify(validated.evidence),
    JSON.stringify(validated.fingerprint)
  ];

  db.run(sql, params);

  // Update profile.lastValidatedAt
  updateProfile(profileId, {
    lastValidatedAt: validated.checkedAt,
  });

  schedulePersistence();
  return validated;
}

/**
 * Check if a profile has drifted (game has been updated)
 * Returns true if executable/format has changed
 */
export function checkProfileDrift(
  profileId: string,
  currentFingerprint: GameFingerprint
): { drifted: boolean; reasons: string[] } {
  const profile = getProfile(profileId);
  if (!profile) {
    return { drifted: true, reasons: ['Profile not found'] };
  }

  return detectDrift(profile, currentFingerprint);
}

/**
 * Helper: convert database row to typed CompatibilityProfile
 */
function parseProfileRow(row: any): CompatibilityProfile {
  return {
    id: row.id,
    schemaVersion: row.schemaVersion || '1.0.0',
    gameId: row.gameId,
    gameName: row.gameName,
    store: row.store || 'Unknown',
    storeAppId: row.storeAppId || undefined,
    executableNames: JSON.parse(row.executableNames || '[]'),
    executableHash: row.executableHash || undefined,
    engine: row.engine || 'Unknown',
    publisherHints: JSON.parse(row.publisherHints || '[]'),
    developerHints: JSON.parse(row.developerHints || '[]'),
    saveLocationPatterns: JSON.parse(row.saveLocationPatterns || '[]'),
    configLocationPatterns: JSON.parse(row.configLocationPatterns || '[]'),
    supportedAdapters: JSON.parse(row.supportedAdapters || '[]'),
    gameVersion: row.gameVersion || undefined,
    saveFormatVersion: row.saveFormatVersion || undefined,
    fingerprint: JSON.parse(row.fingerprint || '{}'),
    validationStatus: row.validationStatus || 'UNSUPPORTED',
    limitations: JSON.parse(row.limitations || '[]'),
    hasCloudSync: row.hasCloudSync === 1,
    cloudSyncWarning: row.cloudSyncWarning || undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastValidatedAt: row.lastValidatedAt || undefined,
  };
}

/**
 * Delete a profile and all its validations (cleanup)
 * Cascade delete via foreign keys
 */
export function deleteProfile(profileId: string): boolean {
  const db = getDb();

  // Delete validations first (FK constraint) using sql.js run with bound parameter
  db.run('DELETE FROM profile_validations WHERE profileId = ?', [profileId]);

  // Delete profile using sql.js run with bound parameter
  db.run('DELETE FROM compatibility_profiles WHERE id = ?', [profileId]);

  schedulePersistence();
  return true; // Assume success for now since sql.js doesn't reliably report changes
}
