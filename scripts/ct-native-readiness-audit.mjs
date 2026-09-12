#!/usr/bin/env node
/**
 * Full-corpus native-readiness audit over the personal CT library.
 *
 * Uses ONLY existing production classification semantics — does not invent a
 * new classifier. Every cheat entry already carries its `kind` (pointer /
 * script / aob) from src/core/registry/compile-ct-zip.ts, and every pointer
 * entry carries a precomputed `metadata.liveResolution` from
 * src/core/definitions/ct-live-resolution.ts (classifyCtLiveResolution).
 *
 * Mapping (derived from actual code, not invented):
 *   kind=pointer, liveResolution=resolvable, pointerChain.length>0  -> POINTER
 *   kind=pointer, liveResolution=resolvable, pointerChain empty     -> MODULE_OFFSET
 *   kind=pointer, liveResolution=absolute_only                     -> DIRECT (raw/session-only address)
 *   kind=pointer, liveResolution=incomplete                        -> UNSUPPORTED
 *   kind=script,  metadata.scriptType === 'lua'                    -> LUA
 *   kind=script,  otherwise                                        -> SCRIPT_DEPENDENT
 *   kind=aob                                                       -> AOB
 *
 * NATIVE_READY = kind=pointer && liveResolution==='resolvable'
 *   (matches featureTypeForCtLiveResolution's 'freeze' branch exactly —
 *   src/core/definitions/ct-live-resolution.ts)
 *
 * MODULE_OFFSET / DIRECT / POINTER / AOB / SCRIPT_DEPENDENT / LUA / UNSUPPORTED
 * are the only buckets current code can actually produce. INVALID and
 * AMBIGUOUS have no corresponding code path today (classifyCtLiveResolution
 * has exactly 3 outcomes) — reported as 0 rather than fabricated.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';

const ROOT = process.cwd();
const SUMMARY_PATH = path.join(ROOT, 'data', 'ct-library', 'personal-ct-library.summary.json');
const REPORT_PATH = path.join(ROOT, 'data', 'ct-library', 'roster-gap-report.json');

function classifyRecord(cheat) {
  if (cheat.kind === 'pointer') {
    const lr = cheat.metadata?.liveResolution;
    if (lr === 'resolvable') {
      const chainLen = Array.isArray(cheat.metadata?.pointerChain) ? cheat.metadata.pointerChain.length : 0;
      return chainLen > 0 ? 'POINTER' : 'MODULE_OFFSET';
    }
    if (lr === 'absolute_only') return 'DIRECT';
    return 'UNSUPPORTED'; // incomplete or missing
  }
  if (cheat.kind === 'script') {
    return cheat.metadata?.scriptType === 'lua' ? 'LUA' : 'SCRIPT_DEPENDENT';
  }
  if (cheat.kind === 'aob') return 'AOB';
  return 'AMBIGUOUS'; // unknown kind — should not happen given current enum
}

function isNativeReady(cheat) {
  return cheat.kind === 'pointer' && cheat.metadata?.liveResolution === 'resolvable';
}

async function main() {
  const summary = JSON.parse(await fs.readFile(SUMMARY_PATH, 'utf8'));

  const bucketTotals = {
    DIRECT: 0, MODULE_OFFSET: 0, POINTER: 0, AOB: 0,
    SCRIPT_DEPENDENT: 0, LUA: 0, SCAN_DEPENDENT: 0,
    UNSUPPORTED: 0, INVALID: 0, AMBIGUOUS: 0,
  };
  let nativeReadyTotal = 0;
  let totalRecords = 0;
  let totalTables = 0;

  const gameStatuses = [];
  const versionGaps = [];
  const depthBuckets = { ge1: 0, ge5: 0, ge10: 0, ge25: 0, ge50: 0 };
  const topCandidates = [];

  for (const shardEntry of summary.shards) {
    const shardPath = path.isAbsolute(shardEntry.path) ? shardEntry.path : path.join(ROOT, shardEntry.path);
    let shard;
    try {
      shard = JSON.parse(await fs.readFile(shardPath, 'utf8'));
    } catch (error) {
      gameStatuses.push({ gameId: shardEntry.gameId, status: 'REJECTED', reason: `shard unreadable: ${error.message}` });
      continue;
    }

    let gameNativeReady = 0;
    let gameRecords = 0;
    let gamePointer = 0;
    let gameScript = 0;
    let gameAob = 0;
    let hasAnyCt = shard.tables.length > 0;

    for (const table of shard.tables) {
      totalTables += 1;
      for (const cheat of table.cheats) {
        totalRecords += 1;
        gameRecords += 1;
        const bucket = classifyRecord(cheat);
        bucketTotals[bucket] = (bucketTotals[bucket] ?? 0) + 1;
        if (cheat.kind === 'pointer') gamePointer += 1;
        if (cheat.kind === 'script') gameScript += 1;
        if (cheat.kind === 'aob') gameAob += 1;
        if (isNativeReady(cheat)) {
          gameNativeReady += 1;
          nativeReadyTotal += 1;
        }
      }
    }

    let status;
    if (!hasAnyCt) status = 'F';
    else if (gameNativeReady > 0 && gameNativeReady === gameRecords) status = 'A';
    else if (gameNativeReady > 0) status = 'B';
    else if (gamePointer + gameScript + gameAob > 0) status = 'C';
    else status = 'D';

    gameStatuses.push({
      gameId: shardEntry.gameId,
      displayName: shardEntry.displayName,
      status,
      tableCount: shard.tables.length,
      recordCount: gameRecords,
      nativeReadyCount: gameNativeReady,
      pointerCount: gamePointer,
      scriptCount: gameScript,
      aobCount: gameAob,
    });

    if (gameNativeReady >= 1) depthBuckets.ge1 += 1;
    if (gameNativeReady >= 5) depthBuckets.ge5 += 1;
    if (gameNativeReady >= 10) depthBuckets.ge10 += 1;
    if (gameNativeReady >= 25) depthBuckets.ge25 += 1;
    if (gameNativeReady >= 50) depthBuckets.ge50 += 1;

    if (gameNativeReady > 0) {
      topCandidates.push({ gameId: shardEntry.gameId, displayName: shardEntry.displayName, nativeReadyCount: gameNativeReady });
    }
  }

  topCandidates.sort((a, b) => b.nativeReadyCount - a.nativeReadyCount);

  const report = {
    generatedAt: new Date().toISOString(),
    repoHead: process.env.CT_AUDIT_HEAD ?? null,
    totalGames: summary.games.length,
    totalTables,
    totalRecords,
    classificationTotals: { ...bucketTotals, NATIVE_READY: nativeReadyTotal },
    gameDepthTotals: {
      'games>=1': depthBuckets.ge1,
      'games>=5': depthBuckets.ge5,
      'games>=10': depthBuckets.ge10,
      'games>=25': depthBuckets.ge25,
      'games>=50': depthBuckets.ge50,
    },
    gameStatusCounts: gameStatuses.reduce((acc, g) => {
      acc[g.status] = (acc[g.status] ?? 0) + 1;
      return acc;
    }, {}),
    gameStatuses,
    topValidationCandidates: topCandidates.slice(0, 20),
  };

  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

  console.log('=== CT NATIVE-READINESS AUDIT ===');
  console.log('games:', summary.games.length, 'tables:', totalTables, 'records:', totalRecords);
  console.log('classification totals:', JSON.stringify(bucketTotals));
  console.log('native-ready total:', nativeReadyTotal);
  console.log('game depth:', JSON.stringify(depthBuckets));
  console.log('game status counts:', JSON.stringify(report.gameStatusCounts));
  console.log('report written to', REPORT_PATH);
}

main().catch((error) => {
  console.error('[ct-native-readiness-audit] Failed:', error);
  process.exitCode = 1;
});
