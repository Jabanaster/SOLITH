import type { TrainerCatalogEntry } from '../trainer-catalog/types.js';
import { buildSearchableText } from '../trainer-catalog/types.js';
import { upsertCatalogEntry } from '../trainer-catalog/store.js';
import type { SolithDefinitionV1 } from './schema.v1.js';
import { compileYamlToDefinition } from './compile-yaml.v1.js';
import { solithDefinitionToModPack } from './mod-pack-adapter.js';
import { persistTrainerDefinition } from '../trainer-storage/index.js';

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

function catalogEntryFromDefinition(definition: SolithDefinitionV1, cheatCount: number, packId: string): TrainerCatalogEntry {
  const categories = [
    ...new Set([
      ...(definition.memoryFeatures ?? []).map((f) => f.category),
      ...(definition.saveEditor?.saveFields ?? []).map((f) => f.category),
    ]),
  ];
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
 * Compile YAML, validate schema.v1, and persist through the canonical
 * trainer-storage repository (P4-8/P4-9). Previously this wrote directly via
 * `upsertDefinitionPayload` using the bundled-convention packId
 * (`${id}-pack`) regardless of source, which meant a user-imported YAML for
 * a game that already had a bundled definition would silently overwrite it
 * at the same packId — `persistTrainerDefinition` source-suffixes the packId
 * for non-bundled providers instead, so the import gets its own row and the
 * bundled row (if any) is preserved and surfaced via provenance.conflictingSources.
 */
export function importDefinitionYaml(yamlText: string): ImportYamlOutcome {
  const compiled = compileYamlToDefinition(yamlText);
  if (compiled.success === false) {
    return { success: false, errors: compiled.errors };
  }

  const { definition, payloadJson } = compiled;
  const modPack = solithDefinitionToModPack(definition);

  const persisted = persistTrainerDefinition(definition, { sourceProvider: 'user' });
  if (persisted.success === false) {
    return { success: false, errors: [persisted.error.message] };
  }

  upsertCatalogEntry(catalogEntryFromDefinition(definition, modPack.cheats.length, persisted.value.packId));

  return {
    success: true,
    definition,
    payloadJson,
    catalogGameId: definition.id,
    packId: persisted.value.packId,
    cheatCount: modPack.cheats.length,
  };
}
