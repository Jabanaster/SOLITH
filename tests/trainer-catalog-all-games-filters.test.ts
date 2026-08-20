import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterTrainerLibraryEntries,
  type TrainerLibraryFilterState,
} from '../src/core/trainer-catalog/all-games-filters.js';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.js';

function entry(overrides: Partial<TrainerCatalogEntry> & { catalogGameId: string }): TrainerCatalogEntry {
  return {
    displayName: overrides.catalogGameId,
    executables: [],
    categories: [],
    verificationStatus: 'community',
    sources: [],
    hasModPack: false,
    cheatCount: 0,
    searchableText: '',
    ...overrides,
  };
}

const none: TrainerLibraryFilterState = { availability: [], catalog: [] };

describe('§3.6 trainer-library derived filters', () => {
  it('returns all entries when no §3.6 filters are active', () => {
    const input = [entry({ catalogGameId: 'a' }), entry({ catalogGameId: 'b' })];
    assert.deepEqual(filterTrainerLibraryEntries(input, none), input);
  });

  it('ORs Availability selections and ANDs them with Catalog selections', () => {
    const input = [
      entry({ catalogGameId: 'installed', verificationStatus: 'community' }),
      entry({ catalogGameId: 'verified', verificationStatus: 'verified' }),
      entry({ catalogGameId: 'other', verificationStatus: 'community' }),
    ];
    const filtered = filterTrainerLibraryEntries(
      input,
      { availability: ['installed', 'verified'], catalog: ['popular'] },
      {
        installedCatalogGameIds: new Set(['installed']),
        popularCatalogGameIds: new Set(['verified', 'other']),
      },
    );
    assert.deepEqual(filtered.map((e) => e.catalogGameId), ['verified']);
  });

  it('supports installed, not-installed, trainer/profile, verified, and community/unverified evidence', () => {
    const input = [
      entry({ catalogGameId: 'installed', hasModPack: false, verificationStatus: 'community' }),
      entry({ catalogGameId: 'trainer', hasModPack: true, verificationStatus: 'metadata-only' }),
      entry({ catalogGameId: 'verified', verificationStatus: 'verified' }),
    ];
    const context = { installedCatalogGameIds: new Set(['installed']) };
    assert.deepEqual(filterTrainerLibraryEntries(input, { availability: ['installed'], catalog: [] }, context).map((e) => e.catalogGameId), ['installed']);
    assert.deepEqual(filterTrainerLibraryEntries(input, { availability: ['not-installed'], catalog: [] }, context).map((e) => e.catalogGameId), ['trainer', 'verified']);
    assert.deepEqual(filterTrainerLibraryEntries(input, { availability: ['has-trainer-profile'], catalog: [] }, context).map((e) => e.catalogGameId), ['trainer']);
    assert.deepEqual(filterTrainerLibraryEntries(input, { availability: ['verified'], catalog: [] }, context).map((e) => e.catalogGameId), ['verified']);
    assert.deepEqual(filterTrainerLibraryEntries(input, { availability: ['community-unverified'], catalog: [] }, context).map((e) => e.catalogGameId), ['installed', 'trainer']);
  });

  it('keeps Popular and Niche/deep catalog as exact complements when projection evidence exists', () => {
    const input = [entry({ catalogGameId: 'popular' }), entry({ catalogGameId: 'niche' })];
    const context = { popularCatalogGameIds: new Set(['popular']) };
    assert.deepEqual(filterTrainerLibraryEntries(input, { availability: [], catalog: ['popular'] }, context).map((e) => e.catalogGameId), ['popular']);
    assert.deepEqual(filterTrainerLibraryEntries(input, { availability: [], catalog: ['niche-deep-catalog'] }, context).map((e) => e.catalogGameId), ['niche']);
  });

  it('does not fabricate niche membership when Popular projection evidence is unavailable', () => {
    const input = [entry({ catalogGameId: 'unknown' })];
    assert.deepEqual(filterTrainerLibraryEntries(input, { availability: [], catalog: ['niche-deep-catalog'] }), []);
  });

  it('New release and Recently added require valid explicit timestamps; unknown/malformed values do not match', () => {
    const input = [
      entry({ catalogGameId: 'known-release', releaseDate: '2026-01-01' }),
      entry({ catalogGameId: 'known-added', createdAt: '2026-08-01T00:00:00.000Z' }),
      entry({ catalogGameId: 'malformed', releaseDate: 'not-a-date', createdAt: 'nope' }),
      entry({ catalogGameId: 'unknown' }),
    ];
    assert.deepEqual(filterTrainerLibraryEntries(input, { availability: [], catalog: ['new-release'] }).map((e) => e.catalogGameId), ['known-release']);
    assert.deepEqual(filterTrainerLibraryEntries(input, { availability: [], catalog: ['recently-added'] }).map((e) => e.catalogGameId), ['known-added']);
  });

  it('does not mutate the source array', () => {
    const input = [entry({ catalogGameId: 'a' }), entry({ catalogGameId: 'b' })];
    const snapshot = input.slice();
    filterTrainerLibraryEntries(input, { availability: ['not-installed'], catalog: [] });
    assert.deepEqual(input, snapshot);
  });
});

