import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase } from '../src/core/database/index.ts';
import {
  upsertProviderCatalogRecord,
  getProviderCatalogRecord,
  listProviderCatalogRecordsByProvider,
} from '../src/core/provider-catalog/store.ts';
import type { ProviderGameRecord } from '../src/core/provider-catalog/types.ts';

function makeRecord(overrides: Partial<ProviderGameRecord> = {}): ProviderGameRecord {
  return {
    provider: 'steam',
    providerGameId: '1091500',
    title: 'Cyberpunk 2077',
    type: 'game',
    lastUpdated: new Date(0).toISOString(),
    ...overrides,
  };
}

describe('provider catalog store', () => {
  before(async () => {
    await initDatabase();
  });

  test('upsert then get round-trips required fields', () => {
    upsertProviderCatalogRecord(makeRecord());
    const record = getProviderCatalogRecord('steam', '1091500');
    assert.ok(record);
    assert.equal(record!.title, 'Cyberpunk 2077');
    assert.equal(record!.type, 'game');
    assert.equal(record!.provider, 'steam');
  });

  test('optional fields are never fabricated — absent when not supplied', () => {
    upsertProviderCatalogRecord(makeRecord({ providerGameId: 'no-optional-fields' }));
    const record = getProviderCatalogRecord('steam', 'no-optional-fields');
    assert.ok(record);
    assert.equal('storeUrl' in record!, false);
    assert.equal('rating' in record!, false);
    assert.equal('genres' in record!, false);
    assert.equal('popularityRank' in record!, false);
  });

  test('optional fields round-trip (including array fields) when supplied', () => {
    upsertProviderCatalogRecord(
      makeRecord({
        providerGameId: 'with-optional-fields',
        storeUrl: 'https://store.steampowered.com/app/1091500',
        developer: 'CD Projekt Red',
        genres: ['RPG', 'Action'],
        tags: ['Open World'],
        rating: 4.5,
        ratingSource: 'metacritic',
        popularityRank: 12,
        popularitySource: 'steamspy',
      }),
    );
    const record = getProviderCatalogRecord('steam', 'with-optional-fields');
    assert.ok(record);
    assert.equal(record!.storeUrl, 'https://store.steampowered.com/app/1091500');
    assert.deepEqual(record!.genres, ['RPG', 'Action']);
    assert.deepEqual(record!.tags, ['Open World']);
    assert.equal(record!.rating, 4.5);
    assert.equal(record!.popularityRank, 12);
  });

  test('upsert dedups by (provider, providerGameId) — same key updates in place, never duplicates', () => {
    upsertProviderCatalogRecord(makeRecord({ providerGameId: 'dedup-key', title: 'Original Title' }));
    upsertProviderCatalogRecord(makeRecord({ providerGameId: 'dedup-key', title: 'Updated Title' }));
    const record = getProviderCatalogRecord('steam', 'dedup-key');
    assert.equal(record!.title, 'Updated Title');
    const all = listProviderCatalogRecordsByProvider('steam').filter((r) => r.providerGameId === 'dedup-key');
    assert.equal(all.length, 1);
  });

  test('same providerGameId under a different provider is a distinct record, not a dedup collision', () => {
    upsertProviderCatalogRecord(makeRecord({ provider: 'steam', providerGameId: 'shared-id', title: 'Steam Title' }));
    upsertProviderCatalogRecord(makeRecord({ provider: 'gog', providerGameId: 'shared-id', title: 'GOG Title' }));
    const steamRecord = getProviderCatalogRecord('steam', 'shared-id');
    const gogRecord = getProviderCatalogRecord('gog', 'shared-id');
    assert.equal(steamRecord!.title, 'Steam Title');
    assert.equal(gogRecord!.title, 'GOG Title');
  });

  test('getProviderCatalogRecord returns null for an unknown key', () => {
    const record = getProviderCatalogRecord('epic', 'does-not-exist');
    assert.equal(record, null);
  });

  test('listProviderCatalogRecordsByProvider only returns rows for that provider', () => {
    upsertProviderCatalogRecord(makeRecord({ provider: 'epic', providerGameId: 'epic-only', title: 'Epic Exclusive' }));
    const epicRecords = listProviderCatalogRecordsByProvider('epic');
    assert.ok(epicRecords.every((r) => r.provider === 'epic'));
    assert.ok(epicRecords.some((r) => r.providerGameId === 'epic-only'));
  });
});
