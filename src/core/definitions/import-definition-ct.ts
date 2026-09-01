import type { TrainerCatalogEntry } from '../trainer-catalog/types.js';
import { buildSearchableText } from '../trainer-catalog/types.js';
import { upsertCatalogEntry, upsertDefinitionPayload } from '../trainer-catalog/store.js';
import { parseCheatTableXml, type CtImportResult } from './ct-import.js';
import { parseCheatTableMetadata } from './ct-metadata.js';
import { analyzeCheatTableScripts, buildScriptResearchNotes } from '../script-research/ct-script-research.js';
import { solithDefinitionToModPack } from './mod-pack-adapter.js';
import { validateXmlSafety } from '../adapters/xml.js';

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
  metadataImport?: boolean;
  scriptOnlyCount?: number;
  scriptAnalysisCount?: number;
}

export interface ImportCtFailure {
  success: false;
  errors: string[];
  rejected?: CtImportResult['rejected'];
}

export interface PreviewCtOutcome extends ImportCtOutcome {
  previewOnly: true;
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
  // Finding 1 (independent security review, ef254d1): this is the true
  // top-level entry point for the fallback/metadata import path. Validate
  // once, before ANY parser (main table, metadata fallback, script-research)
  // touches the raw XML. accepted.length === 0 must never be treated as
  // proof the document was safe — it only means "no supported pointer
  // entries", which is also true for a rejected/unsafe document.
  const safety = validateXmlSafety(xmlText);
  if (!safety.safe) {
    return { success: false, errors: [`xml_safety_violation:${safety.error ?? 'unknown'}`] };
  }

  const parsed = await parseCheatTableXml(xmlText, options);

  if (parsed.accepted.length === 0) {
    const metadata = await parseCheatTableMetadata(xmlText, {
      title: options.title,
      executables: options.title?.toLowerCase().includes('crimson') ? ['CrimsonDesert.exe'] : undefined,
      pointerImportAccepted: parsed.accepted.length,
      sourceNote:
        'Metadata extracted from community Cheat Engine table. Auto Assembler entries are reference-only in Solith until pointer paths are verified.',
    });

    if (metadata.entries.length === 0) {
      if (parsed.errors.length > 0) {
        return { success: false, errors: parsed.errors, rejected: parsed.rejected };
      }
      return {
        success: false,
        errors: ['no_importable_ct_entries'],
        rejected: parsed.rejected,
      };
    }

    const { definition } = metadata;
    const scriptReport = await analyzeCheatTableScripts(xmlText, {
      title: definition.title,
      executable: definition.target.executables[0],
    });
    const payloadJson = JSON.stringify(definition);
    const modPack = solithDefinitionToModPack(definition);
    modPack.notes = buildScriptResearchNotes(scriptReport);
    const categories = [...new Set((definition.memoryFeatures ?? []).map((f) => f.category))];

    upsertDefinitionPayload(
      modPack.packId,
      definition.id,
      payloadJson,
      definition.safety.verificationStatus,
      'ct-import',
      modPack.syncedAt,
    );
    upsertCatalogEntry({
      catalogGameId: definition.id,
      displayName: definition.title,
      executables: definition.target.executables,
      categories,
      verificationStatus: definition.safety.verificationStatus,
      sources: [{ provider: 'ct-import', url: 'local://imported-ct-metadata' }],
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
      cheatCount: modPack.cheats.length,
      title: definition.title,
      acceptedCount: 0,
      rejectedCount: parsed.rejected.length,
      rejected: parsed.rejected,
      validationErrors: parsed.errors,
      metadataImport: true,
      scriptOnlyCount: metadata.scriptOnlyCount,
      scriptAnalysisCount: scriptReport.analyzedScripts,
    };
  }

  const scriptReport = await analyzeCheatTableScripts(xmlText, {
    title: options.title,
    executable: parsed.definition.target.executables[0],
  });
  const { definition } = parsed;
  const payloadJson = JSON.stringify(definition);
  const modPack = solithDefinitionToModPack(definition);
  modPack.notes = buildScriptResearchNotes(scriptReport);

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
    scriptAnalysisCount: scriptReport.analyzedScripts,
  };
}

export async function previewDefinitionCt(
  xmlText: string,
  options: { title?: string } = {},
): Promise<PreviewCtOutcome | ImportCtFailure> {
  // See importDefinitionCt above — same authoritative boundary applies to preview.
  const safety = validateXmlSafety(xmlText);
  if (!safety.safe) {
    return { success: false, errors: [`xml_safety_violation:${safety.error ?? 'unknown'}`] };
  }

  const parsed = await parseCheatTableXml(xmlText, options);

  if (parsed.accepted.length === 0) {
    const metadata = await parseCheatTableMetadata(xmlText, {
      title: options.title,
      executables: options.title?.toLowerCase().includes('crimson') ? ['CrimsonDesert.exe'] : undefined,
      pointerImportAccepted: parsed.accepted.length,
      sourceNote:
        'Metadata extracted from community Cheat Engine table. Auto Assembler entries are reference-only in Solith until pointer paths are verified.',
    });

    if (metadata.entries.length === 0) {
      if (parsed.errors.length > 0) {
        return { success: false, errors: parsed.errors, rejected: parsed.rejected };
      }
      return {
        success: false,
        errors: ['no_importable_ct_entries'],
        rejected: parsed.rejected,
      };
    }

    const { definition } = metadata;
    const scriptReport = await analyzeCheatTableScripts(xmlText, {
      title: definition.title,
      executable: definition.target.executables[0],
    });
    const modPack = solithDefinitionToModPack(definition);
    return {
      success: true,
      previewOnly: true,
      catalogGameId: definition.id,
      packId: modPack.packId,
      cheatCount: modPack.cheats.length,
      title: definition.title,
      acceptedCount: 0,
      rejectedCount: parsed.rejected.length,
      rejected: parsed.rejected,
      validationErrors: parsed.errors,
      metadataImport: true,
      scriptOnlyCount: metadata.scriptOnlyCount,
      scriptAnalysisCount: scriptReport.analyzedScripts,
    };
  }

  const scriptReport = await analyzeCheatTableScripts(xmlText, {
    title: options.title,
    executable: parsed.definition.target.executables[0],
  });
  const { definition } = parsed;
  const modPack = solithDefinitionToModPack(definition);
  return {
    success: true,
    previewOnly: true,
    catalogGameId: definition.id,
    packId: modPack.packId,
    cheatCount: modPack.cheats.length,
    title: definition.title,
    acceptedCount: parsed.accepted.length,
    rejectedCount: parsed.rejected.length,
    rejected: parsed.rejected,
    validationErrors: parsed.errors,
    scriptAnalysisCount: scriptReport.analyzedScripts,
  };
}
