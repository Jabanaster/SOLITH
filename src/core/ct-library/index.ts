import { slugifyGameId } from '../trainer-catalog/types.js';
import type { CtZipCatalogIndex } from '../registry/compile-ct-zip.js';
import type { CtLibraryGameSummary, CtLibraryIndex, CtLibrarySource, CtLibrarySummaryIndex } from './types.js';

function gameSummaryFromTables(tables: CtZipCatalogIndex['tables']): CtLibraryGameSummary[] {
  const byGame = new Map<string, CtLibraryGameSummary>();
  for (const table of tables) {
    const gameId = slugifyGameId(table.game);
    const current =
      byGame.get(gameId) ??
      ({
        gameId,
        displayName: table.game,
        tableCount: 0,
        cheatCount: 0,
        pointerCount: 0,
        scriptCount: 0,
        aobSignatureCount: 0,
        warningCount: 0,
        rejectionCount: 0,
        sourceTables: [],
      } satisfies CtLibraryGameSummary);

    current.tableCount += 1;
    current.cheatCount += table.cheats.length;
    current.pointerCount += table.counts.pointers;
    current.scriptCount += table.counts.scripts;
    current.aobSignatureCount += table.counts.aobSignatures;
    current.warningCount += table.counts.warnings;
    current.rejectionCount += table.counts.rejections;
    current.sourceTables.push(table.archivePath);
    byGame.set(gameId, current);
  }

  return [...byGame.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function buildCtLibraryIndex(compiledZip: CtZipCatalogIndex): CtLibraryIndex {
  const source: CtLibrarySource = {
    kind: 'zip-archive',
    path: compiledZip.sourceArchive.path,
    sha256: compiledZip.sourceArchive.sha256,
  };

  return {
    schemaVersion: 1,
    source,
    generatedAt: compiledZip.generatedAt,
    safety: {
      executableScripts: false,
      memoryWrites: false,
      processAttach: false,
      certificationLevel: 'L0',
      verificationStatus: 'metadata-only',
    },
    totals: compiledZip.totals,
    games: gameSummaryFromTables(compiledZip.tables),
    tables: compiledZip.tables,
  };
}

export function summarizeCtLibraryIndex(
  library: CtLibraryIndex,
  options: {
    shardDirectory?: string;
    shards?: CtLibrarySummaryIndex['shards'];
  } = {},
): CtLibrarySummaryIndex {
  return {
    schemaVersion: library.schemaVersion,
    source: library.source,
    generatedAt: library.generatedAt,
    safety: library.safety,
    totals: library.totals,
    games: library.games,
    shardDirectory: options.shardDirectory,
    shards: options.shards,
  };
}

export * from './types.js';
export * from './search.js';
