/**
 * Discovery Master Pass, Stage 2 — GameDetailPage identity/resolution fix.
 * Pure unit tests for buildNonPersonalGameDetailView (no DOM, no CSS import).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNonPersonalGameDetailView } from '../src/app/pages/game-detail-discovery-fallback.ts';
import type { DiscoveryCatalogEntry } from '../src/core/discovery-catalog/types.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';

function discoveryEntry(overrides: Partial<DiscoveryCatalogEntry> = {}): DiscoveryCatalogEntry {
  return {
    solithGameId: 'palworld',
    title: 'Palworld',
    normalizedTitle: 'palworld',
    aliases: [],
    providerIds: { steam: '1623730' },
    type: 'game',
    genres: [],
    tags: [],
    trainerAvailable: false,
    ctAvailable: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildNonPersonalGameDetailView (Discovery-only game-detail resolution)', () => {
  test('returns null when neither catalog resolved anything — never fabricates a game', () => {
    const result = buildNonPersonalGameDetailView('unknown-id', null, null, false);
    assert.equal(result, null);
  });

  test('builds an honest view model from a Discovery-only entry with no trainer', () => {
    const result = buildNonPersonalGameDetailView('palworld', discoveryEntry(), null, false);
    assert.ok(result);
    assert.equal(result!.gameId, 'palworld');
    assert.equal(result!.title, 'Palworld');
    assert.equal(result!.installed, false);
    assert.equal(result!.owned, 'unknown');
    assert.equal(result!.favorite, false);
    assert.equal(result!.canonicalConfidence, 'UNKNOWN');
    assert.equal(result!.trainerAvailability, 'NONE');
    assert.equal(result!.trainerAccuracy, 'NONE');
    assert.deepEqual(result!.installEvidence, []);
    assert.deepEqual(result!.ownershipEvidence, []);
    assert.deepEqual(result!.versionEvidence, []);
  });

  test('caps trainerAvailability at COMMUNITY (never VERIFIED) from Discovery\'s boolean signal alone', () => {
    const result = buildNonPersonalGameDetailView('palworld', discoveryEntry({ trainerAvailable: true }), null, false);
    assert.equal(result!.trainerAvailability, 'COMMUNITY');
    assert.equal(result!.trainerAccuracy, 'VERSION_UNKNOWN');
  });

  test('reflects a real favorite flag even before any install/ownership evidence exists', () => {
    const result = buildNonPersonalGameDetailView('palworld', discoveryEntry(), null, true);
    assert.equal(result!.favorite, true);
  });

  test('prefers a real trainer-catalog entry over the Discovery fallback when both resolve', () => {
    const trainerEntry = { displayName: 'Palworld (Catalog)', verificationStatus: 'verified', cheatCount: 12 } as TrainerCatalogEntry;
    const result = buildNonPersonalGameDetailView('palworld', discoveryEntry(), trainerEntry, false);
    assert.equal(result!.title, 'Palworld (Catalog)');
    assert.equal(result!.trainerAvailability, 'VERIFIED');
    assert.equal(result!.trainerCount, 12);
  });
});
