import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { matchInstalledToCatalog, countMatchedCatalog } from '../src/core/install-discovery/match.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';

const CATALOG: TrainerCatalogEntry[] = [
  {
    catalogGameId: 'stardew-valley',
    displayName: 'Stardew Valley',
    steamAppId: 413150,
    executables: ['Stardew Valley.exe'],
    categories: ['Farming'],
    verificationStatus: 'verified',
    sources: [{ provider: 'bundled', url: 'bundled://test' }],
    hasModPack: true,
    cheatCount: 4,
    searchableText: 'stardew valley',
  },
  {
    catalogGameId: 'palworld',
    displayName: 'Palworld',
    steamAppId: 1623730,
    executables: ['Palworld-Win64-Shipping.exe'],
    categories: ['Survival'],
    verificationStatus: 'community',
    sources: [{ provider: 'bundled', url: 'bundled://test' }],
    hasModPack: true,
    cheatCount: 2,
    searchableText: 'palworld',
  },
];

describe('install-discovery catalog match', () => {
  test('matches by steamAppId', () => {
    const records = matchInstalledToCatalog(
      [
        {
          platform: 'steam',
          installPath: 'C:/Games/Steam/steamapps/common/Stardew Valley',
          steamAppId: 413150,
          displayName: 'Stardew Valley',
        },
      ],
      CATALOG,
      new Date().toISOString(),
    );
    assert.equal(records.length, 1);
    assert.equal(records[0].catalogGameId, 'stardew-valley');
    assert.equal(countMatchedCatalog(records), 1);
  });

  test('matches by steamAppId even when the appid is 1,000,000 or greater (real modern Steam appids, e.g. Baldur\'s Gate 3 1086940)', () => {
    // Regression: an earlier `steamAppId < 1_000_000` guard on the match
    // index silently excluded any catalog entry with a modern appid from
    // steamAppId-tier matching — caught via real-install validation against
    // Baldur's Gate 3 (appid 1086940), whose install ships no single
    // unambiguous executable to fall back on.
    const records = matchInstalledToCatalog(
      [
        {
          platform: 'steam',
          installPath: 'C:/Games/Steam/steamapps/common/Palworld',
          steamAppId: 1623730,
          displayName: 'Palworld',
        },
      ],
      CATALOG,
      new Date().toISOString(),
    );
    assert.equal(records[0].catalogGameId, 'palworld');
  });

  test('matches by executable basename when app id unknown', () => {
    const records = matchInstalledToCatalog(
      [
        {
          platform: 'epic',
          installPath: 'C:/Games/Palworld',
          executablePath: 'C:/Games/Palworld/Palworld-Win64-Shipping.exe',
          displayName: 'Palworld',
        },
      ],
      CATALOG,
      new Date().toISOString(),
    );
    assert.equal(records[0].catalogGameId, 'palworld');
  });

  test('a steamAppId match is rejected when the recorded executable is a launcher, not the game (trainer-applicability boundary)', () => {
    const records = matchInstalledToCatalog(
      [
        {
          platform: 'steam',
          installPath: 'C:/Games/Steam/steamapps/common/Stardew Valley',
          executablePath: 'C:/Games/Steam/steamapps/common/Stardew Valley/StardewLauncher.exe',
          steamAppId: 413150,
          displayName: 'Stardew Valley',
        },
      ],
      CATALOG,
      new Date().toISOString(),
    );
    assert.equal(records[0].catalogGameId, undefined, 'a launcher must never be accepted as the matched game process');
  });
});
