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
