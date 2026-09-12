import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ArtworkCacheRefreshSchema, ArtworkCachePriorityFillSchema } from '../electron/ipc-validation.ts';

describe('ArtworkCacheRefreshSchema', () => {
  test('accepts an empty payload (defaults to the Popular-projection scope)', () => {
    const parsed = ArtworkCacheRefreshSchema.parse({});
    assert.equal(parsed.catalogGameIds, undefined);
  });

  test('accepts an explicit catalogGameIds list', () => {
    const parsed = ArtworkCacheRefreshSchema.parse({ catalogGameIds: ['stardew-valley', 'palworld'] });
    assert.deepEqual(parsed.catalogGameIds, ['stardew-valley', 'palworld']);
  });

  test('rejects a non-string entry', () => {
    assert.throws(() => ArtworkCacheRefreshSchema.parse({ catalogGameIds: [123] }));
  });

  test('rejects an empty-string catalogGameId', () => {
    assert.throws(() => ArtworkCacheRefreshSchema.parse({ catalogGameIds: [''] }));
  });
});

describe('ArtworkCachePriorityFillSchema', () => {
  function validCandidate(overrides: Record<string, unknown> = {}) {
    return {
      catalogGameId: 'stardew-valley',
      running: false,
      installed: true,
      confirmedOwned: false,
      favorite: false,
      recentlyDetected: false,
      canonicalConfidence: 'trusted',
      ...overrides,
    };
  }

  test('accepts an empty candidates array', () => {
    const parsed = ArtworkCachePriorityFillSchema.parse({ candidates: [] });
    assert.deepEqual(parsed.candidates, []);
  });

  test('accepts a well-formed candidate list', () => {
    const parsed = ArtworkCachePriorityFillSchema.parse({ candidates: [validCandidate()] });
    assert.equal(parsed.candidates.length, 1);
    assert.equal(parsed.candidates[0].catalogGameId, 'stardew-valley');
  });

  test('rejects a missing candidates field', () => {
    assert.throws(() => ArtworkCachePriorityFillSchema.parse({}));
  });

  test('rejects an empty-string catalogGameId', () => {
    assert.throws(() => ArtworkCachePriorityFillSchema.parse({ candidates: [validCandidate({ catalogGameId: '' })] }));
  });

  test('rejects a non-boolean flag', () => {
    assert.throws(() => ArtworkCachePriorityFillSchema.parse({ candidates: [validCandidate({ installed: 'yes' })] }));
  });

  test('rejects an invalid canonicalConfidence value (never accepts a fuzzy/unlisted tier)', () => {
    assert.throws(() => ArtworkCachePriorityFillSchema.parse({ candidates: [validCandidate({ canonicalConfidence: 'possible' })] }));
  });

  test('rejects more than 100 candidates — bounded, never the full catalog', () => {
    const candidates = Array.from({ length: 101 }, (_, i) => validCandidate({ catalogGameId: `game-${i}` }));
    assert.throws(() => ArtworkCachePriorityFillSchema.parse({ candidates }));
  });

  test('accepts exactly 100 candidates', () => {
    const candidates = Array.from({ length: 100 }, (_, i) => validCandidate({ catalogGameId: `game-${i}` }));
    const parsed = ArtworkCachePriorityFillSchema.parse({ candidates });
    assert.equal(parsed.candidates.length, 100);
  });
});
