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

// Increment 2 — persistence, user state, and the deterministic resolver.
export type { WispUserOverride, WispUserState, WispUserStateValidation } from './user-state-schema.js';
export { WISP_USER_STATE_SCHEMA_VERSION, WISP_SUPPORTED_USER_STATE_SCHEMA_VERSIONS, validateWispUserState } from './user-state-schema.js';
export type { WispPersistenceError, WispPersistenceErrorCode } from './persistence-errors.js';
export { persistenceError } from './persistence-errors.js';
export type { WispLoadUserStateResult, WispSaveUserStateResult } from './persistence.js';
export { loadUserState, saveUserState, deleteUserState } from './persistence.js';
export type { WispResolutionContext, WispResolutionDiagnostic, WispResolutionDiagnosticCode, WispProfileResolutionResult } from './resolution-types.js';
export { WISP_DEFAULT_SOURCE_PRECEDENCE, isEligibleForAutomaticPrecedence, isProfileApplicable, specificityScore, compareCandidates } from './resolution-policy.js';
export { resolveWispProfile } from './profile-resolver.js';
export {
  resolveWispProfileForGame,
  selectWispProfile,
  saveWispUserOverride,
  clearWispUserOverride,
  clearWispSelectedProfile,
  resetWispUserState,
} from './user-state-service.js';

// Increment 3 — runtime trainer-entry binding + session isolation. No execution yet.
export type { WispBindingDiagnostic, WispBindingDiagnosticCode } from './binding-errors.js';
export { bindingDiagnostic } from './binding-errors.js';
export type {
  BoundWispAction,
  BoundWispGroup,
  BoundWispProfile,
  WispActionAvailability,
  WispBoundEntryDescriptor,
  WispProfileBindingResult,
  WispRuntimeBinding,
  WispRuntimeContext,
} from './runtime-types.js';
export type { WispTrainerEntryLookup } from './entry-lookup.js';
export { bindResolvedProfile, revalidateBoundAction } from './profile-binder.js';
export type { WispBindingValidationResult } from './binding-validation.js';
export { validateWispBinding } from './binding-validation.js';
export type { WispRuntimeBindingRegistry } from './binding-registry.js';
export { createWispRuntimeBindingRegistry } from './binding-registry.js';
export type { WispRawAttachIdentity, WispSessionContextProvider, WispSessionGenerationTracker } from './session-context.js';
export { createWispSessionGenerationTracker } from './session-context.js';
export { createSessionMonitorContextProvider } from './session-monitor-context-provider.js';
export { createCheatSystemEntryLookup } from './cheat-system-entry-lookup.js';
