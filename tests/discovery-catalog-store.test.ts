/**
 * Discovery Catalog — store tests (Mission 6, Phase 1 online-foundation).
 * Isolated from shared project data via resetForTesting() (:memory: sql.js),
 * following tests/artwork-cache-store.test.ts's pattern.
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import {
  upsertDiscoveryCatalogEntry,
  getDiscoveryCatalogEntry,
  countDiscoveryCatalogEntries,
} from '../src/core/discovery-catalog/store.ts';
import type { DiscoveryCatalogEntry } from '../src/core/discovery-catalog/types.ts';

function entry(overrides: Partial<DiscoveryCatalogEntry> & { solithGameId: string }): DiscoveryCatalogEntry {
  return {
    title: 'Example Game',
    normalizedTitle: 'example game',
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

describe('discovery_catalog_entries store', () => {
  beforeAll(async () => {
    await resetForTesting();
  });

  afterAll(async () => {
    await resetForTesting();
  });

  test('round-trips an entry through upsert/get', () => {
    upsertDiscoveryCatalogEntry(
      entry({
        solithGameId: 'stardew-valley',
        title: 'Stardew Valley',
        normalizedTitle: 'stardew valley',
        aliases: ['SDV'],
        providerIds: { steam: '413150' },
        releaseDate: '2016-02-26',
        releaseYear: 2016,
        genres: ['Simulation'],
        tags: ['farming'],
        trainerAvailable: true,
      }),
    );
    const read = getDiscoveryCatalogEntry('stardew-valley');
    assert.ok(read);
    assert.equal(read!.title, 'Stardew Valley');
    assert.deepEqual(read!.aliases, ['SDV']);
    assert.deepEqual(read!.providerIds, { steam: '413150' });
    assert.equal(read!.releaseYear, 2016);
    assert.equal(read!.trainerAvailable, true);
    assert.equal(read!.ctAvailable, false);
  });

  test('upsert dedups by solithGameId — same key never accumulates rows', () => {
    upsertDiscoveryCatalogEntry(entry({ solithGameId: 'dedup-me', title: 'First Title' }));
    upsertDiscoveryCatalogEntry(entry({ solithGameId: 'dedup-me', title: 'Updated Title', trainerAvailable: true }));
    const read = getDiscoveryCatalogEntry('dedup-me');
    assert.equal(read!.title, 'Updated Title');
    assert.equal(read!.trainerAvailable, true);
  });

  test('optional fields (releaseDate/releaseYear) are omitted, not null, when never set', () => {
    upsertDiscoveryCatalogEntry(entry({ solithGameId: 'no-release-date' }));
    const read = getDiscoveryCatalogEntry('no-release-date');
    assert.equal(read!.releaseDate, undefined);
    assert.equal(read!.releaseYear, undefined);
  });

  test('getDiscoveryCatalogEntry returns null for an unknown id', () => {
    assert.equal(getDiscoveryCatalogEntry('does-not-exist'), null);
  });

  test('countDiscoveryCatalogEntries reflects the real row count', () => {
    const before = countDiscoveryCatalogEntries();
    upsertDiscoveryCatalogEntry(entry({ solithGameId: 'count-check-1' }));
    upsertDiscoveryCatalogEntry(entry({ solithGameId: 'count-check-2' }));
    const after = countDiscoveryCatalogEntries();
    assert.equal(after, before + 2);
  });
});
