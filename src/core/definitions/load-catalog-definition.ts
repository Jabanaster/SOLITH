import { getDefinitionPayload, getModPackForGame } from '../trainer-catalog/store.js';
import { modPackToSolithDefinition } from './mod-pack-adapter.js';
import type { SolithDefinitionV1 } from './schema.v1.js';

/** Load a schema.v1 definition from catalog storage (native JSON or adapted mod pack). */
export function loadCatalogDefinition(catalogGameId: string): SolithDefinitionV1 | null {
  const payload = getDefinitionPayload(catalogGameId);
  if (payload) return payload;

  const pack = getModPackForGame(catalogGameId);
  if (!pack) return null;
  return modPackToSolithDefinition(pack);
}

export interface CatalogDefinitionCapabilities {
  catalogGameId: string;
  title: string;
  memoryCheatCount: number;
  saveControlCount: number;
  saveDirectoryHint?: string;
  saveFormat?: string;
  saveExtension?: string;
}

export function catalogDefinitionCapabilities(definition: SolithDefinitionV1): CatalogDefinitionCapabilities {
  const memoryCheatCount = definition.memoryFeatures?.length ?? 0;
  const saveControlCount = definition.saveEditor?.saveFields.length ?? 0;
  return {
    catalogGameId: definition.id,
    title: definition.title,
    memoryCheatCount,
    saveControlCount,
    saveDirectoryHint: definition.saveEditor?.defaultDirectory,
    saveFormat: definition.saveEditor?.format,
    saveExtension: definition.saveEditor?.extension,
  };
}
