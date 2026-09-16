import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import { upsertCatalogEntry } from '../src/core/trainer-catalog/store.ts';
import { buildSearchableText } from '../src/core/trainer-catalog/types.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';
import { findCatalogEditionGroups } from '../src/core/trainer-catalog/find-edition-groups.ts';

function entry(id: string, displayName: string): TrainerCatalogEntry {
  const row: TrainerCatalogEntry = {
    catalogGameId: id,
    displayName,
    categories: [],
    executables: ['Game.exe'],
    verificationStatus: 'community',
    sources: [],
    hasModPack: false,
    cheatCount: 0,
    searchableText: '',
  };
  row.searchableText = buildSearchableText(row);
  return row;
}

describe('findCatalogEditionGroups (real catalog)', () => {
  beforeAll(async () => {
    await resetForTesting();
    upsertCatalogEntry(entry('cp2077', 'Cyberpunk 2077'));
    upsertCatalogEntry(entry('cp2077-ultimate', 'Cyberpunk 2077: Ultimate Edition'));
    upsertCatalogEntry(entry('unrelated-game', 'Stardew Valley'));
  });

  afterAll(async () => {
    await resetForTesting();
  });

  test('finds real edition groups from the live catalog table', () => {
    const groups = findCatalogEditionGroups();
    assert.equal(groups.length, 1);
    assert.deepEqual(
      groups[0].members.map((m) => m.catalogGameId).sort(),
      ['cp2077', 'cp2077-ultimate'],
    );
  });
});
