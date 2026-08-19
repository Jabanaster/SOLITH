/**
 * Catalog search filter unit tests — isolated from shared project data/solith.db.
 * Uses resetForTesting() (:memory: sql.js) so Action+community LIMIT queries only see seeded rows.
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import {
  upsertCatalogEntry,
  searchCatalog,
  getCatalogEntry,
  getCatalogEntryForDisplay,
} from '../src/core/trainer-catalog/store.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';
import { buildSearchableText } from '../src/core/trainer-catalog/types.ts';

function entry(
  id: string,
  categories: string[],
  status: TrainerCatalogEntry['verificationStatus'],
): TrainerCatalogEntry {
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

function seedSearchFixture(): void {
  for (const row of [
    entry('elden-ring', ['RPG', 'Action'], 'metadata-only'),
    entry('street-fighter', ['Fighting', 'Action'], 'community'),
    entry('factorio-factory', ['Simulation', 'Strategy'], 'verified'),
  ]) {
    row.searchableText = buildSearchableText(row);
    upsertCatalogEntry(row);
  }
}

describe('trainer catalog search filters', () => {
  beforeAll(async () => {
    await resetForTesting(); // fresh :memory: schema — no shared disk pollution
    seedSearchFixture();
  });

  afterAll(async () => {
    await resetForTesting(); // tear down singleton so later suites start clean
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
    assert.equal(result.total, 1);
    assert.ok(result.entries.some((e) => e.catalogGameId === 'street-fighter'));
    assert.ok(result.entries.every((e) => e.verificationStatus === 'community'));
    assert.ok(
      result.entries.every((e) =>
        e.categories.some((c) => c.toLowerCase() === 'action'),
      ),
    );
  });
});

describe('trainer catalog search — placeholder title filtering', () => {
  beforeAll(async () => {
    await resetForTesting();
    const rows: TrainerCatalogEntry[] = [
      { ...entry('redacted', [], 'community'), displayName: '[REDACTED]' },
      { ...entry('redacted-mixed-case', [], 'community'), displayName: '[Redacted]' },
      { ...entry('hidden', [], 'community'), displayName: 'hidden' },
      { ...entry('empty-name', [], 'community'), displayName: '   ' },
      {
        ...entry('ninja-gaiden-legit', [], 'community'),
        displayName: '[NINJA GAIDEN - Master Collection] NINJA GAIDEN 3 - Razor’s Edge',
      },
      { ...entry('redacted-zone', [], 'community'), displayName: 'REDACTED Zone: A Real Game' },
    ];
    for (const row of rows) {
      row.searchableText = buildSearchableText(row);
      upsertCatalogEntry(row);
    }
  });

  afterAll(async () => {
    await resetForTesting();
  });

  test('hides exact placeholder titles regardless of brackets or case', () => {
    const result = searchCatalog('', 50, 0);
    const ids = result.entries.map((e) => e.catalogGameId);
    assert.ok(!ids.includes('redacted'));
    assert.ok(!ids.includes('redacted-mixed-case'));
    assert.ok(!ids.includes('hidden'));
  });

  test('hides rows with an empty/whitespace-only display name', () => {
    const result = searchCatalog('', 50, 0);
    assert.ok(!result.entries.some((e) => e.catalogGameId === 'empty-name'));
  });

  test('keeps legitimate bracketed titles that merely contain a placeholder word', () => {
    const result = searchCatalog('', 50, 0);
    const ids = result.entries.map((e) => e.catalogGameId);
    assert.ok(ids.includes('ninja-gaiden-legit'));
    assert.ok(ids.includes('redacted-zone'));
  });

  test('total count reflects the filtered set, not the raw row count', () => {
    const result = searchCatalog('', 50, 0);
    assert.equal(result.total, 2);
    assert.equal(result.entries.length, 2);
  });

  test('getCatalogEntry (raw/internal) still returns placeholder rows', () => {
    assert.equal(getCatalogEntry('redacted')?.displayName, '[REDACTED]');
    assert.equal(getCatalogEntry('hidden')?.displayName, 'hidden');
  });

  test('getCatalogEntryForDisplay hides placeholder rows via direct lookup', () => {
    assert.equal(getCatalogEntryForDisplay('redacted'), null);
    assert.equal(getCatalogEntryForDisplay('redacted-mixed-case'), null);
    assert.equal(getCatalogEntryForDisplay('hidden'), null);
    assert.equal(getCatalogEntryForDisplay('empty-name'), null);
  });

  test('getCatalogEntryForDisplay returns legitimate bracketed titles unchanged', () => {
    const entry = getCatalogEntryForDisplay('ninja-gaiden-legit');
    assert.ok(entry);
    assert.equal(
      entry?.displayName,
      '[NINJA GAIDEN - Master Collection] NINJA GAIDEN 3 - Razor’s Edge',
    );
    assert.ok(getCatalogEntryForDisplay('redacted-zone'));
  });

  test('getCatalogEntryForDisplay returns null for an unknown ID (same as getCatalogEntry)', () => {
    assert.equal(getCatalogEntryForDisplay('does-not-exist'), null);
    assert.equal(getCatalogEntry('does-not-exist'), null);
  });
});
