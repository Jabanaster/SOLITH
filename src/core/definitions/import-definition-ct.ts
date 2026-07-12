import type { TrainerCatalogEntry } from '../trainer-catalog/types.js';
import { buildSearchableText } from '../trainer-catalog/types.js';
import { upsertCatalogEntry, upsertDefinitionPayload } from '../trainer-catalog/store.js';
import { parseCheatTableXml, type CtImportResult } from './ct-import.js';
import { solithDefinitionToModPack } from './mod-pack-adapter.js';

export interface ImportCtOutcome {
  success: true;
  catalogGameId: string;
  packId: string;
  cheatCount: number;
  title: string;
  acceptedCount: number;
  rejectedCount: number;
  rejected: CtImportResult['rejected'];
  validationErrors: string[];
}

export interface ImportCtFailure {
  success: false;
  errors: string[];
  rejected?: CtImportResult['rejected'];
}

function catalogEntryFromImport(result: CtImportResult): TrainerCatalogEntry {
  const definition = result.definition;
  const categories = [...new Set((definition.memoryFeatures ?? []).map((f) => f.category))];
  const packId = `${definition.id}-pack`;
  return {
    catalogGameId: definition.id,
    displayName: definition.title,
    executables: definition.target.executables,
    categories,
    verificationStatus: definition.safety.verificationStatus,
    sources: [{ provider: 'ct-import', url: 'local://imported-ct' }],
    hasModPack: (definition.memoryFeatures?.length ?? 0) > 0,
    modPackId: packId,
    cheatCount: definition.memoryFeatures?.length ?? 0,
    searchableText: buildSearchableText({
      displayName: definition.title,
      executables: definition.target.executables,
      categories,
    }),
  };
}

export async function importDefinitionCt(xmlText: string, options: { title?: string } = {}): Promise<ImportCtOutcome | ImportCtFailure> {
  const parsed = await parseCheatTableXml(xmlText, options);
  if (parsed.errors.length > 0 && parsed.accepted.length === 0) {
    return { success: false, errors: parsed.errors, rejected: parsed.rejected };
  }

  const { definition } = parsed;
  const payloadJson = JSON.stringify(definition);
  const modPack = solithDefinitionToModPack(definition);

  upsertDefinitionPayload(
    modPack.packId,
    definition.id,
    payloadJson,
    definition.safety.verificationStatus,
    'ct-import',
    modPack.syncedAt,
  );
  upsertCatalogEntry(catalogEntryFromImport(parsed));

  return {
    success: true,
    catalogGameId: definition.id,
    packId: modPack.packId,
    cheatCount: modPack.cheats.length,
    title: definition.title,
    acceptedCount: parsed.accepted.length,
    rejectedCount: parsed.rejected.length,
    rejected: parsed.rejected,
    validationErrors: parsed.errors,
  };
}
