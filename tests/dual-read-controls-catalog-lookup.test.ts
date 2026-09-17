/**
 * Real DB coverage for findCatalogGameIdsByExecutable's actual
 * implementation (previously only ever exercised via a mocked dependency
 * override in tests/schema-v1-dual-read.test.ts). This is the same
 * exact-executable-membership lookup the catalog-process-watch D07 fix
 * uses (listCatalogExecutableIndex) — proves it is not a fixed-size text
 * search and does not depend on the executable name resembling the
 * catalog display name.
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import { upsertCatalogEntry } from '../src/core/trainer-catalog/store.ts';
import { buildSearchableText } from '../src/core/trainer-catalog/types.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';
import { findCatalogGameIdsByExecutable } from '../src/core/live-memory/dual-read-controls.ts';

function entry(id: string, displayName: string, executables: string[]): TrainerCatalogEntry {
  const row: TrainerCatalogEntry = {
    catalogGameId: id,
    displayName,
    categories: [],
    executables,
    verificationStatus: 'community',
    sources: [],
    hasModPack: false,
    cheatCount: 0,
    searchableText: '',
  };
  row.searchableText = buildSearchableText(row);
  return row;
}

describe('findCatalogGameIdsByExecutable (real implementation)', () => {
  beforeAll(async () => {
    await resetForTesting();
    // Executable name deliberately shares no substring with the display
    // name — a text/title search would find nothing; exact executable
    // membership must still find it.
    upsertCatalogEntry(entry('god-of-war', 'God of War', ['GOWA.exe']));
    upsertCatalogEntry(entry('assassins-creed-odyssey', "Assassin's Creed Odyssey", ['ACOdyssey.exe']));
  });

  afterAll(async () => {
    await resetForTesting();
  });

  test('finds a catalog game whose executable name has no textual resemblance to its display name', () => {
    assert.deepEqual(findCatalogGameIdsByExecutable('GOWA.exe'), ['god-of-war']);
  });

  test('is case-insensitive', () => {
    assert.deepEqual(findCatalogGameIdsByExecutable('gowa.exe'), ['god-of-war']);
  });

  test('returns an empty array for an unknown executable, not a throw', () => {
    assert.deepEqual(findCatalogGameIdsByExecutable('totally-unknown-game.exe'), []);
  });

  test('does not cross-match a different game', () => {
    assert.deepEqual(findCatalogGameIdsByExecutable('ACOdyssey.exe'), ['assassins-creed-odyssey']);
  });
});
