import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resetForTesting } from '../src/core/database/index.ts';
import {
  countCatalogEntries,
  getCatalogEntry,
  upsertCatalogEntry,
} from '../src/core/trainer-catalog/store.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';

const STEAM = {
  appId: 1623730,
  coverUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1623730/library_600x900_2x.jpg',
  headerUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1623730/header.jpg',
  iconUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1623730/capsule_231x87.jpg',
};

function entry(
  source: TrainerCatalogEntry['sources'][number]['provider'],
  artwork: Partial<Pick<TrainerCatalogEntry, 'steamAppId' | 'coverUrl' | 'headerUrl' | 'iconUrl'>> = {},
): TrainerCatalogEntry {
  return {
    catalogGameId: 'palworld',
    displayName: 'Palworld',
    executables: ['Palworld-Win64-Shipping.exe'],
    categories: ['Survival'],
    verificationStatus: source === 'bundled' ? 'verified' : 'community',
    sources: [{ provider: source, url: `${source}://palworld` }],
    hasModPack: source !== 'bundled',
    cheatCount: source === 'bundled' ? 0 : 4,
    searchableText: 'palworld survival',
    ...artwork,
  };
}

describe('catalog artwork integrity merge', () => {
  before(async () => {
    await resetForTesting();
  });

  after(async () => {
    await resetForTesting();
  });

  test('bundled artwork survives a null remote collision while non-artwork updates continue', () => {
    upsertCatalogEntry(entry('bundled', { steamAppId: STEAM.appId, ...STEAM }));
    upsertCatalogEntry(entry('plitch'));

    const stored = getCatalogEntry('palworld');
    assert.equal(stored?.steamAppId, STEAM.appId);
    assert.equal(stored?.coverUrl, STEAM.coverUrl);
    assert.equal(stored?.headerUrl, STEAM.headerUrl);
    assert.equal(stored?.iconUrl, STEAM.iconUrl);
    assert.equal(stored?.cheatCount, 4);
    assert.ok(stored?.sources.some((source) => source.provider === 'bundled'));
    assert.ok(stored?.sources.some((source) => source.provider === 'plitch'));
  });

  test('valid incoming artwork fills empty fields', () => {
    upsertCatalogEntry(entry('plitch'));
    upsertCatalogEntry(entry('fling', { steamAppId: STEAM.appId, ...STEAM }));

    const stored = getCatalogEntry('palworld');
    assert.equal(stored?.steamAppId, STEAM.appId);
    assert.equal(stored?.coverUrl, STEAM.coverUrl);
  });

  test('lower-precedence conflicting artwork cannot replace curated artwork', () => {
    upsertCatalogEntry(entry('bundled', { steamAppId: STEAM.appId, ...STEAM }));
    upsertCatalogEntry(entry('plitch', {
      steamAppId: 999,
      coverUrl: 'https://example.test/wrong-cover.jpg',
      headerUrl: 'https://example.test/wrong-header.jpg',
      iconUrl: 'https://example.test/wrong-icon.jpg',
    }));

    const stored = getCatalogEntry('palworld');
    assert.equal(stored?.steamAppId, STEAM.appId);
    assert.equal(stored?.coverUrl, STEAM.coverUrl);
    assert.equal(stored?.headerUrl, STEAM.headerUrl);
    assert.equal(stored?.iconUrl, STEAM.iconUrl);
  });

  test('a higher-precedence source may replace existing non-empty artwork', () => {
    upsertCatalogEntry(entry('plitch', {
      steamAppId: 999,
      coverUrl: 'https://example.test/old.jpg',
    }));
    upsertCatalogEntry(entry('bundled', { steamAppId: STEAM.appId, ...STEAM }));

    const stored = getCatalogEntry('palworld');
    assert.equal(stored?.steamAppId, STEAM.appId);
    assert.equal(stored?.coverUrl, STEAM.coverUrl);
  });

  test('repeated synchronization is idempotent and does not duplicate rows or sources', () => {
    const bundled = entry('bundled', { steamAppId: STEAM.appId, ...STEAM });
    const remote = entry('plitch');
    upsertCatalogEntry(bundled);
    upsertCatalogEntry(remote);
    upsertCatalogEntry(remote);

    const stored = getCatalogEntry('palworld');
    assert.equal(countCatalogEntries(), 1);
    assert.equal(stored?.sources.filter((source) => source.provider === 'plitch').length, 1);
    assert.equal(stored?.coverUrl, STEAM.coverUrl);
  });
});

describe('seed artwork identity verifier', () => {
  const nodeExe = process.execPath;
  const verifier = path.resolve('scripts/verify-catalog-steam-art.mjs');
  let fixtureRoot = '';

  before(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), 'solith-artwork-verifier-'));
  });

  after(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  function verify(games: unknown[]) {
    const seedPath = path.join(fixtureRoot, `seed-${Math.random().toString(16).slice(2)}.json`);
    writeFileSync(seedPath, JSON.stringify({ version: 1, games }), 'utf8');
    return spawnSync(nodeExe, [verifier, '--seed', seedPath], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
    });
  }

  test('accepts a valid Steam ID and unresolved entries with absent, null, or zero IDs', () => {
    const result = verify([
      { name: 'Palworld', steamAppId: 1623730 },
      { name: 'Unresolved Absent' },
      { name: 'Unresolved Null', steamAppId: null },
      { name: 'Unresolved Zero', steamAppId: 0 },
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });

  test('rejects a Steam ID in the known fabricated range', () => {
    const result = verify([{ name: 'Synthetic', steamAppId: 9000000 }]);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /synthetic_fake_steam_id/);
  });

  test('rejects a CDN URL derived from a fabricated ID even without steamAppId', () => {
    const result = verify([{
      name: 'Synthetic URL',
      coverUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/9000001/library_600x900_2x.jpg',
    }]);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /synthetic_fake_steam_url/);
  });
});
