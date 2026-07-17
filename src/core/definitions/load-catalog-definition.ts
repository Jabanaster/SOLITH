/**
 * Store-backed schema.v1 definition loader (Electron / Node only).
 *
 * Pure capability helpers live in catalog-definition-capabilities.ts so the
 * Vite renderer never pulls sql.js / app-paths / node:fs through this module.
 */
import { getDefinitionPayload, getModPackForGame } from '../trainer-catalog/store.js';
import { modPackToSolithDefinition } from './mod-pack-adapter.js';
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

/** Load a schema.v1 definition from catalog storage (native JSON or adapted mod pack). */
export function loadCatalogDefinition(catalogGameId: string): SolithDefinitionV1 | null {
  const payload = getDefinitionPayload(catalogGameId);
  if (payload) return payload;

  const pack = getModPackForGame(catalogGameId);
  if (!pack) return null;
  return modPackToSolithDefinition(pack);
}

/** Convenience: capabilities for a catalog id, or null when no definition payload exists. */
export function getCatalogDefinitionCapabilities(
  catalogGameId: string,
): CatalogDefinitionCapabilities | null {
  const definition = loadCatalogDefinition(catalogGameId);
  if (!definition) return null;
  return catalogDefinitionCapabilities(definition);
}
