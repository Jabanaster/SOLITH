export {
  LEGACY_UNVERSIONED,
  SUPPORTED_TRAINER_SCHEMA_VERSIONS,
  type SupportedTrainerSchemaVersion,
  type TrainerDefinitionSourceLabel,
  type MigrationStepReport,
  type MigrationSuccess,
  type MigrationFailure,
  type MigrationFailureReason,
  type MigrationOutcome,
} from './types.js';
export { detectTrainerDefinitionVersion, type DetectedVersion } from './version-detect.js';
export { migrateLegacyUnversionedToV1, type LegacyMigrationOutcome } from './legacy-unversioned-migration.js';
export { migrateTrainerDefinition } from './migrate-trainer-definition.js';
