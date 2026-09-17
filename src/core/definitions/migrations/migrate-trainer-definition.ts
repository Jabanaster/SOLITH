import { parseSolithDefinitionV1, validateSolithDefinitionV1 } from '../schema.v1.js';
import { detectTrainerDefinitionVersion } from './version-detect.js';
import { migrateLegacyUnversionedToV1 } from './legacy-unversioned-migration.js';
import { LEGACY_UNVERSIONED, SUPPORTED_TRAINER_SCHEMA_VERSIONS, type MigrationOutcome } from './types.js';

/**
 * Canonical trainer-definition version/migration pipeline:
 *
 *   RawInput
 *     -> Version Detection        (version-detect.ts)
 *     -> Version-Specific Schema Validation  (schema.v1.ts, reused not duplicated)
 *     -> Migration Chain          (legacy-unversioned-migration.ts, extend here as new
 *                                   versions are added — e.g. a v1 -> v2 step registered
 *                                   after the legacy step, chained in order)
 *     -> Current Canonical Schema
 *     -> Current Canonical Validation
 *
 * Unknown future schema versions and malformed input both fail closed —
 * never parsed as current, never stripped/downgraded/silently reinterpreted.
 *
 * This is the recommended entrypoint for any caller that does not already
 * know its input is a freshly-authored, current-version SolithDefinitionV1
 * (those callers may continue to use parseSolithDefinitionV1 directly).
 */
export function migrateTrainerDefinition(input: unknown): MigrationOutcome {
  const detection = detectTrainerDefinitionVersion(input);

  if (detection.kind === 'malformed') {
    return { success: false, reason: 'MALFORMED', sourceVersion: 'UNKNOWN', errors: [detection.reason] };
  }

  if (detection.kind === 'unknown_future_version') {
    const supported = SUPPORTED_TRAINER_SCHEMA_VERSIONS.join(', ');
    return {
      success: false,
      reason: 'UNKNOWN_FUTURE_VERSION',
      sourceVersion: 'UNKNOWN',
      errors: [
        `unsupported schema version: ${detection.version}. This build supports schemaVersion ${supported} ` +
          'plus legacy unversioned input, and refuses to guess, strip, or downgrade a newer trainer definition.',
      ],
    };
  }

  if (detection.kind === 'legacy_unversioned') {
    const legacy = migrateLegacyUnversionedToV1(input);
    if (legacy.success === false) {
      return { success: false, reason: 'LEGACY_INPUT_INVALID', sourceVersion: LEGACY_UNVERSIONED, errors: legacy.errors };
    }

    const validationErrors = validateSolithDefinitionV1(legacy.definition);
    if (validationErrors.length > 0) {
      return {
        success: false,
        reason: 'SCHEMA_VALIDATION_FAILED',
        sourceVersion: LEGACY_UNVERSIONED,
        errors: validationErrors,
      };
    }

    return {
      success: true,
      definition: parseSolithDefinitionV1(legacy.definition),
      sourceVersion: LEGACY_UNVERSIONED,
      targetVersion: 1,
      migrationsApplied: [{ id: 'legacy-unversioned-to-v1', from: LEGACY_UNVERSIONED, to: 1 }],
      warnings: legacy.warnings,
    };
  }

  // detection.kind === 'versioned' — currently only version 1 is supported.
  const validationErrors = validateSolithDefinitionV1(input);
  if (validationErrors.length > 0) {
    return {
      success: false,
      reason: 'SCHEMA_VALIDATION_FAILED',
      sourceVersion: detection.version === 1 ? 1 : 'UNKNOWN',
      errors: validationErrors,
    };
  }

  return {
    success: true,
    definition: parseSolithDefinitionV1(input),
    sourceVersion: 1,
    targetVersion: 1,
    migrationsApplied: [],
    warnings: [],
  };
}
