import type { SolithDefinitionV1 } from '../schema.v1.js';

/**
 * Versions this build can validate/execute a trainer definition as, once
 * migrated. `LEGACY_UNVERSIONED` is not a persisted version number — it is
 * the internal migration-pipeline label for input that never carried a
 * `schemaVersion` field at all (e.g. a stored ModPack payload). Introducing
 * a literal `0` for that case would misrepresent history: no such object was
 * ever actually written as "schema version 0".
 */
export const LEGACY_UNVERSIONED = 'LEGACY_UNVERSIONED' as const;

export const SUPPORTED_TRAINER_SCHEMA_VERSIONS = [1] as const;
export type SupportedTrainerSchemaVersion = (typeof SUPPORTED_TRAINER_SCHEMA_VERSIONS)[number];

export type TrainerDefinitionSourceLabel = SupportedTrainerSchemaVersion | typeof LEGACY_UNVERSIONED;

export interface MigrationStepReport {
  /** Source label this step migrated from. */
  from: TrainerDefinitionSourceLabel;
  /** Canonical schema version this step migrated to. */
  to: SupportedTrainerSchemaVersion;
  /** Stable identifier for the step that ran (for diagnostics/logging). */
  id: string;
}

export interface MigrationSuccess {
  success: true;
  definition: SolithDefinitionV1;
  sourceVersion: TrainerDefinitionSourceLabel;
  targetVersion: SupportedTrainerSchemaVersion;
  /** Ordered list of migration steps that actually ran; empty if input was already current. */
  migrationsApplied: MigrationStepReport[];
  warnings: string[];
}

export type MigrationFailureReason =
  | 'MALFORMED'
  | 'UNKNOWN_FUTURE_VERSION'
  | 'LEGACY_INPUT_INVALID'
  | 'SCHEMA_VALIDATION_FAILED';

export interface MigrationFailure {
  success: false;
  reason: MigrationFailureReason;
  /** Best-effort source label, when it could be determined before failure. */
  sourceVersion: TrainerDefinitionSourceLabel | 'UNKNOWN';
  errors: string[];
}

export type MigrationOutcome = MigrationSuccess | MigrationFailure;
