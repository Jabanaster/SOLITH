export type {
  CanonicalGameId,
  CanonicalTrainerEntryId,
  WispActionDefinition,
  WispActionId,
  WispControlType,
  WispGameProfile,
  WispGroupDefinition,
  WispGroupId,
  WispPreset,
  WispProfileCompatibilityMetadata,
  WispProfileId,
  WispProfileProvenance,
  WispProfileRegistration,
  WispProfileRegistryQuery,
  WispProfileSchemaVersion,
  WispProfileSource,
  WispProfileValidationResult,
} from './types.js';
export type { WispProfileValidationErrorCode, WispProfileValidationIssue } from './errors.js';
export { WISP_PROFILE_LIMITS } from './limits.js';
export { WISP_PROFILE_SCHEMA_VERSION, WISP_SUPPORTED_PROFILE_SCHEMA_VERSIONS } from './schema.js';
export type { WispProfileMigration } from './migrations.js';
export { WISP_PROFILE_MIGRATIONS, migrateWispProfileToCurrentVersion } from './migrations.js';
export { validateWispGameProfile } from './validation.js';
export type { WispProfileValidation } from './validation.js';
export { createWispProfileRegistry } from './registry.js';
export type { WispProfileRegistry } from './registry.js';
