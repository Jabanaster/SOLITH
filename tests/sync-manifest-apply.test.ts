/**
 * ROADMAP §online-foundation Mission 10 — applySyncManifestDelta tests.
 * Isolated via resetForTesting() (:memory: sql.js).
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import { applySyncManifestDelta, fetchSyncManifest, type SyncManifestFetchImpl } from '../src/core/sync-manifest/client.ts';
import { getSyncManifestState } from '../src/core/sync-manifest/store.ts';
import { getDiscoveryCatalogEntry, countDiscoveryCatalogEntries } from '../src/core/discovery-catalog/store.ts';
import type { DiscoveryCatalogEntry } from '../src/core/discovery-catalog/types.ts';

function entry(id: string, trainerAvailable: boolean): DiscoveryCatalogEntry {
  return {
    solithGameId: id,
    title: `Title ${id}`,
    normalizedTitle: `title ${id}`,
    aliases: [],
    providerIds: {},
    type: 'game',
    genres: [],
    tags: [],
    trainerAvailable,
    ctAvailable: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('applySyncManifestDelta', () => {
  beforeAll(async () => {
    await resetForTesting();
  });

  afterAll(async () => {
    await resetForTesting();
  });

  test('initial sync (no prior state) pulls everything into local storage', () => {
    assert.equal(getSyncManifestState('discovery-catalog'), null, 'precondition: no prior state');

    const result = applySyncManifestDelta('discovery-catalog', {
      catalogRevision: '1',
      trainerRevision: '1',
      changedCatalogEntries: [entry('game-a', false), entry('game-b', false)],
      changedTrainerCoverage: [],
      deletedSolithGameIds: [],
    });

    assert.equal(result.upsertedCatalogEntries, 2);
    assert.equal(countDiscoveryCatalogEntries(), 2);
    assert.ok(getDiscoveryCatalogEntry('game-a'));
    assert.ok(getDiscoveryCatalogEntry('game-b'));

    const state = getSyncManifestState('discovery-catalog');
    assert.ok(state);
    assert.equal(state!.catalogRevision, '1');
  });

  test('a no-change sync (empty delta) is a real no-op but still advances the recorded revision', () => {
    const before = countDiscoveryCatalogEntries();

    const result = applySyncManifestDelta('discovery-catalog', {
      catalogRevision: '2',
      trainerRevision: '2',
      changedCatalogEntries: [],
      changedTrainerCoverage: [],
      deletedSolithGameIds: [],
    });

    assert.equal(result.upsertedCatalogEntries, 0);
    assert.equal(countDiscoveryCatalogEntries(), before, 'no rows should change');
    assert.equal(getSyncManifestState('discovery-catalog')?.catalogRevision, '2');
  });

  test('a delta sync only touches the changed rows, leaving unrelated rows untouched', () => {
    const beforeA = getDiscoveryCatalogEntry('game-a')!;
    assert.equal(beforeA.trainerAvailable, false);

    applySyncManifestDelta('discovery-catalog', {
      catalogRevision: '3',
      trainerRevision: '3',
      changedCatalogEntries: [entry('game-a', true)],
      changedTrainerCoverage: [],
      deletedSolithGameIds: [],
    });

    assert.equal(getDiscoveryCatalogEntry('game-a')!.trainerAvailable, true, 'changed row must reflect the update');
    assert.equal(getDiscoveryCatalogEntry('game-b')!.trainerAvailable, false, 'unrelated row must be untouched');
    assert.equal(countDiscoveryCatalogEntries(), 2, 'no new rows should be created for an unrelated delta');
  });

  test('applySyncManifestDelta itself never throws for a well-formed delta with zero entries and does not corrupt existing state', () => {
    const beforeCount = countDiscoveryCatalogEntries();
    const beforeState = getSyncManifestState('discovery-catalog');

    assert.doesNotThrow(() => {
      applySyncManifestDelta('discovery-catalog', {
        catalogRevision: beforeState!.catalogRevision!,
        trainerRevision: beforeState!.trainerRevision!,
        changedCatalogEntries: [],
        changedTrainerCoverage: [],
        deletedSolithGameIds: [],
      });
    });

    assert.equal(countDiscoveryCatalogEntries(), beforeCount);
  });

  test('an offline/fetch-failure sync returns an error without ever touching local state', async () => {
    const beforeCount = countDiscoveryCatalogEntries();
    const beforeState = getSyncManifestState('discovery-catalog');
    const beforeGameA = getDiscoveryCatalogEntry('game-a');

    const offlineFetchImpl: SyncManifestFetchImpl = async () => {
      throw new Error('simulated offline');
    };

    const result = await fetchSyncManifest({
      service: 'discovery-catalog',
      endpointUrl: 'https://mock.invalid/sync',
      fetchImpl: offlineFetchImpl,
    });

    assert.ok('error' in result, 'a fetch failure must be a typed error result, not a throw');
    // The whole point: a caller who receives `{ error }` never calls
    // applySyncManifestDelta at all, so local state must be byte-for-byte
    // unchanged from before the attempted sync.
    assert.equal(countDiscoveryCatalogEntries(), beforeCount);
    assert.deepEqual(getSyncManifestState('discovery-catalog'), beforeState);
    assert.deepEqual(getDiscoveryCatalogEntry('game-a'), beforeGameA);
  });
});
