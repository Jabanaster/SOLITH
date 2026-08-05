#!/usr/bin/env node
/**
 * Catalog seed Steam art identity verifier.
 * Structurally inspects a generated seed JSON ({ version, games: [...] })
 * and rejects entries whose Steam App ID (or a CDN URL derived from one)
 * falls in a known synthetic/fabricated range. Valid real IDs and
 * unresolved entries (absent, null, or 0 steamAppId) pass.
 *
 * Usage: node scripts/verify-catalog-steam-art.mjs --seed <path> [--head]
 */
import fs from 'node:fs';

// Real Steam App IDs are small positive integers assigned incrementally
// since Steam's 2003 launch; the catalog generator historically fabricated
// filler IDs starting at 9,000,000 (see scripts/generate-trainer-catalog-seed.mjs
// history) — far above any real allocation. Anything at or above this
// threshold is treated as synthetic/fabricated, never a real Steam ID.
const SYNTHETIC_STEAM_APP_ID_THRESHOLD = 9_000_000;

function isSyntheticId(steamAppId) {
  return typeof steamAppId === 'number' && steamAppId >= SYNTHETIC_STEAM_APP_ID_THRESHOLD;
}

function extractIdFromCdnUrl(url) {
  if (typeof url !== 'string') return undefined;
  const match = url.match(/cloudflare\.steamstatic\.com\/steam\/apps\/(\d+)\//);
  return match ? Number(match[1]) : undefined;
}

async function headOk(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const seedIndex = argv.indexOf('--seed');
  const seedPath = seedIndex !== -1 ? argv[seedIndex + 1] : undefined;
  return { seedPath, withHead: argv.includes('--head') };
}

async function main() {
  const { seedPath, withHead } = parseArgs(process.argv.slice(2));
  if (!seedPath) {
    console.error('Usage: node scripts/verify-catalog-steam-art.mjs --seed <path> [--head]');
    process.exit(2);
  }

  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const games = Array.isArray(seed.games) ? seed.games : [];
  const issues = [];
  const byId = new Map();

  for (const game of games) {
    const { name, steamAppId, coverUrl, headerUrl, iconUrl } = game;

    if (isSyntheticId(steamAppId)) {
      issues.push({ type: 'synthetic_fake_steam_id', name, steamAppId });
    }

    for (const [field, url] of [['coverUrl', coverUrl], ['headerUrl', headerUrl], ['iconUrl', iconUrl]]) {
      const derivedId = extractIdFromCdnUrl(url);
      if (derivedId !== undefined && isSyntheticId(derivedId)) {
        issues.push({ type: 'synthetic_fake_steam_url', name, field, url, derivedId });
      }
    }

    if (steamAppId) {
      if (!byId.has(steamAppId)) byId.set(steamAppId, []);
      byId.get(steamAppId).push(name);
    }
  }

  for (const [id, names] of byId) {
    if (names.length > 1) {
      issues.push({ type: 'duplicate_app_id', id, names });
    }
  }

  if (withHead) {
    const sample = games.filter((g) => g.steamAppId && !isSyntheticId(g.steamAppId)).slice(0, 12);
    for (const game of sample) {
      const cover = `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.steamAppId}/library_600x900_2x.jpg`;
      const ok = await headOk(cover);
      if (!ok) issues.push({ type: 'cover_unreachable', name: game.name, steamAppId: game.steamAppId, url: cover });
    }
  }

  const report = {
    checkedAt: new Date().toISOString(),
    gameCount: games.length,
    withSteamId: games.filter((g) => g.steamAppId).length,
    issueCount: issues.length,
    issues,
    pass: issues.length === 0,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main();
