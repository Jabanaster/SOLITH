/**
 * Game Profile System — Milestone H
 *
 * Entry point for the data-driven game profile system.
 */

export type { GameProfile, ProfileControl, ProfileValidationError } from './types.js';
export { validateGameProfile } from './types.js';
// Pure transforms (renderer-safe, no fs).
export {
  profileControlToTrainerControl,
  loadTrainerControls,
} from './transform.js';
// fs-backed loaders (Node / main process / tests only).
export {
  loadGameProfile,
  loadStardewProfile,
} from './loader.js';
export {
  validateProfileAuthoringWorkflow,
  type ProfileAuthoringFixtureEvidence,
  type ProfileAuthoringValidationInput,
  type ProfileAuthoringValidationReport,
} from './authoring.js';
export {
  BUNDLED_GAME_PROFILE_CATALOG,
  getBundledGameProfileCatalog,
  getBundledGameProfileCatalogEntry,
  validateBundledGameProfileCatalog,
  validateGameProfileCatalogEntry,
  type GameProfileCatalogEntry,
  type GameProfileCatalogValidationError,
  type ProfileEvidenceLevel,
  type ProfileParserStatus,
  type ProfileSupportStatus,
  type ProfileUnsupportedReason,
  type ProfileWriteSupportStatus,
} from './catalog.js';
export {
  reviewGameProfileExchange,
  type GameProfileExchangeReview,
  type ProfileExchangeDirection,
  type ProfileExchangeStatus,
} from './review.js';
export {
  createSupportMatrixReport,
  renderSupportMatrix,
  renderSupportMatrixJson,
  renderSupportMatrixMarkdown,
  type BackupRollbackReadiness,
  type SupportMatrixFixtureCoverage,
  type SupportMatrixFormat,
  type SupportMatrixReport,
  type SupportMatrixRow,
} from './support-matrix.js';
