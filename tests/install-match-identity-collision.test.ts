import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { matchInstalledToCatalog, resolveCatalogMatch } from '../src/core/install-discovery/match.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';
import type { RawInstalledGame } from '../src/core/install-discovery/types.ts';

/**
 * Hostile identity-collision regression tests for src/core/install-discovery/match.ts.
 *
 * Prior behavior: when an installed executable's basename matched multiple catalog
 * entries and the display name did not exactly match any candidate, the code fell
 * through to `candidates[0]` — an arbitrary pick with no identity verification. That
 * bug is what these tests exist to keep fixed: ambiguous executable-basename-alone
 * evidence must NEVER resolve to a single canonical game (AMBIGUOUS, not a guess),
 * while genuinely disambiguating evidence (steamAppId, an exact single-match title)
 * must still resolve cleanly (EXACT / HIGH).
 *
 * All catalog/install fixtures below are invented-but-plausible test data, not real
 * telemetry. No game process is touched.
 */

function entry(overrides: Partial<TrainerCatalogEntry> & Pick<TrainerCatalogEntry, 'catalogGameId' | 'displayName' | 'executables'>): TrainerCatalogEntry {
  return {
    categories: [],
    verificationStatus: 'community',
    sources: [{ provider: 'bundled', url: 'bundled://test' }],
    hasModPack: false,
    cheatCount: 0,
    searchableText: overrides.displayName.toLowerCase(),
    ...overrides,
  };
}

function installed(overrides: Partial<RawInstalledGame> & Pick<RawInstalledGame, 'installPath'>): RawInstalledGame {
  return {
    platform: 'manual',
    ...overrides,
  };
}

const NOW = new Date().toISOString();

describe('install-discovery identity collisions — generic executable basenames', () => {
  const GENERIC_EXE_CASES: Array<{ label: string; exe: string; catalogA: TrainerCatalogEntry; catalogB: TrainerCatalogEntry }> = [
    {
      label: 'game.exe',
      exe: 'Game.exe',
      catalogA: entry({ catalogGameId: 'unrelated-indie-a', displayName: 'Unrelated Indie Game A', executables: ['Game.exe'], steamAppId: 601001 }),
      catalogB: entry({ catalogGameId: 'unrelated-indie-b', displayName: 'Unrelated Indie Game B', executables: ['Game.exe'], steamAppId: 601002 }),
    },
    {
      label: 'shipping.exe',
      exe: 'Shipping.exe',
      catalogA: entry({ catalogGameId: 'ue-title-a', displayName: 'Unreal Title A', executables: ['Shipping.exe'], steamAppId: 602001 }),
      catalogB: entry({ catalogGameId: 'ue-title-b', displayName: 'Unreal Title B', executables: ['Shipping.exe'], steamAppId: 602002 }),
    },
    {
      label: 'win64-shipping.exe',
      exe: 'Win64-Shipping.exe',
      catalogA: entry({ catalogGameId: 'ue-win64-a', displayName: 'Frontier Assault', executables: ['Win64-Shipping.exe'], steamAppId: 603001 }),
      catalogB: entry({ catalogGameId: 'ue-win64-b', displayName: 'Frontier Assault Redux', executables: ['Win64-Shipping.exe'], steamAppId: 603002 }),
    },
  ];

  for (const { label, exe, catalogA, catalogB } of GENERIC_EXE_CASES) {
    describe(`generic basename: ${label}`, () => {
      const catalog = [catalogA, catalogB];

      test('exe-basename-alone evidence (no title, no steamAppId) never resolves to a single game', () => {
        const game = installed({
          installPath: `C:/Games/Mystery-${label}`,
          executablePath: `C:/Games/Mystery-${label}/${exe}`,
        });
        const resolution = resolveCatalogMatch(
          game,
          new Map(catalog.filter((c) => c.steamAppId != null).map((c) => [c.steamAppId as number, c])),
          new Map([[exe.toLowerCase(), catalog]]),
        );
        assert.equal(resolution.status, 'AMBIGUOUS');
        assert.equal(resolution.entry, undefined);
        assert.equal(resolution.candidates?.length, 2);

        const records = matchInstalledToCatalog([game], catalog, NOW);
        assert.equal(records[0].catalogGameId, undefined);
        assert.equal(records[0].catalogMatchStatus, 'AMBIGUOUS');
      });

      test('an exact, single-match display name resolves HIGH to the right candidate', () => {
        const game = installed({
          installPath: `C:/Games/${catalogB.displayName}`,
          executablePath: `C:/Games/${catalogB.displayName}/${exe}`,
          displayName: catalogB.displayName,
        });
        const records = matchInstalledToCatalog([game], catalog, NOW);
        assert.equal(records[0].catalogGameId, catalogB.catalogGameId);
        assert.equal(records[0].catalogMatchStatus, 'HIGH');
      });

      test('steamAppId resolves EXACT regardless of the basename collision', () => {
        const game = installed({
          installPath: `C:/Games/${catalogA.displayName}`,
          executablePath: `C:/Games/${catalogA.displayName}/${exe}`,
          steamAppId: catalogA.steamAppId,
        });
        const records = matchInstalledToCatalog([game], catalog, NOW);
        assert.equal(records[0].catalogGameId, catalogA.catalogGameId);
        assert.equal(records[0].catalogMatchStatus, 'EXACT');
      });

      test('a display name matching neither candidate stays AMBIGUOUS, never a fallback pick', () => {
        const game = installed({
          installPath: `C:/Games/Something-Else-${label}`,
          executablePath: `C:/Games/Something-Else-${label}/${exe}`,
          displayName: 'Completely Unrelated Title',
        });
        const records = matchInstalledToCatalog([game], catalog, NOW);
        assert.equal(records[0].catalogGameId, undefined);
        assert.equal(records[0].catalogMatchStatus, 'AMBIGUOUS');
      });
    });
  }
});