describe('§3.6 Launcher filter — installed-platform evidence only', () => {
  const ALL_PLATFORMS: Array<'steam' | 'epic' | 'gog' | 'xbox' | 'ubisoft' | 'ea' | 'battlenet' | 'manual'> = [
    'steam', 'epic', 'gog', 'xbox', 'ubisoft', 'ea', 'battlenet', 'manual',
  ];

  it('matches an installed game to its actual detected platform, for all 8 launcher values', () => {
    for (const platform of ALL_PLATFORMS) {
      const input = [entry({ catalogGameId: 'g' })];
      const context = { installedPlatformsByCatalogGameId: new Map([['g', new Set([platform])]]) };
      const result = filterTrainerLibraryEntries(input, { availability: [], catalog: [], launcher: [platform] }, context);
      assert.deepEqual(result.map((e) => e.catalogGameId), ['g'], `expected platform ${platform} to match`);
    }
  });

  it('an uninstalled entry does not match any launcher filter', () => {
    const input = [entry({ catalogGameId: 'uninstalled' })];
    const context = { installedPlatformsByCatalogGameId: new Map() };
    for (const platform of ALL_PLATFORMS) {
      assert.deepEqual(
        filterTrainerLibraryEntries(input, { availability: [], catalog: [], launcher: [platform] }, context),
        [],
      );
    }
  });

  it('ORs multiple launcher selections', () => {
    const input = [entry({ catalogGameId: 'steam-game' }), entry({ catalogGameId: 'gog-game' }), entry({ catalogGameId: 'epic-game' })];
    const context = {
      installedPlatformsByCatalogGameId: new Map([
        ['steam-game', new Set(['steam'])],
        ['gog-game', new Set(['gog'])],
        ['epic-game', new Set(['epic'])],
      ]),
    };
    const result = filterTrainerLibraryEntries(input, { availability: [], catalog: [], launcher: ['steam', 'gog'] }, context);
    assert.deepEqual(result.map((e) => e.catalogGameId), ['steam-game', 'gog-game']);
  });

  it('ANDs Launcher with Availability', () => {
    const input = [
      entry({ catalogGameId: 'steam-verified', verificationStatus: 'verified' }),
      entry({ catalogGameId: 'steam-community', verificationStatus: 'community' }),
    ];
    const context = {
      installedCatalogGameIds: new Set(['steam-verified', 'steam-community']),
      installedPlatformsByCatalogGameId: new Map([
        ['steam-verified', new Set(['steam'])],
        ['steam-community', new Set(['steam'])],
      ]),
    };
    const result = filterTrainerLibraryEntries(input, { availability: ['verified'], catalog: [], launcher: ['steam'] }, context);
    assert.deepEqual(result.map((e) => e.catalogGameId), ['steam-verified']);
  });

  it('ANDs Launcher with Catalog', () => {
    const input = [entry({ catalogGameId: 'a' }), entry({ catalogGameId: 'b' })];
    const context = {
      popularCatalogGameIds: new Set(['a']),
      installedPlatformsByCatalogGameId: new Map([
        ['a', new Set(['steam'])],
        ['b', new Set(['steam'])],
      ]),
    };
    const result = filterTrainerLibraryEntries(input, { availability: [], catalog: ['popular'], launcher: ['steam'] }, context);
    assert.deepEqual(result.map((e) => e.catalogGameId), ['a']);
  });

  it('ANDs Launcher with Genre by composing at the caller — filterTrainerLibraryEntries stays genre-agnostic', () => {
    // Genre filtering happens upstream (categories search param); this module only
    // needs to prove Launcher composes with AND like every other §3.6 category.
    const input = [entry({ catalogGameId: 'a', categories: ['RPG'] })];
    const context = { installedPlatformsByCatalogGameId: new Map([['a', new Set(['steam'])]]) };
    assert.deepEqual(
      filterTrainerLibraryEntries(input, { availability: [], catalog: [], launcher: ['steam'] }, context).map((e) => e.catalogGameId),
      ['a'],
    );
    assert.deepEqual(
      filterTrainerLibraryEntries(input, { availability: [], catalog: [], launcher: ['gog'] }, context),
      [],
    );
  });

  it('resets to all entries when Launcher selection is empty', () => {
    const input = [entry({ catalogGameId: 'a' }), entry({ catalogGameId: 'b' })];
    assert.deepEqual(filterTrainerLibraryEntries(input, { availability: [], catalog: [], launcher: [] }), input);
  });

  it('fails safe when platform evidence is missing entirely (no context provided)', () => {
    const input = [entry({ catalogGameId: 'a' })];
    assert.deepEqual(filterTrainerLibraryEntries(input, { availability: [], catalog: [], launcher: ['steam'] }), []);
  });

  it('Standalone maps to the manual platform value, not a fabricated label', () => {
    const input = [entry({ catalogGameId: 'a' })];
    const context = { installedPlatformsByCatalogGameId: new Map([['a', new Set(['manual'])]]) };
    assert.deepEqual(
      filterTrainerLibraryEntries(input, { availability: [], catalog: [], launcher: ['manual'] }, context).map((e) => e.catalogGameId),
      ['a'],
    );
  });

  it('does not infer Steam availability merely from steamAppId', () => {
    const input = [entry({ catalogGameId: 'a', steamAppId: 12345 })];
    // No installedPlatformsByCatalogGameId entry for 'a' at all — steamAppId presence must not substitute.
    const context = { installedPlatformsByCatalogGameId: new Map() };
    assert.deepEqual(filterTrainerLibraryEntries(input, { availability: [], catalog: [], launcher: ['steam'] }, context), []);
  });

  it('omitting launcher entirely preserves existing 19-value behavior', () => {
    const input = [entry({ catalogGameId: 'a' })];
    assert.deepEqual(filterTrainerLibraryEntries(input, { availability: [], catalog: [] }), input);
  });
});

