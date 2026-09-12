import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYear, toGameCardData } from '../src/app/pages/discovery-page-helpers.ts';
import type { DiscoveryCatalogEntry } from '../src/core/discovery-catalog/types.ts';

describe('parseYear', () => {
  test('parses a valid year string', () => {
    assert.equal(parseYear('2016'), 2016);
  });

  test('returns undefined for an empty string (no filter applied)', () => {
    assert.equal(parseYear(''), undefined);
    assert.equal(parseYear('   '), undefined);
  });

  test('rejects non-integer input', () => {
    assert.equal(parseYear('2016.5'), undefined);
    assert.equal(parseYear('not-a-year'), undefined);
  });

  test('rejects out-of-range years — never lets a malformed value reach the query', () => {
    assert.equal(parseYear('1800'), undefined);
    assert.equal(parseYear('3000'), undefined);
  });
});

describe('toGameCardData (Discovery entry -> GameCardData)', () => {
  const entry: DiscoveryCatalogEntry = {
    solithGameId: 'stardew-valley',
    title: 'Stardew Valley',
    normalizedTitle: 'stardew valley',
    aliases: [],
    providerIds: { steam: '413150' },
    type: 'game',
    genres: [],
    tags: [],
    trainerAvailable: true,
    ctAvailable: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  test('never sets artworkUrl — Discovery-only games never trigger bulk artwork downloads', () => {
    const card = toGameCardData(entry, false);
    assert.equal('artworkUrl' in card, false);
  });

  test('caps trainerAvailability at COMMUNITY when the entry reports a trainer', () => {
    const card = toGameCardData(entry, false);
    assert.equal(card.trainerAvailability, 'COMMUNITY');
    assert.equal(card.trainerAccuracy, 'VERSION_UNKNOWN');
  });

  test('reports NONE when the entry has no trainer', () => {
    const card = toGameCardData({ ...entry, trainerAvailable: false }, false);
    assert.equal(card.trainerAvailability, 'NONE');
    assert.equal(card.trainerAccuracy, 'NONE');
  });

  test('reflects the favorite flag passed in', () => {
    assert.equal(toGameCardData(entry, true).favorite, true);
    assert.equal(toGameCardData(entry, false).favorite, false);
  });

  test('installed/owned are always honest floors — Discovery never claims personal-library evidence', () => {
    const card = toGameCardData(entry, true);
    assert.equal(card.installed, false);
    assert.equal(card.owned, 'unknown');
    assert.deepEqual(card.launchers, []);
  });
});
