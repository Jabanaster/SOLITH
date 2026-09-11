/**
 * Discovery Catalog — trainer status derivation tests (Mission 17, Phase 1
 * online-foundation). Pure function, no database involved.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDiscoveryTrainerStatus } from '../src/core/discovery-catalog/trainer-status.ts';
import type { DiscoveryCatalogEntry } from '../src/core/discovery-catalog/types.ts';

function entry(overrides: Partial<DiscoveryCatalogEntry> & { trainerAvailable: boolean }): DiscoveryCatalogEntry {
  return {
    solithGameId: 'game-1',
    title: 'Game One',
    normalizedTitle: 'game one',
    aliases: [],
    providerIds: {},
    type: 'game',
    genres: [],
    tags: [],
    ctAvailable: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('deriveDiscoveryTrainerStatus', () => {
  test('returns TRAINER_AVAILABLE when a first-party trainer exists and no update is needed', () => {
    const status = deriveDiscoveryTrainerStatus(entry({ trainerAvailable: true }), false, false);
    assert.equal(status, 'TRAINER_AVAILABLE');
  });

  test('returns COMMUNITY_TRAINER when only a community trainer exists', () => {
    const status = deriveDiscoveryTrainerStatus(entry({ trainerAvailable: false }), true, false);
    assert.equal(status, 'COMMUNITY_TRAINER');
  });

  test('returns NEEDS_UPDATE when a first-party trainer exists but needs an update', () => {
    const status = deriveDiscoveryTrainerStatus(entry({ trainerAvailable: true }), false, true);
    assert.equal(status, 'NEEDS_UPDATE');
  });

  test('returns NEEDS_UPDATE when a community trainer exists but needs an update', () => {
    const status = deriveDiscoveryTrainerStatus(entry({ trainerAvailable: false }), true, true);
    assert.equal(status, 'NEEDS_UPDATE');
  });

  test('returns NO_TRAINER when neither trainer signal is present', () => {
    const status = deriveDiscoveryTrainerStatus(entry({ trainerAvailable: false }), false, false);
    assert.equal(status, 'NO_TRAINER');
  });

  test('needsUpdate with no trainer at all is still NO_TRAINER (nothing to update)', () => {
    const status = deriveDiscoveryTrainerStatus(entry({ trainerAvailable: false }), false, true);
    assert.equal(status, 'NO_TRAINER');
  });

  test('first-party trainer takes precedence over a community trainer when both present', () => {
    const status = deriveDiscoveryTrainerStatus(entry({ trainerAvailable: true }), true, false);
    assert.equal(status, 'TRAINER_AVAILABLE');
  });
});
