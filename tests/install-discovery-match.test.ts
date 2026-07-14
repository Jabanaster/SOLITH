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
});
