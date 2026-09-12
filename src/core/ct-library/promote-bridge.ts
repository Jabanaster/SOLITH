/**
 * Bridge from the read-only personal CT library (search.ts, browse-only) to
 * the existing promotion pipeline (ct-promote.ts) that already powers the
 * ad-hoc single-file CT import path. This is the missing link identified by
 * the native-readiness audit: library records could be browsed but never
 * promoted.
 *
 * Fail-closed by design: only kind='pointer' entries already classified
 * `liveResolution: 'resolvable'` by the existing classifier
 * (classifyCtLiveResolution, ct-live-resolution.ts) are converted. Every
 * other shape — script, Lua, AOB, absolute_only, incomplete, or malformed
 * fields — is refused with an explicit reason and never reaches
 * promoteCandidateFromCtEntry. No new resolver logic, no new trainer format:
 * this module only adapts field shapes and reuses promoteCandidateFromCtEntry
 * / buildLocalTrainerPack / buildLiveToggleCards verbatim.
 */
import type { CtImportEntry } from '../definitions/ct-import.js';
import type { CtLiveResolutionQuality } from '../definitions/ct-live-resolution.js';
import type { CtZipCatalogEntry } from '../registry/compile-ct-zip.js';
import { promoteCandidateFromCtEntry, buildLiveToggleCards, type CtPromoteCandidate, type LiveToggleCard } from '../live-memory/ct-promote.js';
import { buildLocalTrainerPack, type LocalTrainerPack } from '../live-memory/local-pack-export.js';

export type CtLibraryCheat = CtZipCatalogEntry['cheats'][number];

const VALID_DATA_TYPES = new Set(['int32', 'int64', 'float', 'double', 'byte']);
const HEX_OFFSET_RE = /^0x[0-9a-f]+$/i;

export type CtLibraryPromotionRefusalReason =
  | 'Lua script — execution not supported'
  | 'Script-dependent (Auto Assembler) — execution not supported'
  | 'AOB signature — requires runtime scan, not yet supported'
  | 'Unknown resolver state'
  | 'Missing resolver metadata'
  | 'Incomplete pointer — missing module or offset'
  | 'Absolute/session-only address — not native-ready, cannot be frozen safely'
  | 'Missing module'
  | 'Malformed base offset'
  | 'Malformed pointer chain'
  | 'Missing or unsupported data type';

export type CtLibraryPromotionEvaluation =
  | { eligible: true; entry: CtImportEntry }
  | { eligible: false; reason: CtLibraryPromotionRefusalReason };

/**
 * Pure fail-closed classifier: does NOT recompute liveResolution — it trusts
 * (and only trusts) the value already stamped by classifyCtLiveResolution at
 * compile time (compile-ct-zip.ts), so this never duplicates resolver logic.
 */
export function evaluateCtLibraryEntryForPromotion(cheat: CtLibraryCheat): CtLibraryPromotionEvaluation {
  if (cheat.kind === 'script') {
    return {
      eligible: false,
      reason:
        cheat.metadata?.scriptType === 'lua'
          ? 'Lua script — execution not supported'
          : 'Script-dependent (Auto Assembler) — execution not supported',
    };
  }
  if (cheat.kind === 'aob') {
    return { eligible: false, reason: 'AOB signature — requires runtime scan, not yet supported' };
  }
  if (cheat.kind !== 'pointer') {
    return { eligible: false, reason: 'Unknown resolver state' };
  }

  const metadata = cheat.metadata;
  if (!metadata) {
    return { eligible: false, reason: 'Missing resolver metadata' };
  }

  const liveResolution = metadata.liveResolution as CtLiveResolutionQuality | undefined;
  if (liveResolution === 'incomplete' || liveResolution == null) {
    return { eligible: false, reason: 'Incomplete pointer — missing module or offset' };
  }
  if (liveResolution === 'absolute_only') {
    return { eligible: false, reason: 'Absolute/session-only address — not native-ready, cannot be frozen safely' };
  }
  if (liveResolution !== 'resolvable') {
    return { eligible: false, reason: 'Unknown resolver state' };
  }

  const moduleName = metadata.moduleName?.trim();
  if (!moduleName || moduleName.toLowerCase() === 'unknown-module.exe') {
    return { eligible: false, reason: 'Missing module' };
  }
  const baseOffset = metadata.baseOffset;
  if (!baseOffset || !HEX_OFFSET_RE.test(baseOffset)) {
    return { eligible: false, reason: 'Malformed base offset' };
  }
  const pointerChain = metadata.pointerChain;
  if (pointerChain !== undefined && (!Array.isArray(pointerChain) || pointerChain.some((n) => !Number.isFinite(n)))) {
    return { eligible: false, reason: 'Malformed pointer chain' };
  }
  const dataType = metadata.dataType;
  if (!dataType || !VALID_DATA_TYPES.has(dataType)) {
    return { eligible: false, reason: 'Missing or unsupported data type' };
  }

  const entry: CtImportEntry = {
    id: cheat.id,
    name: cheat.name,
    category: 'CT Library',
    dataType: dataType as CtImportEntry['dataType'],
    moduleName,
    rawAddress: metadata.rawAddress ?? `"${moduleName}"+${baseOffset.replace(/^0x/i, '')}`,
    baseOffset,
    pointerChain: pointerChain ?? [],
    showAsHex: metadata.showAsHex ?? false,
    liveResolution: 'resolvable',
  };

  return { eligible: true, entry };
}

