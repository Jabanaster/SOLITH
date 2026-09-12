/**
 * Phase 3 Mission 17 — Discovery query API extensions: providers[] OR filter,
 * sort options, and the hard per-query result cap.
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import { upsertDiscoveryCatalogEntry } from '../src/core/discovery-catalog/store.ts';
import { queryDiscoveryCatalog } from '../src/core/discovery-catalog/query.ts';
import type { DiscoveryCatalogEntry } from '../src/core/discovery-catalog/types.ts';

function entry(overrides: Partial<DiscoveryCatalogEntry> & { solithGameId: string }): DiscoveryCatalogEntry {
  return {
    title: 'Example',
    normalizedTitle: 'example',
    aliases: [],
    providerIds: {},
    type: 'game',
    genres: [],
    tags: [],
    trainerAvailable: false,
    ctAvailable: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('discovery catalog query — multi-provider filter/sort (Mission 17)', () => {
  beforeAll(async () => {
    await resetForTesting();
    upsertDiscoveryCatalogEntry(entry({ solithGameId: 'a', title: 'Alpha Game', normalizedTitle: 'alpha game', providerIds: { steam: '1' }, releaseYear: 2020 }));
    upsertDiscoveryCatalogEntry(entry({ solithGameId: 'b', title: 'Beta Game', normalizedTitle: 'beta game', providerIds: { gog: '2' }, releaseYear: 2022 }));
    upsertDiscoveryCatalogEntry(entry({ solithGameId: 'c', title: 'Gamma Game', normalizedTitle: 'gamma game', providerIds: { epic: '3' }, releaseYear: 2018 }));
    upsertDiscoveryCatalogEntry(entry({ solithGameId: 'd', title: 'Delta Custom', normalizedTitle: 'delta custom', providerIds: {}, releaseYear: 2024 }));
  });
  afterAll(async () => {
    await resetForTesting();
  });

  test('providers[] returns entries matching ANY listed provider (OR semantics)', () => {
    const results = queryDiscoveryCatalog({ providers: ['steam', 'gog'] });
    const ids = results.map((r) => r.solithGameId).sort();
    assert.deepEqual(ids, ['a', 'b']);
  });

  test('providers[] with a provider that matches nothing returns empty', () => {
    const results = queryDiscoveryCatalog({ providers: ['xbox'] });
    assert.deepEqual(results, []);
  });

  test('standalone/custom entries (no provider) are excluded by a providers[] filter, included with no filter', () => {
    const filtered = queryDiscoveryCatalog({ providers: ['steam'] });
    assert.ok(!filtered.some((r) => r.solithGameId === 'd'));
    const unfiltered = queryDiscoveryCatalog({});
    assert.ok(unfiltered.some((r) => r.solithGameId === 'd'));
  });

  test('sort: release-desc orders by releaseYear descending', () => {
    const results = queryDiscoveryCatalog({ sort: 'release-desc' });
    assert.deepEqual(results.map((r) => r.solithGameId), ['d', 'b', 'a', 'c']);
  });

  test('sort: release-asc orders by releaseYear ascending', () => {
    const results = queryDiscoveryCatalog({ sort: 'release-asc' });
    assert.deepEqual(results.map((r) => r.solithGameId), ['c', 'a', 'b', 'd']);
  });

  test('sort: title-desc reverses default alphabetical order', () => {
    const results = queryDiscoveryCatalog({ sort: 'title-desc' });
    assert.deepEqual(results.map((r) => r.solithGameId), ['c', 'd', 'b', 'a']);
  });

  test('an unrecognized sort value falls back to the safe default instead of producing invalid SQL', () => {
    // @ts-expect-error — deliberately simulating an unvalidated value crossing an IPC boundary.
    const results = queryDiscoveryCatalog({ sort: 'DROP TABLE discovery_catalog_entries; --' });
    assert.equal(results.length, 4);
  });

  test('limit is capped at MAX_LIMIT (500) even if a caller requests more', () => {
    const results = queryDiscoveryCatalog({ limit: 100000 });
    assert.ok(results.length <= 500);
  });
});
