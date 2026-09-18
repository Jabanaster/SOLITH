/**
 * Store-backed schema.v1 definition loader (Electron / Node only).
 *
 * Pure capability helpers live in catalog-definition-capabilities.ts so the
 * Vite renderer never pulls sql.js / app-paths / node:fs through this module.
 *
 * P4-8: delegates to the canonical trainer-storage repository
 * (src/core/trainer-storage/) instead of doing its own raw
 * getDefinitionPayload/getModPackForGame + ad-hoc payload-shape check. Every
 * definition this module returns has been through the P4-2 migration
 * pipeline (version-detected, migrated, schema-validated) and — when more
 * than one trainer_mod_packs row exists for the game — deterministically
 * conflict-resolved (see src/core/trainer-storage/source-priority.ts)
 * instead of silently trusting whichever row happened to sync most
 * recently.
 */
import { getCanonicalTrainerDefinition, type StorageResult, type CanonicalTrainerRecord } from '../trainer-storage/index.js';
import type { SolithDefinitionV1 } from './schema.v1.js';
import {
  catalogDefinitionCapabilities,
  type CatalogDefinitionCapabilities,
} from './catalog-definition-capabilities.js';

export type {
  SaveEditCapability,
  LiveMemoryCapability,
  InjectionCapability,
  CatalogDefinitionCapabilities,
} from './catalog-definition-capabilities.js';

export {
  catalogDefinitionCapabilities,
  describeCapabilityLanes,
} from './catalog-definition-capabilities.js';

/**
 * Full canonical result (definition + provenance), or the typed failure —
 * for callers that want to distinguish "no definition exists" from "a
 * definition exists but is corrupt/unsupported" instead of collapsing both
 * to null.
 */
export function loadCatalogDefinitionResult(catalogGameId: string): StorageResult<CanonicalTrainerRecord> {
  return getCanonicalTrainerDefinition(catalogGameId);
}

/**
 * Load a schema.v1 definition from catalog storage. Preserves the existing
 * nullable-return shape every current caller expects (chains B/D/E in the
 * P4-8 persistence audit) — NOT_FOUND and any record-level failure
 * (corrupt/unsupported payload) both collapse to `null` here, same as the
 * pre-P4-8 behavior for a missing definition. Callers that need to tell
 * those cases apart should use `loadCatalogDefinitionResult` instead.
 */
export function loadCatalogDefinition(catalogGameId: string): SolithDefinitionV1 | null {
  const result = getCanonicalTrainerDefinition(catalogGameId);
  return result.success ? result.value.definition : null;
}

/** Convenience: capabilities for a catalog id, or null when no definition payload exists. */
export function getCatalogDefinitionCapabilities(
  catalogGameId: string,
): CatalogDefinitionCapabilities | null {
  const definition = loadCatalogDefinition(catalogGameId);
  if (!definition) return null;
  return catalogDefinitionCapabilities(definition);
}
