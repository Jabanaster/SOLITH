/**
 * ROADMAP §3.6 final-seven schema/persistence tests for the new curated columns
 * (singlePlayer, offlineCoop, localMultiplayer, onlineFeaturesPresent, isAllTimeClassic,
 * ownedConfirmed). Isolated from shared project data via resetForTesting() (:memory: sql.js).
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import { upsertCatalogEntry, getCatalogEntry, setCatalogEntryOwnedConfirmed } from '../src/core/trainer-catalog/store.ts';
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

describe('trainer_catalog_games schema — §3.6 final-seven curated columns', () => {
  beforeAll(async () => {
    await resetForTesting();
  });

  afterAll(async () => {
    await resetForTesting();
  });

  test('fresh insert with no curated evidence leaves all new fields unknown, not false', () => {
    upsertCatalogEntry(entry({ catalogGameId: 'no-evidence' }));
    const row = getCatalogEntry('no-evidence');
    assert.ok(row);
    assert.equal(row!.modeCapabilities, undefined);
    assert.equal(row!.isAllTimeClassic, undefined);
    assert.equal(row!.ownedConfirmed, undefined);
  });

  test('explicit modeCapabilities round-trip through insert', () => {
    upsertCatalogEntry(
      entry({
        catalogGameId: 'has-modes',
        modeCapabilities: { singlePlayer: true, offlineCoop: false, localMultiplayer: true, onlineFeaturesPresent: false },
      }),
    );
    const row = getCatalogEntry('has-modes');
    assert.deepEqual(row!.modeCapabilities, {
      singlePlayer: true,
      offlineCoop: false,
      localMultiplayer: true,
      onlineFeaturesPresent: false,
    });
  });

  test('explicit isAllTimeClassic round-trips through insert', () => {
    upsertCatalogEntry(entry({ catalogGameId: 'is-classic', isAllTimeClassic: true }));
    upsertCatalogEntry(entry({ catalogGameId: 'not-classic', isAllTimeClassic: false }));
    assert.equal(getCatalogEntry('is-classic')!.isAllTimeClassic, true);
    assert.equal(getCatalogEntry('not-classic')!.isAllTimeClassic, false);
  });

  test('a routine re-upsert that omits modeCapabilities/isAllTimeClassic does not wipe previously curated values', () => {
    upsertCatalogEntry(
      entry({ catalogGameId: 'curated-then-synced', modeCapabilities: { singlePlayer: true }, isAllTimeClassic: true }),
    );
    // Simulates a routine sync pass (e.g. remote-sync.ts) that never knows about
    // curated mode/classic evidence and upserts without those fields.
    upsertCatalogEntry(entry({ catalogGameId: 'curated-then-synced', displayName: 'Renamed by sync' }));
    const row = getCatalogEntry('curated-then-synced');
    assert.equal(row!.displayName, 'Renamed by sync');
    assert.deepEqual(row!.modeCapabilities, { singlePlayer: true });
    assert.equal(row!.isAllTimeClassic, true);
  });

  test('an explicit incoming modeCapabilities/isAllTimeClassic value does overwrite the previous curated value', () => {
    upsertCatalogEntry(entry({ catalogGameId: 'recurated', modeCapabilities: { singlePlayer: true }, isAllTimeClassic: true }));
    upsertCatalogEntry(entry({ catalogGameId: 'recurated', modeCapabilities: { singlePlayer: false }, isAllTimeClassic: false }));
    const row = getCatalogEntry('recurated');
    assert.deepEqual(row!.modeCapabilities, { singlePlayer: false });
    assert.equal(row!.isAllTimeClassic, false);
  });

  test('setCatalogEntryOwnedConfirmed sets ownership independent of upsertCatalogEntry', () => {
    upsertCatalogEntry(entry({ catalogGameId: 'owned-target' }));
    assert.equal(getCatalogEntry('owned-target')!.ownedConfirmed, undefined);
    setCatalogEntryOwnedConfirmed('owned-target', true);
    assert.equal(getCatalogEntry('owned-target')!.ownedConfirmed, true);
    setCatalogEntryOwnedConfirmed('owned-target', false);
    assert.equal(getCatalogEntry('owned-target')!.ownedConfirmed, false);
  });

  test('a routine upsertCatalogEntry never wipes a manually confirmed ownedConfirmed value', () => {
    upsertCatalogEntry(entry({ catalogGameId: 'owned-and-synced' }));
    setCatalogEntryOwnedConfirmed('owned-and-synced', true);
    upsertCatalogEntry(entry({ catalogGameId: 'owned-and-synced', displayName: 'Synced later', cheatCount: 5 }));
    const row = getCatalogEntry('owned-and-synced');
    assert.equal(row!.displayName, 'Synced later');
    assert.equal(row!.ownedConfirmed, true, 'ownedConfirmed must survive an unrelated catalog sync upsert');
  });
});
