#!/usr/bin/env node
/** Mission H — semantic usefulness of the 4,038 native-ready records. Read-only. */
import path from 'node:path';
import { promises as fs } from 'node:fs';

const ROOT = process.cwd();
const SUMMARY_PATH = path.join(ROOT, 'data', 'ct-library', 'personal-ct-library.summary.json');

const HIGH_RE = /\b(money|cash|gold|coin|health|hp|energy|stamina|mana|ammo|bullet|skill.?point|xp|exp|level|gem|credit|fuel|oxygen|food|hunger|resource|score|life|lives)\b/i;
const LOW_RE = /^(pointerscan result|no description|unnamed|entry ?\d*|address ?\d*|cheat ?\d*|value ?\d*|new cheat.*|group ?\d*)$/i;

function classifyName(name) {
  const trimmed = (name ?? '').trim();
  if (!trimmed || LOW_RE.test(trimmed)) return 'LOW';
  if (HIGH_RE.test(trimmed)) return 'HIGH';
  return 'MEDIUM';
}

async function main() {
  const summary = JSON.parse(await fs.readFile(SUMMARY_PATH, 'utf8'));
  let total = 0;
  const buckets = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  const perGame = new Map();

  for (const shardEntry of summary.shards) {
    const shardPath = path.isAbsolute(shardEntry.path) ? shardEntry.path : path.join(ROOT, shardEntry.path);
    let shard;
    try {
      shard = JSON.parse(await fs.readFile(shardPath, 'utf8'));
    } catch {
      continue;
    }
    let gameNativeReady = 0;
    let gameHigh = 0;
    let gameMedium = 0;
    for (const table of shard.tables) {
      for (const cheat of table.cheats) {
        if (cheat.kind !== 'pointer' || cheat.metadata?.liveResolution !== 'resolvable') continue;
        total += 1;
        gameNativeReady += 1;
        const bucket = classifyName(cheat.name);
        buckets[bucket] += 1;
        if (bucket === 'HIGH') gameHigh += 1;
        if (bucket === 'MEDIUM') gameMedium += 1;
      }
    }
    if (gameNativeReady > 0) {
      perGame.set(shardEntry.gameId, {
        gameId: shardEntry.gameId,
        displayName: shardEntry.displayName,
        nativeReady: gameNativeReady,
        humanMeaningful: gameHigh + gameMedium,
        high: gameHigh,
      });
    }
  }

  console.log('=== SEMANTIC QUALITY ===');
  console.log('native-ready total:', total);
  console.log('HIGH:', buckets.HIGH, `(${((buckets.HIGH / total) * 100).toFixed(2)}%)`);
  console.log('MEDIUM:', buckets.MEDIUM, `(${((buckets.MEDIUM / total) * 100).toFixed(2)}%)`);
  console.log('LOW:', buckets.LOW, `(${((buckets.LOW / total) * 100).toFixed(2)}%)`);
  console.log('human-meaningful (HIGH+MEDIUM):', buckets.HIGH + buckets.MEDIUM);
  console.log('anonymous/generic (LOW):', buckets.LOW);

  const ranked = [...perGame.values()].sort((a, b) => (b.high * 1000 + b.humanMeaningful) - (a.high * 1000 + a.humanMeaningful));
  console.log('\n=== TOP 30 BY (HIGH-QUALITY FIRST, THEN HUMAN-MEANINGFUL) ===');
  for (const g of ranked.slice(0, 30)) {
    console.log(`${g.displayName} (${g.gameId}): native-ready=${g.nativeReady} human-meaningful=${g.humanMeaningful} high=${g.high}`);
  }
}

main().catch((error) => {
  console.error('[analyze-semantic-quality] Failed:', error);
  process.exitCode = 1;
});
