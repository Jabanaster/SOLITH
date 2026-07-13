import fs from 'node:fs';
import path from 'node:path';
import { solithDefinitionToModPack } from '../definitions/mod-pack-adapter.js';
import { upsertCatalogEntry, upsertDefinitionPayload } from '../trainer-catalog/store.js';
import { buildSearchableText } from '../trainer-catalog/types.js';
import {
  buildDumpspaceImportSummary,
  buildDumpspaceResearchNotes,
  buildSolithDefinitionFromDumpspace,
} from '../ue-research/dumpspace-import.js';

function readIfExists(filePath: string): string | undefined {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : undefined;
  } catch {
    return undefined;
  }
}

export interface ImportDumpspaceOutcome {
  success: true;
  catalogGameId: string;
  packId: string;
  cheatCount: number;
  title: string;
  classCount: number;
  structCount: number;
  offsetCount: number;
  notes: string[];
}

export interface ImportDumpspaceFailure {
  success: false;
  errors: string[];
}

export function importDefinitionDumpspace(input: {
  dumpspaceDir: string;
  title: string;
  executable: string;
}): ImportDumpspaceOutcome | ImportDumpspaceFailure {
  const root = path.resolve(input.dumpspaceDir);
  const offsetsJson = readIfExists(path.join(root, 'OffsetsInfo.json'));
  const classesJson = readIfExists(path.join(root, 'ClassesInfo.json'));
  const structsJson = readIfExists(path.join(root, 'StructsInfo.json'));

  if (!offsetsJson && !classesJson && !structsJson) {
    return {
      success: false,
      errors: [
        'No Dumpspace JSON found. Expected OffsetsInfo.json and/or ClassesInfo.json under the selected folder.',
      ],
    };
  }

  const summary = buildDumpspaceImportSummary({
    title: input.title,
    executable: input.executable,
    offsetsJson,
    classesJson,
    structsJson,
  });

  if (summary.cheatCandidates.length === 0 && summary.ueOffsets.length === 0) {
    return { success: false, errors: ['Dumpspace folder parsed but no offsets or cheat-relevant members were found.'] };
  }

  const definition = buildSolithDefinitionFromDumpspace({
    title: input.title,
    executable: input.executable,
    summary,
  });

  const modPack = solithDefinitionToModPack(definition);
  modPack.notes = buildDumpspaceResearchNotes(summary);

  upsertDefinitionPayload(
    modPack.packId,
    definition.id,
    JSON.stringify(definition),
    definition.safety.verificationStatus,
    'ct-import',
    modPack.syncedAt,
  );

  const categories = [...new Set((definition.memoryFeatures ?? []).map((f) => f.category))];
  upsertCatalogEntry({
    catalogGameId: definition.id,
    displayName: definition.title,
    executables: definition.target.executables,
    categories,
    verificationStatus: definition.safety.verificationStatus,
    sources: [{ provider: 'ct-import', url: `local://dumpspace/${root}` }],
    hasModPack: true,
    modPackId: modPack.packId,
    cheatCount: definition.memoryFeatures?.length ?? 0,
    searchableText: buildSearchableText({
      displayName: definition.title,
      executables: definition.target.executables,
      categories,
    }),
  });

  return {
    success: true,
    catalogGameId: definition.id,
    packId: modPack.packId,
    cheatCount: definition.memoryFeatures?.length ?? 0,
    title: definition.title,
    classCount: summary.classCount,
    structCount: summary.structCount,
    offsetCount: summary.ueOffsets.length,
    notes: modPack.notes,
  };
}
