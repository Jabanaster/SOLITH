import type { TrainerCatalogEntry } from '../trainer-catalog/types.js';
import { buildSearchableText } from '../trainer-catalog/types.js';
import { upsertCatalogEntry, upsertDefinitionPayload } from '../trainer-catalog/store.js';
import type { SolithDefinitionV1 } from './schema.v1.js';
import { compileYamlToDefinition } from './compile-yaml.v1.js';
import { solithDefinitionToModPack } from './mod-pack-adapter.js';

export interface ImportYamlResult {
  success: true;
  definition: SolithDefinitionV1;
  payloadJson: string;
  catalogGameId: string;
  packId: string;
  cheatCount: number;
}

export interface ImportYamlFailure {
  success: false;
  errors: string[];
}

export type ImportYamlOutcome = ImportYamlResult | ImportYamlFailure;

function catalogEntryFromDefinition(definition: SolithDefinitionV1, cheatCount: number): TrainerCatalogEntry {
  const categories = [
    ...new Set([
      ...(definition.memoryFeatures ?? []).map((f) => f.category),
      ...(definition.saveEditor?.saveFields ?? []).map((f) => f.category),
    ]),
  ];
  const packId = `${definition.id}-pack`;
  return {
    catalogGameId: definition.id,
    displayName: definition.title,
    executables: definition.target.executables,
    categories,
    verificationStatus: definition.safety.verificationStatus,
    sources: [{ provider: 'user', url: 'local://imported-definition' }],
    hasModPack: cheatCount > 0,
    modPackId: packId,
    cheatCount,
    searchableText: buildSearchableText({
      displayName: definition.title,
      executables: definition.target.executables,
      categories,
    }),
  };
}

/**
 * Compile YAML, validate schema.v1, and upsert catalog index + definition payload.
 * Stores minified schema.v1 JSON in trainer_mod_packs.payloadJson.
 */
export function importDefinitionYaml(yamlText: string): ImportYamlOutcome {
  const compiled = compileYamlToDefinition(yamlText);
  if (!compiled.success) {
    return { success: false, errors: compiled.errors };
  }

  const { definition, payloadJson } = compiled;
  const modPack = solithDefinitionToModPack(definition);

  upsertDefinitionPayload(
    modPack.packId,
    definition.id,
    payloadJson,
    definition.safety.verificationStatus,
    'user',
    modPack.syncedAt,
  );

  upsertCatalogEntry(catalogEntryFromDefinition(definition, modPack.cheats.length));

  return {
    success: true,
    definition,
    payloadJson,
    catalogGameId: definition.id,
    packId: modPack.packId,
    cheatCount: modPack.cheats.length,
  };
}