describe('install-discovery identity collisions — real title-family collisions', () => {
  type FamilyCase = {
    label: string;
    exe: string;
    entries: TrainerCatalogEntry[];
  };

  const FAMILY_CASES: FamilyCase[] = [
    {
      label: 'Dark Souls / II / III',
      exe: 'DarkSouls.exe',
      entries: [
        entry({ catalogGameId: 'dark-souls', displayName: 'Dark Souls', executables: ['DarkSouls.exe'], steamAppId: 211420 }),
        entry({ catalogGameId: 'dark-souls-2', displayName: 'Dark Souls II', executables: ['DarkSouls.exe'], steamAppId: 236430 }),
        entry({ catalogGameId: 'dark-souls-3', displayName: 'Dark Souls III', executables: ['DarkSouls.exe'], steamAppId: 374320 }),
      ],
    },
    {
      label: 'Final Fantasy VII / Remake / Rebirth',
      exe: 'ff7.exe',
      entries: [
        entry({ catalogGameId: 'ff7', displayName: 'Final Fantasy VII', executables: ['ff7.exe'], steamAppId: 39140 }),
        entry({ catalogGameId: 'ff7-remake', displayName: 'Final Fantasy VII Remake', executables: ['ff7.exe'], steamAppId: 1462040 }),
        entry({ catalogGameId: 'ff7-rebirth', displayName: 'Final Fantasy VII Rebirth', executables: ['ff7.exe'], steamAppId: 2909400 }),
      ],
    },
    {
      label: 'Oblivion / Oblivion Remastered',
      exe: 'Oblivion.exe',
      entries: [
        entry({ catalogGameId: 'oblivion', displayName: 'The Elder Scrolls IV: Oblivion', executables: ['Oblivion.exe'], steamAppId: 22330 }),
        entry({ catalogGameId: 'oblivion-remastered', displayName: 'The Elder Scrolls IV: Oblivion Remastered', executables: ['Oblivion.exe'], steamAppId: 2623190 }),
      ],
    },
    {
      label: 'DOOM / DOOM Eternal',
      exe: 'DOOM.exe',
      entries: [
        entry({ catalogGameId: 'doom-2016', displayName: 'DOOM', executables: ['DOOM.exe'], steamAppId: 379720 }),
        entry({ catalogGameId: 'doom-eternal', displayName: 'DOOM Eternal', executables: ['DOOM.exe'], steamAppId: 782330 }),
      ],
    },
    {
      label: 'demo / full',
      exe: 'Voyager.exe',
      entries: [
        entry({ catalogGameId: 'voyager-demo', displayName: 'Voyager Demo', executables: ['Voyager.exe'], steamAppId: 701001 }),
        entry({ catalogGameId: 'voyager-full', displayName: 'Voyager', executables: ['Voyager.exe'], steamAppId: 701002 }),
      ],
    },
    {
      label: 'server / client',
      exe: 'Outpost.exe',
      entries: [
        entry({ catalogGameId: 'outpost-server', displayName: 'Outpost Dedicated Server', executables: ['Outpost.exe'], steamAppId: 702001 }),
        entry({ catalogGameId: 'outpost-client', displayName: 'Outpost', executables: ['Outpost.exe'], steamAppId: 702002 }),
      ],
    },
    {
      label: 'benchmark / game',
      exe: 'Ridgeline.exe',
      entries: [
        entry({ catalogGameId: 'ridgeline-benchmark', displayName: 'Ridgeline Benchmark', executables: ['Ridgeline.exe'], steamAppId: 703001 }),
        entry({ catalogGameId: 'ridgeline-game', displayName: 'Ridgeline', executables: ['Ridgeline.exe'], steamAppId: 703002 }),
      ],
    },
    {
      label: 'editor / game',
      exe: 'Foundry.exe',
      entries: [
        entry({ catalogGameId: 'foundry-editor', displayName: 'Foundry Editor', executables: ['Foundry.exe'], steamAppId: 704001 }),
        entry({ catalogGameId: 'foundry-game', displayName: 'Foundry', executables: ['Foundry.exe'], steamAppId: 704002 }),
      ],
    },
    {
      label: 'PTR / retail',
      exe: 'Warband.exe',
      entries: [
        entry({ catalogGameId: 'warband-ptr', displayName: 'Warband PTR', executables: ['Warband.exe'], steamAppId: 705001 }),
        entry({ catalogGameId: 'warband-retail', displayName: 'Warband', executables: ['Warband.exe'], steamAppId: 705002 }),
      ],
    },
  ];

  for (const { label, exe, entries } of FAMILY_CASES) {
    describe(label, () => {
      test('basename-alone evidence never collapses the family to a single game', () => {
        const game = installed({
          installPath: `C:/Games/${label.replace(/[^a-z0-9]+/gi, '-')}`,
          executablePath: `C:/Games/${label.replace(/[^a-z0-9]+/gi, '-')}/${exe}`,
        });
        const records = matchInstalledToCatalog([game], entries, NOW);
        assert.equal(records[0].catalogGameId, undefined, `${label}: must not arbitrarily pick a family member`);
        assert.equal(records[0].catalogMatchStatus, 'AMBIGUOUS');
      });

      test('an exact single-match title resolves HIGH to the correct family member', () => {
        const target = entries[entries.length - 1];
        const game = installed({
          installPath: `C:/Games/${target.displayName}`,
          executablePath: `C:/Games/${target.displayName}/${exe}`,
          displayName: target.displayName,
        });
        const records = matchInstalledToCatalog([game], entries, NOW);
        assert.equal(records[0].catalogGameId, target.catalogGameId);
        assert.equal(records[0].catalogMatchStatus, 'HIGH');
      });

      test('steamAppId resolves EXACT to the correct family member regardless of shared exe', () => {
        const target = entries[0];
        const game = installed({
          installPath: `C:/Games/${target.displayName}`,
          executablePath: `C:/Games/${target.displayName}/${exe}`,
          steamAppId: target.steamAppId,
        });
        const records = matchInstalledToCatalog([game], entries, NOW);
        assert.equal(records[0].catalogGameId, target.catalogGameId);
        assert.equal(records[0].catalogMatchStatus, 'EXACT');
      });
    });
  }
});

