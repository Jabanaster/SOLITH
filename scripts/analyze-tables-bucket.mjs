#!/usr/bin/env node
/**
 * Missions 5-10 — read-only investigation of the "tables" junk gameId
 * (16,736 tables / 549,378 cheats, split across tables.part-00{1,2,3}
 * shard files). NEVER writes to production shards/summary. Output is a
 * local, gitignored manifest only.
 *
 * Attribution signal available: these tables predate the metadata field
 * (compiled ~2026-07-20, before compile-ct-zip.ts captured moduleName per
 * cheat), so the ONLY recoverable identity signal is TEXT — archivePath and
 * tableName. No executable/module name survived per-cheat. This script
 * derives a candidate game name from that text and cross-references it
 * against the existing 746-game canonical roster (excluding other known
 * junk ids) using the same normalizer already used for alias detection.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { normalizeGameSlug } from './lib/alias-normalizer.mjs';
import { isGenericContainerName } from './lib/generic-container-names.mjs';

const ROOT = process.cwd();
const SUMMARY_PATH = path.join(ROOT, 'data', 'ct-library', 'personal-ct-library.summary.json');
const MANIFEST_PATH = path.join(ROOT, 'data', 'ct-library', 'tables-reattribution-manifest.json');

const NUMERIC_ID_SUFFIX_RE = /[_.\s-]\d{2,5}$/; // e.g. "_884", ".272", "-140"
const LEADING_INDEX_PREFIX_RE = /^\d+[._]/; // e.g. "0.", "12_"
const JUNK_WORDS = new Set([
  'test', 'temp', 'tmp', 'misc', 'thread', 'threadtest', 'mthreadtest', 'demo', 'sample',
  'new', 'old', 'backup', 'copy', 'untitled', 'unnamed', 'game', 'hack', 'trainer', 'cheat', 'cheats',
]);

function deriveCandidateName(archivePath, tableName) {
  const base = path.basename(archivePath).replace(/\.ct$/i, '');
  let candidate = base;
  candidate = candidate.replace(NUMERIC_ID_SUFFIX_RE, '');
  candidate = candidate.replace(LEADING_INDEX_PREFIX_RE, '');
  candidate = candidate.replace(/^_+/, '');
  candidate = candidate.replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!candidate || candidate.length < 2) {
    // Fall back to the table's own recorded title if the filename was pure noise.
    candidate = (tableName ?? '').replace(/\s*\d{2,5}\s*$/, '').trim();
  }
  return candidate;
}

function classifyClusterName(name) {
  const lower = name.toLowerCase();
  if (!name || name.length < 3) return 'noise';
  if (isGenericContainerName(name)) return 'noise';
  const words = lower.split(/\s+/);
  if (words.every((w) => JUNK_WORDS.has(w) || /^\d+$/.test(w))) return 'noise';
  if (/^[0-9a-f]{6,}$/i.test(lower.replace(/\s/g, ''))) return 'noise'; // hash-looking
  return 'ok';
}

async function loadCanonicalRosterIndex() {
  const summary = JSON.parse(await fs.readFile(SUMMARY_PATH, 'utf8'));
  const index = new Map(); // normalizedSlug -> gameId (canonical, excluding junk/tables itself)
  for (const g of summary.games) {
    if (g.gameId === 'tables' || isGenericContainerName(g.gameId) || isGenericContainerName(g.displayName)) continue;
    index.set(normalizeGameSlug(g.gameId), g.gameId);
  }
  return { summary, index };
}

async function main() {
  const { summary, index: canonicalIndex } = await loadCanonicalRosterIndex();
  const partPaths = summary.shards.filter((s) => s.gameId === 'tables').map((s) => (path.isAbsolute(s.path) ? s.path : path.join(ROOT, s.path)));

  const clusters = new Map(); // clusterKey -> { name, tables: [], recordCount, exactCanonicalMatch }

  let totalTables = 0;
  let totalRecords = 0;

  for (const partPath of partPaths) {
    const shard = JSON.parse(await fs.readFile(partPath, 'utf8'));
    for (const table of shard.tables) {
      totalTables += 1;
      const recordCount = table.cheats.length;
      totalRecords += recordCount;
      const candidateName = deriveCandidateName(table.archivePath, table.tableName);
      const normalized = normalizeGameSlug(candidateName || 'unknown');
      const clusterKey = normalized || 'unknown';
      if (!clusters.has(clusterKey)) {
        clusters.set(clusterKey, {
          candidateName,
          normalized: clusterKey,
          tables: [],
          recordCount: 0,
          canonicalMatch: canonicalIndex.get(clusterKey) ?? null,
        });
      }
      const cluster = clusters.get(clusterKey);
      cluster.recordCount += recordCount;
      if (cluster.tables.length < 8) {
        cluster.tables.push({ archivePath: table.archivePath, tableName: table.tableName, sourceSha256: table.sourceSha256, recordCount });
      } else {
        cluster.tablesOverflow = (cluster.tablesOverflow ?? 0) + 1;
      }
    }
  }

  // Confidence classification per cluster.
  const buckets = { A: [], B: [], C: [], D: [] };
  for (const cluster of clusters.values()) {
    const nameQuality = classifyClusterName(cluster.candidateName);
    const clusterTableCount = cluster.tables.length + (cluster.tablesOverflow ?? 0);
    let confidence;
    if (cluster.canonicalMatch && nameQuality === 'ok') {
      confidence = 'A';
    } else if (nameQuality === 'ok' && clusterTableCount >= 3 && cluster.candidateName.split(/\s+/).length >= 1 && cluster.candidateName.length >= 4) {
      confidence = 'B';
    } else if (nameQuality === 'ok') {
      confidence = 'C';
    } else {
      confidence = 'D';
    }
    cluster.confidence = confidence;
    cluster.clusterTableCount = clusterTableCount;
    buckets[confidence].push(cluster);
  }

  const summarizeBucket = (list) => ({
    clusters: list.length,
    tables: list.reduce((n, c) => n + c.clusterTableCount, 0),
    records: list.reduce((n, c) => n + c.recordCount, 0),
  });

  console.log('=== TABLES BUCKET ANALYSIS ===');
  console.log('total tables:', totalTables, 'total records:', totalRecords, 'total clusters:', clusters.size);
  for (const key of ['A', 'B', 'C', 'D']) {
    const s = summarizeBucket(buckets[key]);
    console.log(`${key}: clusters=${s.clusters} tables=${s.tables} records=${s.records}`);
  }

  const top50 = [...clusters.values()].sort((a, b) => b.recordCount - a.recordCount).slice(0, 50);
  console.log('\n=== TOP 50 CLUSTERS BY RECORD COUNT ===');
  for (const c of top50) {
    console.log(`${c.candidateName} | normalized=${c.normalized} | confidence=${c.confidence} | tables=${c.clusterTableCount} | records=${c.recordCount} | canonicalMatch=${c.canonicalMatch ?? 'none'} | sample=${c.tables[0]?.archivePath}`);
  }

  // Manifest (proposal only, gitignored, not applied).
  const manifest = {
    generatedAt: new Date().toISOString(),
    note: 'PROPOSAL ONLY — heuristic text-based reattribution from archivePath/tableName. Not applied. No production data moved.',
    totalTables,
    totalRecords,
    totalClusters: clusters.size,
    bucketSummary: { A: summarizeBucket(buckets.A), B: summarizeBucket(buckets.B), C: summarizeBucket(buckets.C), D: summarizeBucket(buckets.D) },
    clusters: [...clusters.values()]
      .sort((a, b) => b.recordCount - a.recordCount)
      .map((c) => ({
        candidateName: c.candidateName,
        normalized: c.normalized,
        confidence: c.confidence,
        proposedGameId: c.canonicalMatch ?? c.normalized,
        existingTargetGame: Boolean(c.canonicalMatch),
        tableCount: c.clusterTableCount,
        recordCount: c.recordCount,
        sampleTables: c.tables,
      })),
  };
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
  console.log('\nManifest written to', MANIFEST_PATH);
}

main().catch((error) => {
  console.error('[analyze-tables-bucket] Failed:', error);
  process.exitCode = 1;
});
