#!/usr/bin/env node
/**
 * Offline catalog Steam art integrity check.
 * - Duplicate steamAppId detection in seed script
 * - Synthetic rows must not ship fake App IDs
 * - Optional HTTP HEAD on curated BASE_GAMES sample
 *
 * Usage: node scripts/verify-catalog-steam-art.mjs [--head]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const seedScript = fs.readFileSync(path.join(root, 'scripts', 'generate-trainer-catalog-seed.mjs'), 'utf8');

const KNOWN_CORRECTIONS = {
  1086940: ['Baldur\'s Gate 3'],
  2475420: ['Alan Wake 2'],
};

function parseBaseGames(source) {
  const block = source.slice(source.indexOf('const BASE_GAMES = ['), source.indexOf('];', source.indexOf('const BASE_GAMES = [')) + 2);
  const games = [];
  const re = /name:\s*'([^']+)'(?:,\s*steamAppId:\s*(\d+))?/g;
  let m;
  while ((m = re.exec(block))) {
    games.push({ name: m[1], steamAppId: m[2] ? Number(m[2]) : undefined });
  }
  return games;
}

async function headOk(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const withHead = process.argv.includes('--head');
  const baseGames = parseBaseGames(seedScript);
  const byId = new Map();
  const issues = [];

  for (const game of baseGames) {
    if (!game.steamAppId) continue;
    if (!byId.has(game.steamAppId)) byId.set(game.steamAppId, []);
    byId.get(game.steamAppId).push(game.name);
  }

  for (const [id, names] of byId) {
    if (names.length > 1) {
      issues.push({ type: 'duplicate_app_id', id, names });
    }
    const expected = KNOWN_CORRECTIONS[id];
    if (expected && !names.every((n) => expected.includes(n))) {
      issues.push({ type: 'known_id_mismatch', id, names, expected });
    }
  }

  if (seedScript.includes('steamAppId: 1_000_000 + i')) {
    issues.push({ type: 'synthetic_fake_steam_ids', detail: 'Synthetic games must not assign fake steamAppId values' });
  }

  if (withHead) {
    const sample = baseGames.filter((g) => g.steamAppId && g.steamAppId < 1_000_000).slice(0, 12);
    for (const game of sample) {
      const cover = `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.steamAppId}/library_600x900_2x.jpg`;
      const ok = await headOk(cover);
      if (!ok) issues.push({ type: 'cover_unreachable', name: game.name, steamAppId: game.steamAppId, url: cover });
    }
  }

  const report = {
    checkedAt: new Date().toISOString(),
    baseGameCount: baseGames.length,
    withSteamId: baseGames.filter((g) => g.steamAppId).length,
    issueCount: issues.length,
    issues,
    pass: issues.length === 0,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main();
