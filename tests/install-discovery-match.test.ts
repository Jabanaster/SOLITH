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

  test('a modern, high-numbered steamAppId (>= 1,000,000) still resolves EXACT', () => {
    // Regression test: bySteamId index construction used to silently drop any
    // catalog entry whose steamAppId was >= 1_000_000, so real modern Steam App
    // IDs (they have exceeded 1 million for roughly a decade) never became
    // EXACT-match-eligible. 2909400 is Final Fantasy VII Rebirth's real Steam
    // App ID.
    const catalogWithModernId: TrainerCatalogEntry[] = [
      ...CATALOG,
      {
        catalogGameId: 'ff7-rebirth',
        displayName: 'Final Fantasy VII Rebirth',
        steamAppId: 2909400,
        executables: ['FF7Rebirth.exe'],
        categories: ['RPG'],
        verificationStatus: 'community',
        sources: [{ provider: 'bundled', url: 'bundled://test' }],
        hasModPack: false,
        cheatCount: 0,
        searchableText: 'final fantasy vii rebirth',
      },
    ];

    const records = matchInstalledToCatalog(
      [
        {
          platform: 'steam',
          installPath: 'C:/Games/Steam/steamapps/common/FINAL FANTASY VII REBIRTH',
          steamAppId: 2909400,
          displayName: 'Final Fantasy VII Rebirth',
        },
      ],
      catalogWithModernId,
      new Date().toISOString(),
    );

    assert.equal(records[0].catalogGameId, 'ff7-rebirth');
    assert.equal(records[0].catalogMatchStatus, 'EXACT');
  });
});
