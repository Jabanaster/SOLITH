/**
 * ROADMAP §online-foundation Mission 7 — trainer coverage index projector tests.
 * Pure function — no database, no fixtures beyond plain object literals.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { projectTrainerCoverage } from '../src/core/trainer-catalog/coverage-index.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';

function baseEntry(overrides: Partial<TrainerCatalogEntry> = {}): TrainerCatalogEntry {
  return {
    catalogGameId: 'stardew-valley',
    displayName: 'Stardew Valley',
    executables: ['StardewValley.exe'],
    categories: ['farming-sim'],
    verificationStatus: 'unverified',
    sources: [],
    hasModPack: false,
    cheatCount: 0,
    searchableText: 'stardew valley',
    ...overrides,
  };
}

describe('projectTrainerCoverage', () => {
  test('trainer available: reflects hasModPack, modPackId, cheatCount, trustState', () => {
    const entry = baseEntry({
      hasModPack: true,
      modPackId: 'pack-stardew-1',
      cheatCount: 12,
      verificationStatus: 'verified',
      certLevel: 'L3_Certified',
      contentUpdatedAt: '2026-02-01T00:00:00.000Z',
    });
    const record = projectTrainerCoverage(entry);

    assert.equal(record.gameId, 'stardew-valley');
    assert.equal(record.trainerAvailable, true);
    assert.equal(record.trainerId, 'pack-stardew-1');
    assert.equal(record.cheatCount, 12);
    assert.equal(record.trustState, 'verified');
    assert.equal(record.lastUpdated, '2026-02-01T00:00:00.000Z');
  });

  test('no trainer: trainerAvailable is false and trainerId is omitted even if modPackId is stale', () => {
    const entry = baseEntry({ hasModPack: false, modPackId: 'stale-pack-id', cheatCount: 0 });
    const record = projectTrainerCoverage(entry);

    assert.equal(record.trainerAvailable, false);
    assert.equal(record.trainerId, undefined);
    assert.equal(record.cheatCount, 0);
  });

  test('artifact present: artifactHash and artifactSizeBytes are populated from the supplied reference', () => {
    const entry = baseEntry({ hasModPack: true, modPackId: 'pack-1', cheatCount: 3 });
    const record = projectTrainerCoverage(entry, { artifactHash: 'a'.repeat(64), sizeBytes: 204800 });

    assert.equal(record.artifactHash, 'a'.repeat(64));
    assert.equal(record.artifactSizeBytes, 204800);
  });

  test('artifact missing: artifactHash and artifactSizeBytes stay undefined when no reference is supplied', () => {
    const entry = baseEntry({ hasModPack: true, modPackId: 'pack-1', cheatCount: 3 });
    const record = projectTrainerCoverage(entry);

    assert.equal(record.artifactHash, undefined);
    assert.equal(record.artifactSizeBytes, undefined);
  });

  test('gameBuildHint is taken from the first executable when present', () => {
    const entry = baseEntry({ executables: ['Game.exe', 'GameLauncher.exe'] });
    const record = projectTrainerCoverage(entry);
    assert.equal(record.gameBuildHint, 'Game.exe');
  });

  test('gameBuildHint is omitted when there are no executables', () => {
    const entry = baseEntry({ executables: [] });
    const record = projectTrainerCoverage(entry);
    assert.equal(record.gameBuildHint, undefined);
  });

  test('source is taken from the first catalog source provider when present', () => {
    const entry = baseEntry({ sources: [{ provider: 'mrantifun', url: 'https://example.com/x' }] });
    const record = projectTrainerCoverage(entry);
    assert.equal(record.source, 'mrantifun');
  });

  test('source is omitted when there are no catalog sources', () => {
    const entry = baseEntry({ sources: [] });
    const record = projectTrainerCoverage(entry);
    assert.equal(record.source, undefined);
  });

  test('lastUpdated falls back to createdAt when contentUpdatedAt is absent, and to empty string when neither is set', () => {
    const withCreatedOnly = projectTrainerCoverage(baseEntry({ createdAt: '2026-01-01T00:00:00.000Z' }));
    assert.equal(withCreatedOnly.lastUpdated, '2026-01-01T00:00:00.000Z');

    const withNeither = projectTrainerCoverage(baseEntry());
    assert.equal(withNeither.lastUpdated, '');
  });

  test('trustState reuses the catalog verificationStatus vocabulary directly', () => {
    for (const status of ['verified', 'community', 'metadata-only', 'unverified'] as const) {
      const record = projectTrainerCoverage(baseEntry({ verificationStatus: status }));
      assert.equal(record.trustState, status);
    }
  });
});