describe('§3.6 final seven — Owned (Availability)', () => {
  it('matches only entries with explicit local ownership confirmation', () => {
    const input = [
      entry({ catalogGameId: 'confirmed', ownedConfirmed: true }),
      entry({ catalogGameId: 'unconfirmed', ownedConfirmed: false }),
      entry({ catalogGameId: 'unknown' }),
    ];
    assert.deepEqual(
      filterTrainerLibraryEntries(input, { availability: ['owned'], catalog: [] }).map((e) => e.catalogGameId),
      ['confirmed'],
    );
  });

  it('does not treat installed as owned — no automatic Installed -> Owned promotion', () => {
    const input = [entry({ catalogGameId: 'installed-only' })];
    const context = { installedCatalogGameIds: new Set(['installed-only']) };
    assert.deepEqual(filterTrainerLibraryEntries(input, { availability: ['owned'], catalog: [] }, context), []);
  });

  it('an uninstalled but confirmed-owned entry still matches', () => {
    const input = [entry({ catalogGameId: 'uninstalled-owned', ownedConfirmed: true })];
    const context = { installedCatalogGameIds: new Set<string>() };
    assert.deepEqual(
      filterTrainerLibraryEntries(input, { availability: ['owned'], catalog: [] }, context).map((e) => e.catalogGameId),
      ['uninstalled-owned'],
    );
  });

  it('ORs Owned with other Availability selections, ANDs with Catalog', () => {
    const input = [
      entry({ catalogGameId: 'owned', ownedConfirmed: true }),
      entry({ catalogGameId: 'verified', verificationStatus: 'verified' }),
      entry({ catalogGameId: 'neither', verificationStatus: 'community' }),
    ];
    const result = filterTrainerLibraryEntries(input, { availability: ['owned', 'verified'], catalog: [] });
    assert.deepEqual(result.map((e) => e.catalogGameId), ['owned', 'verified']);
  });
});

