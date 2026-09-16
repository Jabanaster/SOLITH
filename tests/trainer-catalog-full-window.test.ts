/**
 * Regression coverage for D07 (Phase 3): identity-matching callers
 * (install-discovery, live-process detection) used to query a fixed-size
 * page of the catalog (200/500/5000 rows) instead of the whole table, so a
 * title whose row sorted past that window could never be identity-matched no
 * matter how long it was installed or running. getFullCatalogForMatching()
 * and listCatalogExecutableIndex() carry no LIMIT/OFFSET at all — this proves
 * a title placed well past the smallest old window (200) is still returned.
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import {
  upsertCatalogEntry,
  getFullCatalogForMatching,
  listCatalogExecutableIndex,
} from '../src/core/trainer-catalog/store.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';
import { buildSearchableText } from '../src/core/trainer-catalog/types.ts';

const FILLER_COUNT = 220; // past the smallest old hardcoded window (200)

function fillerEntry(index: number): TrainerCatalogEntry {
  // Named to sort alphabetically ahead of "Stardew Valley" / "Zzz Target Game".
  const row: TrainerCatalogEntry = {
    catalogGameId: `aaa-filler-${String(index).padStart(4, '0')}`,
    displayName: `Aaa Filler ${index}`,
    categories: [],
    executables: [`filler-${index}.exe`],
    verificationStatus: 'community',
    sources: [],
    hasModPack: false,
    cheatCount: 0,
    searchableText: '',
  };
  row.searchableText = buildSearchableText(row);
  return row;
}

function targetEntry(id: string, displayName: string, executable: string): TrainerCatalogEntry {
  const row: TrainerCatalogEntry = {
    catalogGameId: id,
    displayName,
    categories: ['Simulation'],
    executables: [executable],
    verificationStatus: 'community',
    sources: [],
    hasModPack: false,
    cheatCount: 0,
    searchableText: '',
  };
  row.searchableText = buildSearchableText(row);
  return row;
}

describe('unbounded catalog identity-matching accessors (D07)', () => {
  beforeAll(async () => {
    await resetForTesting();
    for (let i = 0; i < FILLER_COUNT; i += 1) {
      upsertCatalogEntry(fillerEntry(i));
    }
    // Sorts alphabetically after every "Aaa Filler N" row and after "community"
    // tier ordering — i.e. deliberately placed past the old 200-row window.
    upsertCatalogEntry(targetEntry('zzz-target-game', 'Zzz Target Game', 'ZzzTarget.exe'));
  });

  afterAll(async () => {
    await resetForTesting();
  });

  test('getFullCatalogForMatching returns every row, including one past the old 200-row window', () => {
    const all = getFullCatalogForMatching();
    assert.equal(all.length, FILLER_COUNT + 1);
    assert.ok(all.some((e) => e.catalogGameId === 'zzz-target-game'));
  });

  test('listCatalogExecutableIndex returns every row, including one past the old 200-row window', () => {
    const index = listCatalogExecutableIndex();
    assert.equal(index.length, FILLER_COUNT + 1);
    const target = index.find((e) => e.catalogGameId === 'zzz-target-game');
    assert.ok(target);
    assert.deepEqual(target?.executables, ['ZzzTarget.exe']);
  });
});
