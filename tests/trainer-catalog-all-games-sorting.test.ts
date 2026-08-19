import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sortAllGamesEntries,
  ALL_GAMES_SORT_MODE_LABELS,
} from '../src/core/trainer-catalog/all-games-sorting.js';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.js';

function makeEntry(overrides: Partial<TrainerCatalogEntry> & { catalogGameId: string }): TrainerCatalogEntry {
  return {
    displayName: overrides.displayName ?? overrides.catalogGameId,
    steamAppId: undefined,
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

describe('sortAllGamesEntries — a-z', () => {
  it('orders entries by display name ascending', () => {
    const entries = [
      makeEntry({ catalogGameId: 'c', displayName: 'Charlie' }),
      makeEntry({ catalogGameId: 'a', displayName: 'Alpha' }),
      makeEntry({ catalogGameId: 'b', displayName: 'Bravo' }),
    ];
    const sorted = sortAllGamesEntries(entries, 'a-z');
    assert.deepEqual(sorted.map((e) => e.catalogGameId), ['a', 'b', 'c']);
  });
});

describe('sortAllGamesEntries — installed-first', () => {
  it('places installed entries before non-installed, then falls back to name', () => {
    const entries = [
      makeEntry({ catalogGameId: 'z', displayName: 'Zeta' }),
      makeEntry({ catalogGameId: 'a', displayName: 'Alpha' }),
    ];
    const sorted = sortAllGamesEntries(entries, 'installed-first', {
      installedCatalogGameIds: new Set(['z']),
    });
    assert.deepEqual(sorted.map((e) => e.catalogGameId), ['z', 'a']);
  });

  it('treats an empty/missing installed set as no entries installed, falling back to name order', () => {
    const entries = [
      makeEntry({ catalogGameId: 'b', displayName: 'Bravo' }),
      makeEntry({ catalogGameId: 'a', displayName: 'Alpha' }),
    ];
    const sorted = sortAllGamesEntries(entries, 'installed-first');
    assert.deepEqual(sorted.map((e) => e.catalogGameId), ['a', 'b']);
  });
});

describe('sortAllGamesEntries — verified-first', () => {
  it('places verified entries before non-verified, then falls back to name', () => {
    const entries = [
      makeEntry({ catalogGameId: 'b', displayName: 'Bravo', verificationStatus: 'community' }),
      makeEntry({ catalogGameId: 'a', displayName: 'Alpha', verificationStatus: 'verified' }),
      makeEntry({ catalogGameId: 'c', displayName: 'Charlie', verificationStatus: 'metadata-only' }),
    ];
    const sorted = sortAllGamesEntries(entries, 'verified-first');
    assert.deepEqual(sorted.map((e) => e.catalogGameId), ['a', 'b', 'c']);
  });
});

describe('sortAllGamesEntries — popular-now', () => {
  it('orders by real catalog_demand evidence, highest first', () => {
    const entries = [
      makeEntry({ catalogGameId: 'low', displayName: 'Low' }),
      makeEntry({ catalogGameId: 'high', displayName: 'High' }),
    ];
    const sorted = sortAllGamesEntries(entries, 'popular-now', {
      popularityByCatalogGameId: new Map([
        ['low', { notifyCount: 1, verificationRequests: 0 }],
        ['high', { notifyCount: 5, verificationRequests: 3 }],
      ]),
    });
    assert.deepEqual(sorted.map((e) => e.catalogGameId), ['high', 'low']);
  });

  it('treats missing popularity evidence as zero, never fabricating a score', () => {
    const entries = [
      makeEntry({ catalogGameId: 'known', displayName: 'Known' }),
      makeEntry({ catalogGameId: 'unknown', displayName: 'Unknown' }),
    ];
    const sorted = sortAllGamesEntries(entries, 'popular-now', {
      popularityByCatalogGameId: new Map([['known', { notifyCount: 2 }]]),
    });
    assert.deepEqual(sorted.map((e) => e.catalogGameId), ['known', 'unknown']);
  });

  it('falls back to name order on a popularity tie', () => {
    const entries = [
      makeEntry({ catalogGameId: 'z', displayName: 'Zeta' }),
      makeEntry({ catalogGameId: 'a', displayName: 'Alpha' }),
    ];
    const sorted = sortAllGamesEntries(entries, 'popular-now');
    assert.deepEqual(sorted.map((e) => e.catalogGameId), ['a', 'z']);
  });
});

describe('sortAllGamesEntries — most-trainer-options', () => {
  it('orders by cheatCount descending, then falls back to name', () => {
    const entries = [
      makeEntry({ catalogGameId: 'few', displayName: 'Few', cheatCount: 2 }),
      makeEntry({ catalogGameId: 'many', displayName: 'Many', cheatCount: 20 }),
      makeEntry({ catalogGameId: 'zero', displayName: 'Zero', cheatCount: 0 }),
    ];
    const sorted = sortAllGamesEntries(entries, 'most-trainer-options');
    assert.deepEqual(sorted.map((e) => e.catalogGameId), ['many', 'few', 'zero']);
  });
});

describe('sortAllGamesEntries — determinism and non-mutation', () => {
  it('does not mutate the input array', () => {
    const entries = [
      makeEntry({ catalogGameId: 'b', displayName: 'Bravo' }),
      makeEntry({ catalogGameId: 'a', displayName: 'Alpha' }),
    ];
    const original = [...entries];
    sortAllGamesEntries(entries, 'a-z');
    assert.deepEqual(entries, original);
  });

  it('produces identical output across repeated calls for the same input', () => {
    const entries = [
      makeEntry({ catalogGameId: 'b', displayName: 'Bravo', cheatCount: 5 }),
      makeEntry({ catalogGameId: 'a', displayName: 'Alpha', cheatCount: 5 }),
    ];
    const first = sortAllGamesEntries(entries, 'most-trainer-options').map((e) => e.catalogGameId);
    const second = sortAllGamesEntries(entries, 'most-trainer-options').map((e) => e.catalogGameId);
    assert.deepEqual(first, second);
  });
});

describe('sortAllGamesEntries — recommended', () => {
  it('reuses the existing §3.3 ranking model verbatim (installed beats verified beats popular)', () => {
    const entries = [
      makeEntry({ catalogGameId: 'installed', displayName: 'Installed', verificationStatus: 'community' }),
      makeEntry({ catalogGameId: 'verified', displayName: 'Verified', verificationStatus: 'verified', hasModPack: true }),
      makeEntry({ catalogGameId: 'plain', displayName: 'Plain' }),
    ];
    const sorted = sortAllGamesEntries(entries, 'recommended', {
      installedCatalogGameIds: new Set(['installed']),
    });
    assert.deepEqual(sorted.map((e) => e.catalogGameId), ['installed', 'verified', 'plain']);
  });

  it('re-applies the eligibility boundary like Popular does, via the shared ranking module', () => {
    const excluded = makeEntry({
      catalogGameId: 'excluded',
      displayName: 'Excluded',
      catalogExclusionFlags: ['mmo'],
    });
    const eligible = makeEntry({ catalogGameId: 'eligible', displayName: 'Eligible' });
    const sorted = sortAllGamesEntries([excluded, eligible], 'recommended');
    assert.deepEqual(sorted.map((e) => e.catalogGameId), ['eligible']);
  });
});

describe('sortAllGamesEntries — all-time-popular', () => {
  it('orders by lifetime positive-feedback evidence, distinct from popular-now', () => {
    const entries = [
      makeEntry({ catalogGameId: 'low-lifetime', displayName: 'Low' }),
      makeEntry({ catalogGameId: 'high-lifetime', displayName: 'High' }),
    ];
    const context = {
      // Deliberately opposite ordering from allTimePopularityByCatalogGameId, to prove
      // the two signals are not aliased to the same map.
      popularityByCatalogGameId: new Map([
        ['low-lifetime', { notifyCount: 99 }],
        ['high-lifetime', { notifyCount: 1 }],
      ]),
      allTimePopularityByCatalogGameId: new Map([
        ['low-lifetime', 1],
        ['high-lifetime', 50],
      ]),
    };
    const sorted = sortAllGamesEntries(entries, 'all-time-popular', context);
    assert.deepEqual(sorted.map((e) => e.catalogGameId), ['high-lifetime', 'low-lifetime']);
  });

  it('treats missing lifetime-feedback evidence as zero, never fabricated', () => {
    const entries = [
      makeEntry({ catalogGameId: 'known', displayName: 'Known' }),
      makeEntry({ catalogGameId: 'unknown', displayName: 'Unknown' }),
    ];
    const sorted = sortAllGamesEntries(entries, 'all-time-popular', {
      allTimePopularityByCatalogGameId: new Map([['known', 3]]),
    });
    assert.deepEqual(sorted.map((e) => e.catalogGameId), ['known', 'unknown']);
  });

  it('falls back to name order on a tie', () => {
    const entries = [
      makeEntry({ catalogGameId: 'z', displayName: 'Zeta' }),
      makeEntry({ catalogGameId: 'a', displayName: 'Alpha' }),
    ];
    const sorted = sortAllGamesEntries(entries, 'all-time-popular');
    assert.deepEqual(sorted.map((e) => e.catalogGameId), ['a', 'z']);
  });
});

describe('sortAllGamesEntries — newest-release', () => {
  it('sorts known release dates newest-first', () => {
    const entries = [
      makeEntry({ catalogGameId: 'old', displayName: 'Old', releaseDate: '2010-01-01' }),
      makeEntry({ catalogGameId: 'new', displayName: 'New', releaseDate: '2024-06-15' }),
    ];
    const sorted = sortAllGamesEntries(entries, 'newest-release');
    assert.deepEqual(sorted.map((e) => e.catalogGameId), ['new', 'old']);
  });

  it('sorts unknown release dates after all known dates', () => {
    const entries = [
      makeEntry({ catalogGameId: 'unknown', displayName: 'Unknown' }),
      makeEntry({ catalogGameId: 'known', displayName: 'Known', releaseDate: '2005-01-01' }),
    ];
    const sorted = sortAllGamesEntries(entries, 'newest-release');
    assert.deepEqual(sorted.map((e) => e.catalogGameId), ['known', 'unknown']);
  });

  it('treats a malformed release date the same as unknown — sorts last, never throws', () => {
    const entries = [
      makeEntry({ catalogGameId: 'malformed', displayName: 'Malformed', releaseDate: 'not-a-date' }),
      makeEntry({ catalogGameId: 'known', displayName: 'Known', releaseDate: '2005-01-01' }),
    ];
    assert.doesNotThrow(() => sortAllGamesEntries(entries, 'newest-release'));
    const sorted = sortAllGamesEntries(entries, 'newest-release');
    assert.deepEqual(sorted.map((e) => e.catalogGameId), ['known', 'malformed']);
  });

  it('falls back to name order when both dates are unknown', () => {
    const entries = [
      makeEntry({ catalogGameId: 'z', displayName: 'Zeta' }),
      makeEntry({ catalogGameId: 'a', displayName: 'Alpha' }),
    ];
    const sorted = sortAllGamesEntries(entries, 'newest-release');
    assert.deepEqual(sorted.map((e) => e.catalogGameId), ['a', 'z']);
  });
});

describe('sortAllGamesEntries — recently-added', () => {
  it('sorts newest createdAt first, unknown last', () => {
    const entries = [
      makeEntry({ catalogGameId: 'legacy', displayName: 'Legacy' }),
      makeEntry({ catalogGameId: 'recent', displayName: 'Recent', createdAt: '2026-08-01T00:00:00.000Z' }),
      makeEntry({ catalogGameId: 'older', displayName: 'Older', createdAt: '2025-01-01T00:00:00.000Z' }),
    ];
    const sorted = sortAllGamesEntries(entries, 'recently-added');
    assert.deepEqual(sorted.map((e) => e.catalogGameId), ['recent', 'older', 'legacy']);
  });
});

describe('sortAllGamesEntries — recently-updated', () => {
  it('sorts newest contentUpdatedAt first, unknown last', () => {
    const entries = [
      makeEntry({ catalogGameId: 'never-updated', displayName: 'Never' }),
      makeEntry({ catalogGameId: 'updated-recently', displayName: 'Recent', contentUpdatedAt: '2026-08-01T00:00:00.000Z' }),
      makeEntry({ catalogGameId: 'updated-earlier', displayName: 'Earlier', contentUpdatedAt: '2025-01-01T00:00:00.000Z' }),
    ];
    const sorted = sortAllGamesEntries(entries, 'recently-updated');
    assert.deepEqual(sorted.map((e) => e.catalogGameId), ['updated-recently', 'updated-earlier', 'never-updated']);
  });
});

describe('ALL_GAMES_SORT_MODE_LABELS', () => {
  it('has a label for every implemented sort mode — all 10 ROADMAP §3.5 keys', () => {
    assert.deepEqual(Object.keys(ALL_GAMES_SORT_MODE_LABELS).sort(), [
      'a-z',
      'all-time-popular',
      'installed-first',
      'most-trainer-options',
      'newest-release',
      'popular-now',
      'recently-added',
      'recently-updated',
      'recommended',
      'verified-first',
    ]);
  });

  it('labels match exact ROADMAP terminology', () => {
    assert.equal(ALL_GAMES_SORT_MODE_LABELS['recently-added'], 'Recently added to SOLITH');
    assert.equal(ALL_GAMES_SORT_MODE_LABELS['most-trainer-options'], 'Most trainer options');
    assert.equal(ALL_GAMES_SORT_MODE_LABELS['all-time-popular'], 'All-time popular');
  });
});
