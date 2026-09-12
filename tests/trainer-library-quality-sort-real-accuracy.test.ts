import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { sortTrainerLibraryFlatEntries } from '../src/app/pages/trainer-library-sort-options.ts';
import type { TrainerAccuracyState } from '../src/core/trainer-catalog/trainer-accuracy.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';

/**
 * Mission 12 (Personal Library Completion pass, Phase 2) — "Trainer quality"
 * sort now prefers the REAL TrainerAccuracyState when supplied via
 * trainerAccuracyByCatalogGameId, replacing the pre-Phase-1
 * verificationStatus/hasModPack/cheatCount placeholder for that case. The
 * placeholder-only test (no map supplied) already exists in
 * tests/trainer-library-sort-ui.test.ts and stays green — this file only
 * covers the new real-accuracy path.
 */

function baseEntry(overrides: Partial<TrainerCatalogEntry> = {}): TrainerCatalogEntry {
  return {
    catalogGameId: 'test-game',
    displayName: 'Test Game',
    executables: ['Test.exe'],
    categories: ['Action'],
    verificationStatus: 'metadata-only',
    sources: [],
    hasModPack: false,
    cheatCount: 0,
    searchableText: 'test game',
    ...overrides,
  };
}

describe('Trainer quality sort — real TrainerAccuracyState comparator', () => {
  test('ranks the exact frozen order: LOCALLY_VERIFIED > EXACT_VERSION_MATCH > STRONG_MATCH > VERSION_UNKNOWN > NEEDS_REVERIFY > INCOMPATIBLE > NONE', () => {
    const order: TrainerAccuracyState[] = [
      'NONE',
      'INCOMPATIBLE',
      'NEEDS_REVERIFY',
      'VERSION_UNKNOWN',
      'STRONG_MATCH',
      'EXACT_VERSION_MATCH',
      'LOCALLY_VERIFIED',
    ];
    const entries = order.map((state, i) => baseEntry({ catalogGameId: `g${i}`, displayName: `G${i}` }));
    const accuracyByCatalogGameId = new Map<string, TrainerAccuracyState>(
      entries.map((e, i) => [e.catalogGameId, order[i]]),
    );

    const sorted = sortTrainerLibraryFlatEntries(entries, 'trainer-quality', { trainerAccuracyByCatalogGameId: accuracyByCatalogGameId });
    const sortedStates = sorted.map((e) => accuracyByCatalogGameId.get(e.catalogGameId));
    assert.deepEqual(sortedStates, [
      'LOCALLY_VERIFIED',
      'EXACT_VERSION_MATCH',
      'STRONG_MATCH',
      'VERSION_UNKNOWN',
      'NEEDS_REVERIFY',
      'INCOMPATIBLE',
      'NONE',
    ]);
  });

  test('an entry with real LOCALLY_VERIFIED evidence outranks a "verified"-catalog-status entry with weaker real accuracy', () => {
    // Catalog-level trust (verificationStatus) and personal trainer accuracy
    // are deliberately different signals — Mission 12 wants the REAL
    // accuracy to win once supplied, even against a catalog entry that
    // looks stronger under the old placeholder heuristic.
    const weakButCatalogVerified = baseEntry({
      catalogGameId: 'weak',
      displayName: 'Weak',
      verificationStatus: 'verified',
      hasModPack: true,
      cheatCount: 50,
    });
    const strongRealAccuracy = baseEntry({
      catalogGameId: 'strong',
      displayName: 'Strong',
      verificationStatus: 'metadata-only',
      hasModPack: false,
      cheatCount: 0,
    });
    const accuracyByCatalogGameId = new Map<string, TrainerAccuracyState>([
      ['weak', 'VERSION_UNKNOWN'],
      ['strong', 'LOCALLY_VERIFIED'],
    ]);

    const sorted = sortTrainerLibraryFlatEntries(
      [weakButCatalogVerified, strongRealAccuracy],
      'trainer-quality',
      { trainerAccuracyByCatalogGameId: accuracyByCatalogGameId },
    );
    assert.deepEqual(sorted.map((e) => e.catalogGameId), ['strong', 'weak']);
  });

  test('an entry absent from the accuracy map is treated as NONE, not crashing or guessing', () => {
    const known = baseEntry({ catalogGameId: 'known', displayName: 'Known' });
    const unknown = baseEntry({ catalogGameId: 'unknown-entry', displayName: 'Unknown' });
    const accuracyByCatalogGameId = new Map<string, TrainerAccuracyState>([['known', 'STRONG_MATCH']]);

    const sorted = sortTrainerLibraryFlatEntries([unknown, known], 'trainer-quality', {
      trainerAccuracyByCatalogGameId: accuracyByCatalogGameId,
    });
    assert.deepEqual(sorted.map((e) => e.catalogGameId), ['known', 'unknown-entry']);
  });

  test('ties within the same accuracy state fall back to alphabetical name', () => {
    const b = baseEntry({ catalogGameId: 'b', displayName: 'Beta' });
    const a = baseEntry({ catalogGameId: 'a', displayName: 'Alpha' });
    const accuracyByCatalogGameId = new Map<string, TrainerAccuracyState>([
      ['a', 'STRONG_MATCH'],
      ['b', 'STRONG_MATCH'],
    ]);
    const sorted = sortTrainerLibraryFlatEntries([b, a], 'trainer-quality', {
      trainerAccuracyByCatalogGameId: accuracyByCatalogGameId,
    });
    assert.deepEqual(sorted.map((e) => e.catalogGameId), ['a', 'b']);
  });

  test('when no accuracy map is supplied at all, behavior is unchanged from the pre-Mission-12 placeholder (backward compatible)', () => {
    const entries = [
      baseEntry({ catalogGameId: 'meta', displayName: 'Meta', verificationStatus: 'metadata-only' }),
      baseEntry({ catalogGameId: 'verified', displayName: 'Verified', verificationStatus: 'verified', hasModPack: true, cheatCount: 5 }),
    ];
    const sorted = sortTrainerLibraryFlatEntries(entries, 'trainer-quality');
    assert.deepEqual(sorted.map((e) => e.catalogGameId), ['verified', 'meta']);
  });
});
