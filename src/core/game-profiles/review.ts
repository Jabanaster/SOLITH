import {
  validateProfileAuthoringWorkflow,
  type ProfileAuthoringValidationInput,
  type ProfileAuthoringValidationReport,
} from './authoring.js';
import {
  validateGameProfileCatalogEntry,
  type GameProfileCatalogEntry,
  type GameProfileCatalogValidationError,
} from './catalog.js';
import type { ProfileValidationError } from './types.js';

export type ProfileExchangeDirection = 'import' | 'export';
export type ProfileExchangeStatus = 'supported' | 'preview-only' | 'blocked';

export interface GameProfileExchangeReview {
  direction: ProfileExchangeDirection;
  status: ProfileExchangeStatus;
  catalogEntry: GameProfileCatalogEntry;
  catalogErrors: GameProfileCatalogValidationError[];
  authoring: ProfileAuthoringValidationReport;
  importSupported: boolean;
  exportSupported: boolean;
  blockedReasons: string[];
  warnings: ProfileValidationError[];
}

export function reviewGameProfileExchange(
  catalogEntry: GameProfileCatalogEntry,
  input: Omit<ProfileAuthoringValidationInput, 'profile'> = {},
): GameProfileExchangeReview {
  const catalogErrors = validateGameProfileCatalogEntry(catalogEntry);
  const authoring = validateProfileAuthoringWorkflow({
    ...input,
    profile: catalogEntry.profile,
  });
  const importSupported = authoring.supportedOperations.includes('save_field_read') || authoring.supportedOperations.includes('inspect');
  const exportSupported = authoring.supportedOperations.includes('save_field_write') && catalogEntry.writeSupportStatus === 'supported';
  const blockedReasons = [
    ...catalogEntry.unsupportedReasons.map(reason => `catalog:${reason}`),
    ...authoring.blockedOperations.map(operation => `save-format:${operation}`),
    ...authoring.errors.map(error => `authoring:${error.field}`),
  ].sort((a, b) => a.localeCompare(b));

  return {
    direction: 'import',
    status: catalogEntry.supportStatus === 'supported'
      ? 'supported'
      : catalogEntry.supportStatus === 'blocked'
        ? 'blocked'
        : 'preview-only',
    catalogEntry,
    catalogErrors,
    authoring,
    importSupported,
    exportSupported,
    blockedReasons,
    warnings: authoring.warnings,
  };
}