describe('install-discovery identity collisions — no evidence at all', () => {
  test('no steamAppId and no executablePath is NO_MATCH, not AMBIGUOUS and never a guess', () => {
    const catalog = [
      entry({ catalogGameId: 'solo-a', displayName: 'Solo Title A', executables: ['Solo.exe'] }),
      entry({ catalogGameId: 'solo-b', displayName: 'Solo Title B', executables: ['Solo.exe'] }),
    ];
    const game = installed({ installPath: 'C:/Games/NoExeInfo', displayName: 'Solo Title A' });
    const records = matchInstalledToCatalog([game], catalog, NOW);
    assert.equal(records[0].catalogGameId, undefined);
    assert.equal(records[0].catalogMatchStatus, 'NO_MATCH');
  });

  test('an executable basename registered by zero catalog entries is NO_MATCH', () => {
    const catalog = [entry({ catalogGameId: 'unrelated', displayName: 'Unrelated', executables: ['Other.exe'] })];
    const game = installed({
      installPath: 'C:/Games/NotInCatalog',
      executablePath: 'C:/Games/NotInCatalog/NotInCatalog.exe',
    });
    const records = matchInstalledToCatalog([game], catalog, NOW);
    assert.equal(records[0].catalogGameId, undefined);
    assert.equal(records[0].catalogMatchStatus, 'NO_MATCH');
  });
});
