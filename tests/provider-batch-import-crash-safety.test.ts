/**
 * SOLITH Phase 3.1, Mission 19/20 — transaction/crash safety for the batched
 * import path. A failure at any point mid-batch must leave ZERO rows from
 * that batch applied (real SQL transaction ROLLBACK, not best-effort
 * cleanup), and the statement must always be freed even on failure.
 */
import { before as beforeAll, after as afterAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import { importProviderCatalogRecordsBatch, importDiscoveryCatalogEntriesBatch } from '../src/core/provider-catalog/batch-import.ts';
import { getProviderCatalogRecord, countProviderCatalogRecords } from '../src/core/provider-catalog/store.ts';
import { countDiscoveryCatalogEntries } from '../src/core/discovery-catalog/store.ts';
import type { ProviderGameRecord } from '../src/core/provider-catalog/types.ts';

function record(i: number, overrides: Partial<ProviderGameRecord> = {}): ProviderGameRecord {
  return { provider: 'steam', providerGameId: `crash-${i}`, title: `Game ${i}`, type: 'game', lastUpdated: new Date().toISOString(), ...overrides };
}

describe('provider batch import — crash safety (Mission 19/20)', () => {
  beforeAll(async () => {
    await resetForTesting();
  });
  afterAll(async () => {
    await resetForTesting();
  });

  test('a batch that completes fully applies every row', () => {
    const records = Array.from({ length: 20 }, (_, i) => record(i));
    importProviderCatalogRecordsBatch(records);
    assert.equal(countProviderCatalogRecords('steam'), 20);
  });

  test('simulated failure at 10% (early): a batch containing an invalid row rolls back completely, zero rows applied', () => {
    // A record with a non-string providerGameId of the wrong shape isn't
    // possible through the type system, so we simulate a genuine mid-batch
    // SQL-level failure by exceeding a column's NOT NULL constraint via a
    // raw record missing its required `title` — TypeScript would normally
    // prevent this; here we deliberately cast to prove the DB-level
    // transaction guarantee holds even if a caller's validation is bypassed.
    const before = countProviderCatalogRecords('steam');
    const records: ProviderGameRecord[] = [
      record(100),
      record(101),
      // 10% mark of a 20-row batch: force a failure by an invalid `type`
      // value is still a valid string for SQLite (no CHECK constraint), so
      // instead force a genuine SQL failure via a null title.
      { ...record(102), title: null as unknown as string },
      record(103),
    ];
    assert.throws(() => importProviderCatalogRecordsBatch(records));
    assert.equal(countProviderCatalogRecords('steam'), before, 'failure must roll back ALL rows in the batch, including the ones before the bad row');
    assert.equal(getProviderCatalogRecord('steam', 'crash-100'), null);
    assert.equal(getProviderCatalogRecord('steam', 'crash-101'), null);
  });

  test('simulated failure at 50% (middle): same all-or-nothing guarantee', () => {
    const before = countProviderCatalogRecords('steam');
    const records: ProviderGameRecord[] = [
      record(200),
      record(201),
      record(202),
      record(203),
      { ...record(204), title: null as unknown as string },
      record(205),
      record(206),
      record(207),
    ];
    assert.throws(() => importProviderCatalogRecordsBatch(records));
    assert.equal(countProviderCatalogRecords('steam'), before);
    for (let i = 200; i <= 203; i += 1) assert.equal(getProviderCatalogRecord('steam', `crash-${i}`), null);
  });

  test('simulated failure at 90% (late): same all-or-nothing guarantee', () => {
    const before = countProviderCatalogRecords('steam');
    const records: ProviderGameRecord[] = [
      ...Array.from({ length: 9 }, (_, i) => record(300 + i)),
      { ...record(309), title: null as unknown as string },
    ];
    assert.throws(() => importProviderCatalogRecordsBatch(records));
    assert.equal(countProviderCatalogRecords('steam'), before);
    for (let i = 300; i < 309; i += 1) assert.equal(getProviderCatalogRecord('steam', `crash-${i}`), null);
  });

  test('a failed batch does not leave the database in a state where the NEXT batch cannot proceed (recovery)', () => {
    const before = countProviderCatalogRecords('steam');
    const badBatch: ProviderGameRecord[] = [record(400), { ...record(401), title: null as unknown as string }];
    assert.throws(() => importProviderCatalogRecordsBatch(badBatch));
    assert.equal(countProviderCatalogRecords('steam'), before);

    // The retry succeeds cleanly — the failed transaction did not corrupt state.
    const goodBatch: ProviderGameRecord[] = [record(400), record(401)];
    importProviderCatalogRecordsBatch(goodBatch);
    assert.equal(countProviderCatalogRecords('steam'), before + 2);
    assert.ok(getProviderCatalogRecord('steam', 'crash-400'));
  });

  test('discovery_catalog_entries batch has the same all-or-nothing guarantee', () => {
    const before = countDiscoveryCatalogEntries();
    const entries = [
      { solithGameId: 'de-1', title: 'A', normalizedTitle: 'a', aliases: [], providerIds: {}, type: 'game', genres: [], tags: [], trainerAvailable: false, ctAvailable: false, updatedAt: new Date().toISOString() },
      { solithGameId: 'de-2', title: null as unknown as string, normalizedTitle: 'b', aliases: [], providerIds: {}, type: 'game', genres: [], tags: [], trainerAvailable: false, ctAvailable: false, updatedAt: new Date().toISOString() },
    ];
    assert.throws(() => importDiscoveryCatalogEntriesBatch(entries));
    assert.equal(countDiscoveryCatalogEntries(), before);
  });
});
