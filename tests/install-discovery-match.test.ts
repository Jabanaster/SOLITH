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

  test('a steamAppId match is rejected when the recorded executable is a GDK launch-bootstrap helper, even as the sole candidate (Docs/phase3/008 §6b)', () => {
    // Regression: checkExecutableRoleApplicability previously classified an
    // unrecognized executable name in isolation via "sole candidate, no
    // catalog evidence -> primary by elimination" — so a bad catalog record
    // (or a scanner bug) that pointed at a real, non-game GDK bootstrapper
    // would have been wrongly accepted as the matched game process. Exercised
    // here through the actual production caller (matchInstalledToCatalog),
    // not just the isolated checkExecutableRoleApplicability helper.
    const records = matchInstalledToCatalog(
      [
        {
          platform: 'xbox',
          installPath: 'Z:/Games/SomeGdkTitle',
          executablePath: 'Z:/Games/SomeGdkTitle/Content/gamelaunchhelper.exe',
          steamAppId: 413150,
          displayName: 'Stardew Valley',
        },
      ],
      CATALOG,
      new Date().toISOString(),
    );
    assert.equal(records[0].catalogGameId, undefined, 'a GDK launch-bootstrap helper must never be accepted as the matched game process');
  });

  test('a legitimate sole-candidate game executable still resolves through the production caller (no regression from the applicability fix)', () => {
    const records = matchInstalledToCatalog(
      [
        {
          platform: 'steam',
          installPath: 'C:/Games/Steam/steamapps/common/Stardew Valley',
          executablePath: 'C:/Games/Steam/steamapps/common/Stardew Valley/Stardew Valley.exe',
          steamAppId: 413150,
          displayName: 'Stardew Valley',
        },
      ],
      CATALOG,
      new Date().toISOString(),
    );
    assert.equal(records[0].catalogGameId, 'stardew-valley');
  });

  test('a steamAppId match survives the production caller even when the executable name merely contains "gamelaunchhelper" (no overbroad ban)', () => {
    const records = matchInstalledToCatalog(
      [
        {
          platform: 'xbox',
          installPath: 'Z:/Games/SomeOtherTitle',
          executablePath: 'Z:/Games/SomeOtherTitle/notgamelaunchhelper.exe',
          steamAppId: 413150,
          displayName: 'Stardew Valley',
        },
      ],
      CATALOG,
      new Date().toISOString(),
    );
    assert.equal(records[0].catalogGameId, 'stardew-valley', 'a name that merely contains "gamelaunchhelper" must not be rejected by this rule');
  });
});
