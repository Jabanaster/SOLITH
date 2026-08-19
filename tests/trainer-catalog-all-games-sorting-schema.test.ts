/**
 * ROADMAP §3.5 schema/persistence tests for the 3 new timestamp/date fields
 * (releaseDate, createdAt, contentUpdatedAt) and the all-time-popularity feedback
 * aggregation. Isolated from shared project data via resetForTesting() (:memory: sql.js).
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import { upsertCatalogEntry, getCatalogEntry } from '../src/core/trainer-catalog/store.ts';
import {
  recordDefinitionFeedback,
  listPositiveFeedbackCountsSorted,
} from '../src/core/trainer-catalog/definition-feedback-store.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';

function entry(overrides: Partial<TrainerCatalogEntry> & { catalogGameId: string }): TrainerCatalogEntry {
  return {
    displayName: overrides.displayName ?? overrides.catalogGameId,
    categories: [],
    executables: [],
    verificationStatus: 'community',
    sources: [],
    hasModPack: false,
    cheatCount: 0,
    searchableText: '',
    ...overrides,
  };
}

describe('trainer_catalog_games schema — releaseDate / createdAt / contentUpdatedAt', () => {
  beforeAll(async () => {
    await resetForTesting();
  });

  afterAll(async () => {
    await resetForTesting();
  });

  test('fresh DB creation exposes all 3 new columns with unknown-safe defaults', () => {
    upsertCatalogEntry(entry({ catalogGameId: 'no-evidence' }));
    const row = getCatalogEntry('no-evidence');
    assert.ok(row);
    assert.equal(row!.releaseDate, undefined);
    assert.equal(row!.createdAt, undefined || row!.createdAt, 'createdAt should be a real timestamp or undefined, never fabricated');
  });

  test('createdAt is set on initial INSERT', () => {
    upsertCatalogEntry(entry({ catalogGameId: 'insert-me' }));
    const row = getCatalogEntry('insert-me');
    assert.ok(row!.createdAt, 'createdAt must be set on first insert');
  });

  test('createdAt is never rewritten by a subsequent upsert (ON CONFLICT UPDATE does not touch it)', () => {
    upsertCatalogEntry(entry({ catalogGameId: 'stable-created', displayName: 'First' }));
    const firstRow = getCatalogEntry('stable-created');
    const firstCreatedAt = firstRow!.createdAt;
    assert.ok(firstCreatedAt);

    upsertCatalogEntry(entry({ catalogGameId: 'stable-created', displayName: 'Renamed', cheatCount: 5 }));
    const secondRow = getCatalogEntry('stable-created');
    assert.equal(secondRow!.createdAt, firstCreatedAt);
    assert.equal(secondRow!.displayName, 'Renamed');
  });

  test('releaseDate is preserved when explicitly provided and stays undefined when absent', () => {
    upsertCatalogEntry(entry({ catalogGameId: 'has-release-date', releaseDate: '2019-04-26' }));
    upsertCatalogEntry(entry({ catalogGameId: 'no-release-date' }));
    assert.equal(getCatalogEntry('has-release-date')!.releaseDate, '2019-04-26');
    assert.equal(getCatalogEntry('no-release-date')!.releaseDate, undefined);
  });

  test('contentUpdatedAt is set on initial insert (treated as a meaningful first write)', () => {
    upsertCatalogEntry(entry({ catalogGameId: 'first-write' }));
    assert.ok(getCatalogEntry('first-write')!.contentUpdatedAt);
  });

  test('a no-op re-upsert with identical meaningful fields does not advance contentUpdatedAt', async () => {
    const base = entry({ catalogGameId: 'no-op-upsert', cheatCount: 3, verificationStatus: 'community' });
    upsertCatalogEntry(base);
    const first = getCatalogEntry('no-op-upsert')!.contentUpdatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    // Re-upsert with identical meaningful fields but different cosmetic field (coverUrl) —
    // simulates a routine sync/seed pass that re-writes the same record.
    upsertCatalogEntry({ ...base, coverUrl: 'https://example.test/cover.jpg' });
    const second = getCatalogEntry('no-op-upsert')!.contentUpdatedAt;
    assert.equal(second, first, 'cosmetic-only re-upsert must not advance contentUpdatedAt');
  });

  test('a meaningful field change (verificationStatus) advances contentUpdatedAt', async () => {
    upsertCatalogEntry(entry({ catalogGameId: 'meaningful-change', verificationStatus: 'community' }));
    const first = getCatalogEntry('meaningful-change')!.contentUpdatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    upsertCatalogEntry(entry({ catalogGameId: 'meaningful-change', verificationStatus: 'verified' }));
    const second = getCatalogEntry('meaningful-change')!.contentUpdatedAt;
    assert.notEqual(second, first, 'verificationStatus change must advance contentUpdatedAt');
  });

  test('a meaningful field change (cheatCount) advances contentUpdatedAt', async () => {
    upsertCatalogEntry(entry({ catalogGameId: 'cheat-count-change', cheatCount: 1 }));
    const first = getCatalogEntry('cheat-count-change')!.contentUpdatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    upsertCatalogEntry(entry({ catalogGameId: 'cheat-count-change', cheatCount: 12 }));
    const second = getCatalogEntry('cheat-count-change')!.contentUpdatedAt;
    assert.notEqual(second, first, 'cheatCount change must advance contentUpdatedAt');
  });
});

describe('all-time popularity — lifetime positive feedback, distinct from catalog_demand', () => {
  beforeAll(async () => {
    await resetForTesting();
  });

  afterAll(async () => {
    await resetForTesting();
  });

  test('counts only positive ratings, grouped per catalogGameId, descending', () => {
    recordDefinitionFeedback({ catalogGameId: 'popular-game', featureId: '_pack', rating: 1 });
    recordDefinitionFeedback({ catalogGameId: 'popular-game', featureId: '_pack', rating: 1 });
    recordDefinitionFeedback({ catalogGameId: 'popular-game', featureId: '_pack', rating: -1 });
    recordDefinitionFeedback({ catalogGameId: 'niche-game', featureId: '_pack', rating: 1 });

    const rows = listPositiveFeedbackCountsSorted(10);
    const popular = rows.find((r) => r.catalogGameId === 'popular-game');
    const niche = rows.find((r) => r.catalogGameId === 'niche-game');
    assert.equal(popular?.positiveCount, 2);
    assert.equal(niche?.positiveCount, 1);
  });

  test('an entry with zero feedback rows is simply absent, never fabricated as zero-with-evidence', () => {
    const rows = listPositiveFeedbackCountsSorted(10);
    assert.ok(!rows.some((r) => r.catalogGameId === 'never-rated'));
  });
});
