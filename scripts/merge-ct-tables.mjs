#!/usr/bin/env node
/**
 * Merge one or more standalone .CT files into the existing personal CT-library
 * roster (data/ct-library/personal-ct-library-shards-v4 + summary index)
 * WITHOUT regenerating or clobbering the other ~300 games already there.
 *
 * Usage:
 *   node scripts/merge-ct-tables.mjs <game-name> <file1.CT> [file2.CT ...]
 *   node scripts/merge-ct-tables.mjs --dir <folder-of-ct-files> [--game "Display Name"]
 *
 * Each invocation packages the given .CT file(s) into a throwaway zip
 * (reusing the existing zip-based compiler pipeline verbatim), compiles it
 * into an isolated temp shard directory, then merges the resulting shard(s)
 * additively into the live roster:
 *   - New gameId -> shard file copied in, summary.games/.shards appended.
 *   - Existing gameId -> new tables appended into that game's shard + counts
 *     recomputed, summary entry updated in place.
 */
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import yazl from 'yazl';
import { compileCtZipArchive } from '../src/core/registry/compile-ct-zip.ts';
import { buildCtLibraryIndex } from '../src/core/ct-library/index.ts';
import { isGenericContainerName } from './lib/generic-container-names.mjs';

const SHARD_DIR = path.join(process.cwd(), 'data', 'ct-library', 'personal-ct-library-shards-v4');
const SUMMARY_PATH = path.join(process.cwd(), 'data', 'ct-library', 'personal-ct-library.summary.json');

function slugId(value, fallback) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function parseArgs(argv) {
  const dirFlagIndex = argv.indexOf('--dir');
  const gameFlagIndex = argv.indexOf('--game');
  const explicitGame = gameFlagIndex >= 0 ? argv[gameFlagIndex + 1] : undefined;

  if (dirFlagIndex >= 0) {
    const dir = argv[dirFlagIndex + 1];
    if (!dir) throw new Error('--dir requires a folder path');
    return { mode: 'dir', dir, game: explicitGame };
  }

  const [game, ...files] = argv.filter((a) => a !== '--game' && a !== explicitGame);
  if (!game || files.length === 0) {
    throw new Error(
      'Usage: node scripts/merge-ct-tables.mjs <game-name> <file1.CT> [file2.CT ...]\n' +
        '   or: node scripts/merge-ct-tables.mjs --dir <folder> [--game "Display Name"]',
    );
  }
  return { mode: 'files', game, files };
}

async function collectCtFiles(opts) {
  if (opts.mode === 'files') {
    return { game: opts.game, files: opts.files };
  }
  const entries = await fs.readdir(opts.dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.ct'))
    .map((e) => path.join(opts.dir, e.name));
  if (files.length === 0) throw new Error(`No .CT files found in ${opts.dir}`);
  const dirName = path.basename(opts.dir);
  if (!opts.game && isGenericContainerName(dirName)) {
    throw new Error(
      `Directory name "${dirName}" looks like a generic container (repo/tools/tables folder), not a game title. ` +
        'Pass --game "Actual Game Name" explicitly instead of relying on the folder name.',
    );
  }
  const game = opts.game ?? dirName;
  return { game, files };
}

async function buildStagingZip(game, files) {
  const zipfile = new yazl.ZipFile();
  const safeGame = game.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Game';
  for (const filePath of files) {
    const base = path.basename(filePath);
    // gameFromArchivePath() only trusts the parent folder name when the zip
    // entry is nested at least 3 levels deep (Games/<Game>/<file>) — a
    // 2-level path falls back to a filename-derived title instead.
    zipfile.addFile(filePath, `Games/${safeGame}/${base}`);
  }
  zipfile.end();

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'solith-ct-merge-'));
  const zipPath = path.join(tempDir, 'staging.zip');
  const out = await fs.open(zipPath, 'w');
  await new Promise((resolve, reject) => {
    const writeStream = out.createWriteStream();
    zipfile.outputStream.pipe(writeStream);
    writeStream.on('close', resolve);
    writeStream.on('error', reject);
  });
  await out.close();
  return { zipPath, tempDir };
}

async function loadSummary() {
  const raw = await fs.readFile(SUMMARY_PATH, 'utf8');
  return JSON.parse(raw);
}

