import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, resetForTesting } from '../src/core/database/index.ts';
import { recordCatalogDemand, listCatalogDemandSorted } from '../src/core/catalog-demand/store.ts';

describe('catalog-demand', () => {
  before(async () => {
    await resetForTesting();
    await initDatabase();
  });

  test('increments notify count', () => {
    const row = recordCatalogDemand('palworld', 'notify');
    assert.equal(row.notifyCount, 1);
    const again = recordCatalogDemand('palworld', 'notify');
    assert.equal(again.notifyCount, 2);
  });

  test('lists sorted by demand', () => {
    recordCatalogDemand('stardew-valley', 'notify');
    recordCatalogDemand('stardew-valley', 'verification_request');
    const list = listCatalogDemandSorted(10);
    const stardew = list.find((r) => r.catalogGameId === 'stardew-valley');
    assert.ok(stardew);
    assert.ok(stardew!.notifyCount >= 1);
  });
});
