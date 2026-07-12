import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getCatalogTagline } from '../src/core/trainer-catalog/game-taglines.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';

function entry(partial: Partial<TrainerCatalogEntry> & Pick<TrainerCatalogEntry, 'catalogGameId' | 'displayName'>): TrainerCatalogEntry {
  return {
    executables: [],
    categories: ['Action', 'RPG'],
    verificationStatus: 'metadata-only',
    sources: [],
    hasModPack: false,
    cheatCount: 0,
    searchableText: '',
    ...partial,
  };
}

describe('catalog taglines', () => {
  test('returns curated copy for bundled games', () => {
    const tagline = getCatalogTagline(entry({ catalogGameId: 'palworld', displayName: 'Palworld' }));
    assert.match(tagline, /survival/i);
  });

  test('synthetic catalog rows without steam id use category fallback', () => {
    const tagline = getCatalogTagline(
      entry({
        catalogGameId: 'legend-of-darkness-remastered',
        displayName: 'Legend of Darkness Remastered',
        categories: ['Horror', 'Indie'],
      }),
    );
    assert.match(tagline, /Horror/);
    assert.match(tagline, /single-player/i);
  });
});
