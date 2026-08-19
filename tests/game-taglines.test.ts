import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getCatalogTagline, getCuratedTagline } from '../src/core/trainer-catalog/game-taglines.ts';
import { slugifyGameId } from '../src/core/trainer-catalog/types.ts';
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

describe('getCuratedTagline — curated-only, no synthesized fallback', () => {
  test('returns curated copy for bundled games', () => {
    const tagline = getCuratedTagline(entry({ catalogGameId: 'palworld', displayName: 'Palworld' }));
    assert.match(tagline ?? '', /survival/i);
  });

  test('returns undefined for uncurated entries instead of restating categories', () => {
    // The card's supporting-metadata line already shows categories + cheat
    // count; a synthesized tagline here would just duplicate that text.
    const tagline = getCuratedTagline(
      entry({
        catalogGameId: 'legend-of-darkness-remastered',
        displayName: 'Legend of Darkness Remastered',
        categories: ['Horror', 'Indie'],
      }),
    );
    assert.equal(tagline, undefined);
  });
});

describe('curated tagline key matches the real catalogGameId', () => {
  test("Baldur's Gate 3's canonical catalogGameId retrieves its curated tagline", () => {
    // catalogGameId is always produced by slugifyGameId(displayName) — the
    // curated key must match that, not a hand-typed guess. This regression
    // guards the confirmed defect where the key was 'baldurs-gate-3' but
    // slugifyGameId("Baldur's Gate 3") produces 'baldur-s-gate-3', so the
    // curated tagline silently never matched.
    const catalogGameId = slugifyGameId("Baldur's Gate 3");
    assert.equal(catalogGameId, 'baldur-s-gate-3');

    const tagline = getCuratedTagline(
      entry({ catalogGameId, displayName: "Baldur's Gate 3", steamAppId: 1086940 }),
    );
    assert.equal(tagline, 'Party-based CRPG with tactical turn-based combat.');
  });
});