describe('§3.6 final seven — Mode (curated capability evidence only)', () => {
  it('matches explicit true for each of the 4 implemented mode values', () => {
    const cases: Array<['single-player' | 'offline-co-op' | 'local-multiplayer' | 'online-features-present', string]> = [
      ['single-player', 'singlePlayer'],
      ['offline-co-op', 'offlineCoop'],
      ['local-multiplayer', 'localMultiplayer'],
      ['online-features-present', 'onlineFeaturesPresent'],
    ];
    for (const [filter, field] of cases) {
      const input = [entry({ catalogGameId: 'g', modeCapabilities: { [field]: true } })];
      assert.deepEqual(
        filterTrainerLibraryEntries(input, { availability: [], catalog: [], mode: [filter] }).map((e) => e.catalogGameId),
        ['g'],
        `expected ${filter} to match on ${field}: true`,
      );
    }
  });

  it('explicit false does not match', () => {
    const input = [entry({ catalogGameId: 'g', modeCapabilities: { singlePlayer: false } })];
    assert.deepEqual(filterTrainerLibraryEntries(input, { availability: [], catalog: [], mode: ['single-player'] }), []);
  });

  it('unknown (no modeCapabilities at all) does not match', () => {
    const input = [entry({ catalogGameId: 'g' })];
    assert.deepEqual(filterTrainerLibraryEntries(input, { availability: [], catalog: [], mode: ['single-player'] }), []);
  });

  it('generic co-op category alone does not imply offline co-op', () => {
    const input = [entry({ catalogGameId: 'g', categories: ['Co-op'] })];
    assert.deepEqual(filterTrainerLibraryEntries(input, { availability: [], catalog: [], mode: ['offline-co-op'] }), []);
  });

  it('generic multiplayer category alone does not imply local multiplayer', () => {
    const input = [entry({ catalogGameId: 'g', categories: ['Multiplayer'] })];
    assert.deepEqual(filterTrainerLibraryEntries(input, { availability: [], catalog: [], mode: ['local-multiplayer'] }), []);
  });

  it('offline co-op and local multiplayer are independent flags — one true does not imply the other', () => {
    const input = [entry({ catalogGameId: 'g', modeCapabilities: { offlineCoop: true, localMultiplayer: false } })];
    assert.deepEqual(
      filterTrainerLibraryEntries(input, { availability: [], catalog: [], mode: ['offline-co-op'] }).map((e) => e.catalogGameId),
      ['g'],
    );
    assert.deepEqual(filterTrainerLibraryEntries(input, { availability: [], catalog: [], mode: ['local-multiplayer'] }), []);
  });

  it('online-features-present is informational only — never implied by antiCheat evidence alone', () => {
    const input = [entry({ catalogGameId: 'g', antiCheat: 'protected-multiplayer' })];
    assert.deepEqual(filterTrainerLibraryEntries(input, { availability: [], catalog: [], mode: ['online-features-present'] }), []);
  });

  it('ORs within Mode, ANDs Mode with Availability', () => {
    const input = [
      entry({ catalogGameId: 'sp', modeCapabilities: { singlePlayer: true }, verificationStatus: 'verified' }),
      entry({ catalogGameId: 'coop', modeCapabilities: { offlineCoop: true }, verificationStatus: 'community' }),
    ];
    const orResult = filterTrainerLibraryEntries(input, { availability: [], catalog: [], mode: ['single-player', 'offline-co-op'] });
    assert.deepEqual(orResult.map((e) => e.catalogGameId), ['sp', 'coop']);
    const andResult = filterTrainerLibraryEntries(input, { availability: ['verified'], catalog: [], mode: ['single-player', 'offline-co-op'] });
    assert.deepEqual(andResult.map((e) => e.catalogGameId), ['sp']);
  });

  it('omitting mode entirely preserves existing behavior (backward compatible)', () => {
    const input = [entry({ catalogGameId: 'a' })];
    assert.deepEqual(filterTrainerLibraryEntries(input, { availability: [], catalog: [] }), input);
  });
});

describe('§3.6 final seven — All-time classic (curated flag, no fabricated threshold)', () => {
  it('matches only an explicit curated true', () => {
    const input = [
      entry({ catalogGameId: 'classic', isAllTimeClassic: true }),
      entry({ catalogGameId: 'not-classic', isAllTimeClassic: false }),
      entry({ catalogGameId: 'unknown' }),
    ];
    assert.deepEqual(
      filterTrainerLibraryEntries(input, { availability: [], catalog: ['all-time-classic'] }).map((e) => e.catalogGameId),
      ['classic'],
    );
  });

  it('does not derive classic status from releaseDate or popularity alone', () => {
    const input = [entry({ catalogGameId: 'old-and-popular', releaseDate: '1998-01-01' })];
    assert.deepEqual(filterTrainerLibraryEntries(input, { availability: [], catalog: ['all-time-classic'] }), []);
  });

  it('ORs with other Catalog selections', () => {
    const input = [
      entry({ catalogGameId: 'classic', isAllTimeClassic: true }),
      entry({ catalogGameId: 'new', releaseDate: '2026-01-01' }),
    ];
    const result = filterTrainerLibraryEntries(input, { availability: [], catalog: ['all-time-classic', 'new-release'] });
    assert.deepEqual(result.map((e) => e.catalogGameId), ['classic', 'new']);
  });
});