export interface CtLibraryPromotionProvenance {
  gameId: string;
  gameDisplayName: string;
  tableName: string;
  archivePath: string;
  sourceSha256: string;
  cheatId: string;
  cheatName: string;
  moduleName: string;
  baseOffset?: string;
  pointerChain: number[];
  resolverClassification: CtLiveResolutionQuality;
}

export interface CtLibraryPromotionResult {
  provenance: CtLibraryPromotionProvenance;
  candidate: CtPromoteCandidate;
  trainerPack: LocalTrainerPack;
  card: LiveToggleCard;
}

export type CtLibraryPromotionAttempt =
  | { eligible: true; result: CtLibraryPromotionResult }
  | { eligible: false; reason: CtLibraryPromotionRefusalReason };

export interface CtLibraryPromotionGameContext {
  gameId: string;
  displayName: string;
}

export interface CtLibraryPromotionTableContext {
  tableName: string;
  archivePath: string;
  sourceSha256: string;
}

/**
 * Full bridge: library record -> adapter -> CtImportEntry ->
 * promoteCandidateFromCtEntry -> existing trainer definition (LocalTrainerPack)
 * -> buildLiveToggleCards -> Trainer Deck card model.
 *
 * Never attaches to a process, never writes memory, never executes scripts —
 * this only builds in-memory JS objects describing what *could* be promoted.
 */
export function promoteCtLibraryEntry(
  game: CtLibraryPromotionGameContext,
  table: CtLibraryPromotionTableContext,
  cheat: CtLibraryCheat,
): CtLibraryPromotionAttempt {
  const evaluation = evaluateCtLibraryEntryForPromotion(cheat);
  if (!evaluation.eligible) {
    return { eligible: false, reason: evaluation.reason };
  }

  const candidate = promoteCandidateFromCtEntry(evaluation.entry);

  const trainerPack = buildLocalTrainerPack({
    catalogGameId: game.gameId,
    title: game.displayName,
    mappings: [candidate],
    notes: `CT Library source: ${table.tableName} (${table.archivePath}), sha256=${table.sourceSha256}`,
  });

  const [card] = buildLiveToggleCards(trainerPack.mappings);

  const provenance: CtLibraryPromotionProvenance = {
    gameId: game.gameId,
    gameDisplayName: game.displayName,
    tableName: table.tableName,
    archivePath: table.archivePath,
    sourceSha256: table.sourceSha256,
    cheatId: cheat.id,
    cheatName: cheat.name,
    moduleName: evaluation.entry.moduleName,
    baseOffset: evaluation.entry.baseOffset,
    pointerChain: evaluation.entry.pointerChain,
    resolverClassification: evaluation.entry.liveResolution,
  };

  return { eligible: true, result: { provenance, candidate, trainerPack, card } };
}
