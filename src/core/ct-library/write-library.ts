import { promises as fs } from 'node:fs';
import path from 'node:path';
import { compileCtZipArchive, type CompileCtZipOptions, type CtZipCatalogIndex } from '../registry/compile-ct-zip.js';
import { buildCtLibraryIndex, summarizeCtLibraryIndex } from './index.js';
import type { CtLibraryIndex, CtLibrarySummaryIndex } from './types.js';

export interface CompileCtLibraryArchiveOptions extends CompileCtZipOptions {
  libraryOutputPath: string;
  shardDirectory: string;
  maxShardBytes?: number;
  fullLibraryOutputPath?: string;
}

export type WriteCtLibraryIndexOptions = Pick<
  CompileCtLibraryArchiveOptions,
  'libraryOutputPath' | 'shardDirectory' | 'maxShardBytes' | 'fullLibraryOutputPath'
> & {
  shardReferenceDirectory?: string;
};

export interface CompileCtLibraryArchiveResult {
  index: CtZipCatalogIndex;
  library: CtLibraryIndex;
  summary: CtLibrarySummaryIndex;
  libraryOutputPath: string;
  shardDirectory: string;
  shards: NonNullable<CtLibrarySummaryIndex['shards']>;
}

function slugId(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function relativePath(fromDirectory: string, targetPath: string): string {
  return path.relative(fromDirectory, targetPath).replace(/\\/g, '/');
}

export async function writeCtLibraryIndex(
  index: CtZipCatalogIndex,
  options: WriteCtLibraryIndexOptions,
): Promise<CompileCtLibraryArchiveResult> {
  const maxShardBytes = options.maxShardBytes ?? 25 * 1024 * 1024;
  const library = buildCtLibraryIndex(index);
  const summaryDirectory = path.dirname(options.libraryOutputPath);
  const shards: NonNullable<CtLibrarySummaryIndex['shards']> = [];

  await fs.mkdir(options.shardDirectory, { recursive: true });
  for (const game of library.games) {
    const tables = library.tables.filter((table) => slugId(table.game, 'game') === game.gameId);
    const chunks: typeof tables[] = [];
    let current: typeof tables = [];
    let currentBytes = 0;
    for (const table of tables) {
      const tableBytes = Buffer.byteLength(JSON.stringify(table), 'utf8') + 2;
      if (current.length > 0 && currentBytes + tableBytes > maxShardBytes) {
        chunks.push(current);
        current = [table];
        currentBytes = tableBytes;
      } else {
        current.push(table);
        currentBytes += tableBytes;
      }
    }
    if (current.length > 0) chunks.push(current);

    for (const [chunkIndex, chunkTables] of chunks.entries()) {
      const shardName =
        chunks.length === 1
          ? `${game.gameId}.ct-library.json`
          : `${game.gameId}.part-${String(chunkIndex + 1).padStart(3, '0')}.ct-library.json`;
      const shardPath = path.join(options.shardDirectory, shardName);
      await fs.writeFile(
        shardPath,
        JSON.stringify(
          {
            schemaVersion: 1,
            generatedAt: library.generatedAt,
            safety: library.safety,
            game,
            part: chunks.length === 1 ? undefined : { index: chunkIndex + 1, total: chunks.length },
            tables: chunkTables,
          },
          null,
          2,
        ),
        'utf8',
      );
      shards.push({
        gameId: game.gameId,
        displayName: game.displayName,
        tableCount: chunkTables.length,
        cheatCount: chunkTables.reduce((count, table) => count + table.cheats.length, 0),
        path: relativePath(
          process.cwd(),
          path.join(options.shardReferenceDirectory ?? options.shardDirectory, shardName),
        ),
      });
    }
  }

  const summary = summarizeCtLibraryIndex(library, {
    shardDirectory: relativePath(
      summaryDirectory,
      options.shardReferenceDirectory ?? options.shardDirectory,
    ),
    shards,
  });
  await fs.mkdir(summaryDirectory, { recursive: true });
  await fs.writeFile(options.libraryOutputPath, JSON.stringify(summary, null, 2), 'utf8');

  if (options.fullLibraryOutputPath) {
    await fs.mkdir(path.dirname(options.fullLibraryOutputPath), { recursive: true });
    await fs.writeFile(options.fullLibraryOutputPath, JSON.stringify(library, null, 2), 'utf8');
  }

  return {
    index,
    library,
    summary,
    libraryOutputPath: options.libraryOutputPath,
    shardDirectory: options.shardDirectory,
    shards,
  };
}

export async function compileCtLibraryArchive(
  zipPath: string,
  options: CompileCtLibraryArchiveOptions,
): Promise<CompileCtLibraryArchiveResult> {
  const index = await compileCtZipArchive(zipPath, options);
  return writeCtLibraryIndex(index, options);
}
