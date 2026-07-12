import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase } from '../src/core/database/index.ts';
import { upsertCatalogEntry } from '../src/core/trainer-catalog/store.ts';
import { searchCatalog } from '../src/core/trainer-catalog/store.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';
import { buildSearchableText } from '../src/core/trainer-catalog/types.ts';

function entry(id: string, categories: string[], status: TrainerCatalogEntry['verificationStatus']): TrainerCatalogEntry {
  return {
    catalogGameId: id,
    displayName: id.replace(/-/g, ' '),
    categories,
    executables: ['Game.exe'],
    verificationStatus: status,
    sources: [],
    hasModPack: false,
    cheatCount: 0,
    searchableText: '',
  };
}

describe('trainer catalog search filters', () => {
  before(async () => {
    await initDatabase();
    for (const row of [
      entry('elden-ring', ['RPG', 'Action'], 'metadata-only'),
      entry('street-fighter', ['Fighting', 'Action'], 'community'),
      entry('factorio-factory', ['Simulation', 'Strategy'], 'verified'),
    ]) {
      row.searchableText = buildSearchableText(row);
      upsertCatalogEntry(row);
    }
  });

  test('filters by single genre', () => {
    const result = searchCatalog('', 50, 0, { categories: ['Fighting'] });
    assert.ok(result.entries.some((e) => e.catalogGameId === 'street-fighter'));
    assert.ok(!result.entries.some((e) => e.catalogGameId === 'factorio-factory'));
  });

  test('filters by multiple genres (OR)', () => {
    const result = searchCatalog('', 50, 0, { categories: ['RPG', 'Simulation'] });
    const ids = result.entries.map((e) => e.catalogGameId);
    assert.ok(ids.includes('elden-ring'));
    assert.ok(ids.includes('factorio-factory'));
  });

  test('combines genre and verification filters', () => {
    const result = searchCatalog('', 50, 0, {
      categories: ['Action'],
      verificationStatus: 'community',
    });
    assert.ok(result.entries.some((e) => e.catalogGameId === 'street-fighter'));
    assert.ok(result.entries.every((e) => e.verificationStatus === 'community'));
    assert.ok(
      result.entries.every((e) =>
        e.categories.some((c) => c.toLowerCase() === 'action'),
      ),
    );
  });
});
