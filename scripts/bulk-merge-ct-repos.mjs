#!/usr/bin/env node
/**
 * Bulk-merge .CT files scraped from a folder of cloned GitHub repos into the
 * live roster (data/ct-library/personal-ct-library-shards-v4 + summary),
 * additively — same contract as merge-ct-tables.mjs, but walks an entire
 * directory tree instead of taking an explicit game name + file list.
 *
 * Usage:
 *   node scripts/bulk-merge-ct-repos.mjs <root-dir-of-cloned-repos> [--dry-run]
 *
 * Game-name derivation per file:
 *   1. Curated override map (CURATED_NAMES) keyed by lowercased basename.
 *   2. If nested in a subfolder deeper than the repo root, use that folder
 *      name (cleaned).
 *   3. Otherwise derive from the filename itself (strip extension, strip
 *      Win64-Shipping/x64/version-number noise, de-camel/kebab/snake).
 *
 * Skips: .git directories, any path segment containing "tutorial", any repo
 * folder named in SKIP_REPOS, non-.CT files.
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import yazl from 'yazl';
import { compileCtZipArchive } from '../src/core/registry/compile-ct-zip.ts';
import { buildCtLibraryIndex } from '../src/core/ct-library/index.ts';
import { dedupeNewTablesBySha256 } from './lib/dedupe-ct-tables.mjs';
import { isGenericContainerName } from './lib/generic-container-names.mjs';

const SHARD_DIR = path.join(process.cwd(), 'data', 'ct-library', 'personal-ct-library-shards-v4');
const SUMMARY_PATH = path.join(process.cwd(), 'data', 'ct-library', 'personal-ct-library.summary.json');

const SKIP_REPOS = new Set(['Hexorg_CheatEngineTables', 'Jim00000_Cheat-Engine-Tutorial-Games-Cheat-Table', 'DerekTurtleRoe_CE-tables']);

const CURATED_NAMES = {
  'gta5': 'Grand Theft Auto V',
  'gta5 (2)': 'Grand Theft Auto V',
  'nms': "No Man's Sky",
  'nomanssky': "No Man's Sky",
  "no man's sky": "No Man's Sky",
  'acodyssey': "Assassin's Creed Odyssey",
  'acvalhalla': "Assassin's Creed Valhalla",
  "assassin's creed syndicate": "Assassin's Creed Syndicate",
  "assassin's creed® unity": "Assassin's Creed Unity",
  "assassin's creed® odyssey": "Assassin's Creed Odyssey",
  'ghostoftsushima': 'Ghost Of Tsushima',
  'witcher': 'The Witcher',
  'witcher2': 'The Witcher 2',
  'witcher3': 'The Witcher 3',
  'hl2': 'Half-Life 2',
  'hl2 ep1': 'Half-Life 2',
  'hl2 ep2': 'Half-Life 2',
  'hl2ep1': 'Half-Life 2',
  'hl2ep2': 'Half-Life 2',
  'palworld-win64-shipping': 'Palworld',
  'palworld-win64-shipping_2': 'Palworld',
  'pal  ': 'Palworld',
  'pal-0.1.4.1-1': 'Palworld',
  'palserver-win64-test-cmd': 'Palworld',
  'stardew valley': 'Stardew Valley',
  'stardew valley_1.0': 'Stardew Valley',
  'stardew valley_bak': 'Stardew Valley',
  'stardew valley_v1.6.7': 'Stardew Valley',
  'stardew valley_x64': 'Stardew Valley',
  'valheim': 'Valheim',
  'kingdomcome': 'Kingdom Come: Deliverance',
  'kingdomcome_v1.6': 'Kingdom Come: Deliverance',
  'borderlands2': 'Borderlands 2',
  'borderlands2_temp': 'Borderlands 2',
  'borderlands3': 'Borderlands 3',
  'borderlands3 2': 'Borderlands 3',
  'farcry5': 'Far Cry 5',
  'farcrynewdawn': 'Far Cry New Dawn',
  'fcprimal': 'Far Cry Primal',
  'divinity original sin ee': 'Divinity: Original Sin Enhanced Edition',
  'sam3': 'Serious Sam 3',
  'sottr': 'Shadow of the Tomb Raider',
  "singler-player": 'Star Wars Jedi Knight: Jedi Academy',
  'p4g-pc': 'Persona 4 Golden',
  'nier automata': 'NieR: Automata',
  'cetable, nier automata': 'NieR: Automata',
  'cetable, nier automata2': 'NieR: Automata',
  'grim dawn': 'Grim Dawn',
  'grim dawn3': 'Grim Dawn',
  'grim dawnx': 'Grim Dawn',
  'grim dawn main': 'Grim Dawn',
  'gtfo': 'GTFO',
  'lethalcompany': 'Lethal Company',
  'repo': 'R.E.P.O.',
  'satisfactory': 'Satisfactory',
  'nomanssky.ct': "No Man's Sky",
  'ghostrecon': 'Ghost Recon Breakpoint',
  'resident evil biohazard hd remaster': 'Resident Evil HD Remaster',
  're0hd': 'Resident Evil 0 HD Remaster',
  'carx street': 'CarX Street',
  'carx street cheatevo': 'CarX Street',
  'carx street cheatevo 1.8.0': 'CarX Street',
  'carx street cheatevo 1.9.1': 'CarX Street',
  'ffvii omni table steam 2026': 'Final Fantasy VII Remake',
  'ghostwire table': 'Ghostwire: Tokyo',
  'ghostwiregp table': 'Ghostwire: Tokyo',
  'alanwake2': 'Alan Wake 2',
  'horizonforbiddenwest': 'Horizon Forbidden West',
  'kena-win64-shipping': 'Kena: Bridge of Spirits',
  'control_dx12': 'Control',
  'monsterhunterwilds': 'Monster Hunter Wilds',
  'monsterhunterrise': 'Monster Hunter Rise',
  'thecallistoprotocol-win64-shipping': 'The Callisto Protocol',
  'the evil within': 'The Evil Within',
  'gearstactics': 'Gears Tactics',
  'daysgone': 'Days Gone',
  'nierautomata': 'NieR: Automata',
  'sb-win64-shipping': 'Stellar Blade',
  'octopath_traveler-win64-shipping': 'Octopath Traveler',
  'dqxoffline': 'Dragon Quest X Offline',
  'the outer worlds cheats': 'The Outer Worlds',
  'cyberpunk 2077 cheats': 'Cyberpunk 2077',
  'farcry6': 'Far Cry 6',
};

function cleanName(raw) {
  let s = raw
    .replace(/\.[Cc][Tt]$/, '')
    .replace(/[-_]win64-shipping.*$/i, '')
    .replace(/[-_]x86_64$/i, '')
    .replace(/[-_]x64$/i, '')
    .replace(/[-_]steam$/i, '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/[_-]+v?\d+(\.\d+)+.*$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s || raw;
}

function deriveGameName(filePath, repoRoot, fileName) {
  const key = fileName.replace(/\.[Cc][Tt]$/, '').toLowerCase().trim();
  if (CURATED_NAMES[key]) return CURATED_NAMES[key];

  const relFromRepo = path.relative(repoRoot, filePath).replace(/\\/g, '/');
  const parts = relFromRepo.split('/');
  if (parts.length > 1) {
    const folder = parts[0];
    const folderKey = folder.toLowerCase().trim();
    if (CURATED_NAMES[folderKey]) return CURATED_NAMES[folderKey];
    if (!isGenericContainerName(folder)) return cleanName(folder);
  }
  return cleanName(fileName);
}

async function walk(dir, repoRoot, skip, out) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/tutorial/i.test(entry.name)) continue;
      if (/^zz[_ ]?(tools|others)$/i.test(entry.name)) continue;
      if (/^lua scripts$/i.test(entry.name)) continue;
      await walk(full, repoRoot, skip, out);
    } else if (/\.ct$/i.test(entry.name)) {
      out.push({ full, repoRoot, fileName: entry.name });
    }
  }
}

function slugId(value, fallback) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

async function loadSummary() {
  return JSON.parse(await fs.readFile(SUMMARY_PATH, 'utf8'));
}

async function loadShard(gameId) {
  const shardPath = path.join(SHARD_DIR, `${gameId}.ct-library.json`);
  try {
    return { shardPath, shard: JSON.parse(await fs.readFile(shardPath, 'utf8')) };
  } catch (error) {
    if (error.code === 'ENOENT') return { shardPath, shard: null };
    throw error;
  }
}

async function main() {
  const rootDir = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!rootDir) {
    console.error('Usage: node scripts/bulk-merge-ct-repos.mjs <root-dir-of-cloned-repos> [--dry-run]');
    process.exit(1);
  }

  const repoEntries = (await fs.readdir(rootDir, { withFileTypes: true })).filter((e) => e.isDirectory());
  const allFiles = [];
  for (const repo of repoEntries) {
    if (SKIP_REPOS.has(repo.name)) {
      console.log(`[bulk-merge] skipping repo ${repo.name}`);
      continue;
    }
    const repoRoot = path.join(rootDir, repo.name);
    await walk(repoRoot, repoRoot, SKIP_REPOS, allFiles);
  }
  console.log(`[bulk-merge] found ${allFiles.length} .CT files across ${repoEntries.length} repos`);

  const grouped = new Map(); // gameName -> [{full, fileName, repoTag}]
  for (const f of allFiles) {
    const gameName = deriveGameName(f.full, f.repoRoot, f.fileName);
    if (isGenericContainerName(gameName)) continue;
    if (!grouped.has(gameName)) grouped.set(gameName, []);
    grouped.get(gameName).push(f);
  }
  console.log(`[bulk-merge] grouped into ${grouped.size} candidate games`);

  if (dryRun) {
    for (const [name, files] of [...grouped.entries()].sort()) {
      console.log(`  ${name} (${files.length}): ${files.map((f) => f.fileName).join(', ').slice(0, 150)}`);
    }
    return;
  }

  const zipfile = new yazl.ZipFile();
  for (const [gameName, files] of grouped.entries()) {
    const safeGame = gameName.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Game';
    files.forEach((f, i) => {
      const entryName = `Games/${safeGame}/${i}_${f.fileName}`;
      zipfile.addFile(f.full, entryName);
    });
  }
  zipfile.end();

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'solith-ct-bulk-'));
  const zipPath = path.join(tempDir, 'bulk-staging.zip');
  const out = await fs.open(zipPath, 'w');
  await new Promise((resolve, reject) => {
    const ws = out.createWriteStream();
    zipfile.outputStream.pipe(ws);
    ws.on('close', resolve);
    ws.on('error', reject);
  });
  await out.close();

  console.log('[bulk-merge] compiling staged zip (this can take a while)...');
  const index = await compileCtZipArchive(zipPath, { tempRoot: tempDir, maxArchiveBytes: 1024 * 1024 * 1024 });
  console.log(`[bulk-merge] compiled: ${JSON.stringify(index.totals)}`);
  const library = buildCtLibraryIndex(index);

  const summary = await loadSummary();
  const summaryGameIndex = new Map(summary.games.map((g, i) => [g.gameId, i]));
  const summaryShardIndex = new Map(summary.shards.map((s, i) => [s.gameId, i]));

  let addedCount = 0;
  let mergedCount = 0;
  for (const newGame of library.games) {
    const gameId = newGame.gameId;
    const newTables = library.tables.filter((t) => slugId(t.game, 'game') === gameId);
    if (newTables.length === 0) continue;

    const { shardPath, shard: existingShard } = await loadShard(gameId);
    const dedupedNewTables = dedupeNewTablesBySha256(existingShard?.tables, newTables);
    if (dedupedNewTables.length < newTables.length) {
      console.log(`[bulk-merge] ${gameId}: skipped ${newTables.length - dedupedNewTables.length} duplicate table(s) by sha256`);
    }
    if (dedupedNewTables.length === 0) continue;
    const mergedTables = existingShard ? [...existingShard.tables, ...dedupedNewTables] : dedupedNewTables;

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
        ...dedupedNewTables.map((t) => t.archivePath),
      ],
    };

    await fs.writeFile(
      shardPath,
      JSON.stringify(
        { schemaVersion: 1, generatedAt: new Date().toISOString(), safety: library.safety, game: mergedGameMeta, tables: mergedTables },
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
      mergedCount++;
    } else {
      summaryGameIndex.set(gameId, summary.games.length);
      summary.games.push(mergedGameMeta);
      addedCount++;
    }
    if (summaryShardIndex.has(gameId)) {
      summary.shards[summaryShardIndex.get(gameId)] = summaryShardEntry;
    } else {
      summaryShardIndex.set(gameId, summary.shards.length);
      summary.shards.push(summaryShardEntry);
    }
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

  console.log(`[bulk-merge] done: ${addedCount} new games, ${mergedCount} games merged into. Total roster now ${summary.games.length} games.`);
  await fs.rm(tempDir, { recursive: true, force: true });
}

main().catch((error) => {
  console.error('[bulk-merge] Failed:', error);
  process.exitCode = 1;
});
