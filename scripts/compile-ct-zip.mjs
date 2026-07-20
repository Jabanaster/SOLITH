#!/usr/bin/env node
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { buildCtLibraryIndex, summarizeCtLibraryIndex } from '../src/core/ct-library/index.ts';
import { compileCtZipArchive } from '../src/core/registry/compile-ct-zip.ts';

function slugId(value, fallback) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

const zipPath = process.argv[2];
if (!zipPath || zipPath.startsWith('--')) {
  console.error(
    'Usage: npm run registry:compile-ct-zip -- <archive.zip> [--out data/registry/personal-ct-catalog.json] [--registries data/registry/personal-ct] [--limit 100]',
  );
  process.exit(1);
}

const outputJsonPath = hasFlag('--no-registry-index')
  ? undefined
  : (valueAfter('--out') ?? path.join(process.cwd(), 'data', 'registry', 'personal-ct-catalog.index.json'));
const outputRegistriesDir = valueAfter('--registries');
const libraryOutputPath =
  valueAfter('--library-out') ?? path.join(process.cwd(), 'data', 'ct-library', 'personal-ct-library.summary.json');
const shardDirectory =
  valueAfter('--shards-dir') ?? path.join(process.cwd(), 'data', 'ct-library', 'personal-ct-library-shards');
const fullLibraryOutputPath = valueAfter('--library-full-out');
const limit = valueAfter('--limit');
const maxShardBytes = Number.parseInt(valueAfter('--max-shard-bytes') ?? String(25 * 1024 * 1024), 10);

const index = await compileCtZipArchive(zipPath, {
  outputJsonPath,
  outputRegistriesDir,
  limit: limit ? Number.parseInt(limit, 10) : undefined,
});
const library = buildCtLibraryIndex(index);
await fs.mkdir(shardDirectory, { recursive: true });
const shards = [];
for (const game of library.games) {
  const tables = library.tables.filter((table) => slugId(table.game, 'game') === game.gameId);
  const chunks = [];
  let current = [];
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
    const shardPath = path.join(shardDirectory, shardName);
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
      path: path.relative(process.cwd(), shardPath).replace(/\\/g, '/'),
    });
  }
}
await fs.mkdir(path.dirname(libraryOutputPath), { recursive: true });
await fs.writeFile(
  libraryOutputPath,
  JSON.stringify(
    summarizeCtLibraryIndex(library, {
      shardDirectory: path.relative(process.cwd(), shardDirectory).replace(/\\/g, '/'),
      shards,
    }),
    null,
    2,
  ),
  'utf8',
);
if (fullLibraryOutputPath) {
  await fs.mkdir(path.dirname(fullLibraryOutputPath), { recursive: true });
  await fs.writeFile(fullLibraryOutputPath, JSON.stringify(library, null, 2), 'utf8');
}

console.log(
  JSON.stringify(
    {
      ok: true,
      outputJsonPath,
      libraryOutputPath,
      outputRegistriesDir: outputRegistriesDir ?? null,
      shardDirectory,
      shards: shards.length,
      totals: index.totals,
      games: library.games.length,
      rejected: index.rejected.length,
      fullRegistriesWritten: hasFlag('--registries') || Boolean(outputRegistriesDir),
    },
    null,
    2,
  ),
);
