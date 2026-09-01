import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ArtworkCacheRefreshSchema } from '../electron/ipc-validation.ts';

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
