/**
 * Discovery Catalog — query model tests (Mission 16, Phase 1
 * online-foundation). Isolated via resetForTesting() (:memory: sql.js).
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import { upsertDiscoveryCatalogEntry } from '../src/core/discovery-catalog/store.ts';
import { queryDiscoveryCatalog } from '../src/core/discovery-catalog/query.ts';
import { addFavorite } from '../src/core/favorites/store.ts';
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

describe('discovery catalog query model', () => {
  beforeAll(async () => {
    await resetForTesting();

    upsertDiscoveryCatalogEntry(
      entry({
        solithGameId: 'stardew-valley',
        title: 'Stardew Valley',
        normalizedTitle: 'stardew valley',
        providerIds: { steam: '413150' },
        genres: ['Simulation'],
        releaseYear: 2016,
        trainerAvailable: true,
      }),
    );
    upsertDiscoveryCatalogEntry(
      entry({
        solithGameId: 'stardew-clone',
        title: 'Stardew-like Farm Sim',
        normalizedTitle: 'stardew-like farm sim',
        providerIds: { gog: '999' },
        genres: ['Simulation'],
        releaseYear: 2020,
        trainerAvailable: false,
      }),
    );
    upsertDiscoveryCatalogEntry(
      entry({
        solithGameId: 'unrelated-shooter',
        title: 'Unrelated Shooter',
        normalizedTitle: 'unrelated shooter',
        providerIds: { steam: '111' },
        genres: ['Shooter'],
        releaseYear: 2016,
        trainerAvailable: true,
      }),
    );

    addFavorite('stardew-valley');
  });

  afterAll(async () => {
    await resetForTesting();
  });

  test('text search matches title/normalizedTitle case-insensitively', () => {
    const results = queryDiscoveryCatalog({ text: 'stardew' });
    const ids = results.map((r) => r.solithGameId).sort();
    assert.deepEqual(ids, ['stardew-clone', 'stardew-valley']);
  });

  test('text search on a substring not present returns no rows', () => {
    const results = queryDiscoveryCatalog({ text: 'nonexistent-title-xyz' });
    assert.equal(results.length, 0);
  });

  test('provider filter matches only entries with that provider id key', () => {
    const results = queryDiscoveryCatalog({ provider: 'steam' });
    const ids = results.map((r) => r.solithGameId).sort();
    assert.deepEqual(ids, ['stardew-valley', 'unrelated-shooter']);
  });

  test('trainerAvailable filter matches boolean flag', () => {
    const withTrainer = queryDiscoveryCatalog({ trainerAvailable: true });
    assert.ok(withTrainer.every((r) => r.trainerAvailable === true));
    assert.ok(withTrainer.some((r) => r.solithGameId === 'stardew-valley'));

    const withoutTrainer = queryDiscoveryCatalog({ trainerAvailable: false });
    assert.ok(withoutTrainer.every((r) => r.trainerAvailable === false));
    assert.ok(withoutTrainer.some((r) => r.solithGameId === 'stardew-clone'));
  });

  test('genre filter matches entries whose genresJson contains that genre', () => {
    const results = queryDiscoveryCatalog({ genre: 'Simulation' });
    const ids = results.map((r) => r.solithGameId).sort();
    assert.deepEqual(ids, ['stardew-clone', 'stardew-valley']);
  });

  test('releaseYear filter matches exact year', () => {
    const results = queryDiscoveryCatalog({ releaseYear: 2016 });
    const ids = results.map((r) => r.solithGameId).sort();
    assert.deepEqual(ids, ['stardew-valley', 'unrelated-shooter']);
  });

  test('releaseYearMin/releaseYearMax filter an inclusive range (Discovery Master Pass, Stage 2)', () => {
    const onlyNewest = queryDiscoveryCatalog({ releaseYearMin: 2018 });
    assert.deepEqual(onlyNewest.map((r) => r.solithGameId), ['stardew-clone']);

    const onlyOldest = queryDiscoveryCatalog({ releaseYearMax: 2016 });
    assert.deepEqual(
      onlyOldest.map((r) => r.solithGameId).sort(),
      ['stardew-valley', 'unrelated-shooter'],
    );

    const exactRange = queryDiscoveryCatalog({ releaseYearMin: 2017, releaseYearMax: 2020 });
    assert.deepEqual(exactRange.map((r) => r.solithGameId), ['stardew-clone']);

    const emptyRange = queryDiscoveryCatalog({ releaseYearMin: 2021, releaseYearMax: 2025 });
    assert.equal(emptyRange.length, 0);
  });

  test('favoriteOrPersonalOnly is a two-step filter against favorites.canonical_game_id (see query.ts module doc)', () => {
    const results = queryDiscoveryCatalog({ favoriteOrPersonalOnly: true });
    const ids = results.map((r) => r.solithGameId);
    assert.deepEqual(ids, ['stardew-valley']);
  });

  test('favoriteOrPersonalOnly returns empty when nothing is favorited', () => {
    // Different in-memory DB state is not reset here deliberately — instead
    // assert the general behavior holds at query time when the favorites
    // set (fetched fresh) does not include a given id.
    const results = queryDiscoveryCatalog({ favoriteOrPersonalOnly: true, text: 'unrelated' });
    assert.equal(results.length, 0);
  });

  test('combined filters are ANDed together', () => {
    const results = queryDiscoveryCatalog({ genre: 'Simulation', trainerAvailable: true });
    assert.deepEqual(results.map((r) => r.solithGameId), ['stardew-valley']);
  });

  test('limit and offset paginate results deterministically', () => {
    const page1 = queryDiscoveryCatalog({ limit: 1, offset: 0 });
    const page2 = queryDiscoveryCatalog({ limit: 1, offset: 1 });
    assert.equal(page1.length, 1);
    assert.equal(page2.length, 1);
    assert.notEqual(page1[0].solithGameId, page2[0].solithGameId);
  });
});

describe('discovery catalog query — synthetic 10k-row scale', () => {
  const ROW_COUNT = 10_000;

  beforeAll(async () => {
    await resetForTesting();
    for (let i = 0; i < ROW_COUNT; i += 1) {
      upsertDiscoveryCatalogEntry(
        entry({
          solithGameId: `synthetic-${i}`,
          title: `Synthetic Game ${i}`,
          normalizedTitle: `synthetic game ${i}`,
          genres: i % 7 === 0 ? ['Simulation'] : ['Action'],
          releaseYear: 2000 + (i % 25),
          trainerAvailable: i % 3 === 0,
        }),
      );
    }
  });

  afterAll(async () => {
    await resetForTesting();
  });

  test(`stays correct and reports real wall-clock timing at ${ROW_COUNT} rows`, () => {
    const start = Date.now();
    const results = queryDiscoveryCatalog({ trainerAvailable: true, releaseYear: 2010, limit: 100 });
    const elapsedMs = Date.now() - start;

    // Correctness: every synthetic id divisible by 3 (trainerAvailable) whose
    // (2000 + i % 25) === 2010 i.e. i % 25 === 10, intersected with i % 3 === 0.
    assert.ok(results.length > 0, 'expected at least one matching synthetic row');
    assert.ok(results.every((r) => r.trainerAvailable === true && r.releaseYear === 2010));

    // Not a strict perf assertion (machine-dependent) — reported for the
    // record per Mission 22's storage/timing measurement request.
    console.log(`[discovery-catalog-query] queryDiscoveryCatalog at ${ROW_COUNT} rows took ${elapsedMs}ms, returned ${results.length} rows`);
    assert.ok(elapsedMs < 5000, `query took ${elapsedMs}ms at ${ROW_COUNT} rows — investigate if this regresses`);
  });
});