async function loadShard(gameId) {
  const shardPath = path.join(SHARD_DIR, `${gameId}.ct-library.json`);
  try {
    const raw = await fs.readFile(shardPath, 'utf8');
    return { shardPath, shard: JSON.parse(raw) };
  } catch (error) {
    if (error.code === 'ENOENT') return { shardPath, shard: null };
    throw error;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { game, files } = await collectCtFiles(opts);
  for (const f of files) {
    await fs.access(f);
  }

  const { zipPath, tempDir } = await buildStagingZip(game, files);
  try {
    const index = await compileCtZipArchive(zipPath, { tempRoot: tempDir });
    const library = buildCtLibraryIndex(index);

    if (library.games.length === 0) {
      console.error('[merge-ct-tables] No compilable tables found — nothing merged.');
      process.exitCode = 1;
      return;
    }

    const summary = await loadSummary();
    const summaryGameIndex = new Map(summary.games.map((g, i) => [g.gameId, i]));
    const summaryShardIndex = new Map(summary.shards.map((s, i) => [s.gameId, i]));

    for (const newGame of library.games) {
      const gameId = newGame.gameId;
      const newTables = library.tables.filter((t) => slugId(t.game, 'game') === gameId);

      const { shardPath, shard: existingShard } = await loadShard(gameId);
      const mergedTables = existingShard ? [...existingShard.tables, ...newTables] : newTables;

      const mergedGameMeta = {
        ...newGame,
        tableCount: mergedTables.length,
        cheatCount: mergedTables.reduce((n, t) => n + t.cheats.length, 0),
        pointerCount: mergedTables.reduce((n, t) => n + t.counts.pointers, 0),
        scriptCount: mergedTables.reduce((n, t) => n + t.counts.scripts, 0),
        aobSignatureCount: mergedTables.reduce((n, t) => n + t.counts.aobSignatures, 0),
        warningCount: mergedTables.reduce((n, t) => n + t.counts.warnings, 0),
        rejectionCount: mergedTables.reduce((n, t) => n + t.counts.rejections, 0),
        sourceTables: [
          ...(existingShard ? existingShard.game.sourceTables : []),
          ...newTables.map((t) => t.archivePath),
        ],
      };

      await fs.writeFile(
        shardPath,
        JSON.stringify(
          {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            safety: library.safety,
            game: mergedGameMeta,
            tables: mergedTables,
          },
          null,
          2,
        ),
        'utf8',
      );

      const summaryShardEntry = {
        gameId,
        displayName: mergedGameMeta.displayName,
        tableCount: mergedGameMeta.tableCount,
        cheatCount: mergedGameMeta.cheatCount,
        path: `data/ct-library/personal-ct-library-shards-v4/${gameId}.ct-library.json`,
      };

      if (summaryGameIndex.has(gameId)) {
        summary.games[summaryGameIndex.get(gameId)] = mergedGameMeta;
      } else {
        summaryGameIndex.set(gameId, summary.games.length);
        summary.games.push(mergedGameMeta);
      }

      if (summaryShardIndex.has(gameId)) {
        summary.shards[summaryShardIndex.get(gameId)] = summaryShardEntry;
      } else {
        summaryShardIndex.set(gameId, summary.shards.length);
        summary.shards.push(summaryShardEntry);
      }

      console.log(
        `[merge-ct-tables] ${existingShard ? 'merged into' : 'added'} ${gameId}: +${newTables.length} table(s), tableCount=${mergedGameMeta.tableCount}, cheatCount=${mergedGameMeta.cheatCount}`,
      );
    }

    summary.totals = {
      ctFiles: (summary.totals?.ctFiles ?? 0) + index.totals.ctFiles,
      compiledTables: (summary.totals?.compiledTables ?? 0) + index.totals.compiledTables,
      rejectedTables: (summary.totals?.rejectedTables ?? 0) + index.totals.rejectedTables,
      pointers: (summary.totals?.pointers ?? 0) + index.totals.pointers,
      scripts: (summary.totals?.scripts ?? 0) + index.totals.scripts,
      aobSignatures: (summary.totals?.aobSignatures ?? 0) + index.totals.aobSignatures,
      cheats: (summary.totals?.cheats ?? 0) + index.totals.cheats,
    };
    summary.generatedAt = new Date().toISOString();

    await fs.writeFile(SUMMARY_PATH, JSON.stringify(summary, null, 2), 'utf8');
    console.log(
      `[merge-ct-tables] Summary updated: ${summary.games.length} games, ${summary.shards.length} shards.`,
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('[merge-ct-tables] Failed:', error);
  process.exitCode = 1;
});
