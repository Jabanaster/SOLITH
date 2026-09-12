/**
 * Core Product Completion audit — Mission 6 (audit) / Mission 7 (partial fix)
 * hostile identity-safety tests for artwork resolution.
 *
 * Reuses the exact edition/remaster scenarios from
 * tests/canonical-games-identity-safety.test.ts (Dark Souls / II / III,
 * Final Fantasy VII / Remake / Rebirth, Oblivion / Remastered) but asserts on
 * artwork resolution specifically:
 *   - `resolveCatalogCoverUrl`/`resolveCatalogHeaderUrl` (cover-url.ts) must
 *     never let a weakly-matched (title-only) canonical identity serve
 *     provider-derived (Steam CDN) artwork for the wrong edition.
 *   - The artwork cache (artwork-cache/store.ts) keys strictly off
 *     catalogGameId, so distinct editions can never share a cache row.
 *
 * All fixtures are invented/plausible-but-fake test data.
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import { upsertArtworkCacheEntry, getArtworkCacheEntry } from '../src/core/artwork-cache/store.ts';
import type { ArtworkCacheEntry } from '../src/core/artwork-cache/types.ts';
import { resolveCatalogCoverUrl, resolveCatalogHeaderUrl } from '../src/core/trainer-catalog/cover-url.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';

function catalogEntry(overrides: Partial<TrainerCatalogEntry> & { catalogGameId: string; displayName: string }): TrainerCatalogEntry {
  return {
    executables: [],
    categories: [],
    verificationStatus: 'community',
    sources: [],
    hasModPack: false,
    cheatCount: 0,
    searchableText: overrides.displayName.toLowerCase(),
    ...overrides,
  };
}

function cacheEntry(overrides: Partial<ArtworkCacheEntry> & { catalogGameId: string; kind: ArtworkCacheEntry['kind'] }): ArtworkCacheEntry {
  return {
    sourceUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1/header.jpg',
    rightsClass: 'user-provided',
    localPath: 'C:/userdata/artwork-cache/x__header.jpg',
    sizeBytes: 1000,
    status: 'ok',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('artwork identity safety — cover-url resolution never crosses edition boundaries', () => {
  beforeAll(async () => {
    await resetForTesting();
  });

  afterAll(async () => {
    await resetForTesting();
  });

  describe('Dark Souls vs Dark Souls II vs Dark Souls III', () => {
    const darkSouls = catalogEntry({ catalogGameId: 'dark-souls', displayName: 'Dark Souls', steamAppId: 211420 });
    const darkSouls2 = catalogEntry({ catalogGameId: 'dark-souls-2', displayName: 'Dark Souls II', steamAppId: 236430 });
    const darkSouls3 = catalogEntry({ catalogGameId: 'dark-souls-3', displayName: 'Dark Souls III', steamAppId: 374320 });

    test('trusted (verified canonical identity) resolution: each entry resolves to its OWN steamAppId-derived CDN URL, never shared', () => {
      const urls = [darkSouls, darkSouls2, darkSouls3].map((entry) =>
        resolveCatalogCoverUrl(entry, { canonicalConfidence: 'trusted' }),
      );
      assert.ok(urls.every((u) => typeof u === 'string'));
      assert.equal(new Set(urls).size, 3, 'three distinct editions must never resolve to the same cover URL');
      assert.ok(urls[0]!.includes('211420'));
      assert.ok(urls[1]!.includes('236430'));
      assert.ok(urls[2]!.includes('374320'));
    });

    test('weak (backfilled/title-only canonical identity) resolution never serves provider-derived artwork for any of the three', () => {
      for (const entry of [darkSouls, darkSouls2, darkSouls3]) {
        const cover = resolveCatalogCoverUrl(entry, { canonicalConfidence: 'weak' });
        const header = resolveCatalogHeaderUrl(entry, { canonicalConfidence: 'weak' });
        assert.equal(cover, undefined, `${entry.displayName} must not receive Steam CDN cover art from a weak identity match`);
        assert.equal(header, undefined, `${entry.displayName} must not receive Steam CDN header art from a weak identity match`);
      }
    });

    test('a locally cached artwork entry for Dark Souls II never leaks into Dark Souls or Dark Souls III lookups', () => {
      upsertArtworkCacheEntry(
        cacheEntry({ catalogGameId: 'dark-souls-2', kind: 'cover', localPath: 'C:/cache/dark-souls-2__cover.jpg' }),
      );
      assert.equal(resolveCatalogCoverUrl(darkSouls, { canonicalConfidence: 'weak' }), undefined);
      assert.equal(resolveCatalogCoverUrl(darkSouls3, { canonicalConfidence: 'weak' }), undefined);
      const ds2Cover = resolveCatalogCoverUrl(darkSouls2, { canonicalConfidence: 'weak' });
      assert.ok(ds2Cover?.includes('dark-souls-2'));
    });
  });

  describe('Final Fantasy VII vs VII Remake vs VII Rebirth', () => {
    const ff7 = catalogEntry({ catalogGameId: 'final-fantasy-vii', displayName: 'Final Fantasy VII', steamAppId: 39140 });
    const ff7Remake = catalogEntry({ catalogGameId: 'final-fantasy-vii-remake', displayName: 'Final Fantasy VII Remake', steamAppId: 1462040 });
    const ff7Rebirth = catalogEntry({ catalogGameId: 'final-fantasy-vii-rebirth', displayName: 'Final Fantasy VII Rebirth', steamAppId: 2909400 });

    test('artwork cache rows for all three never collide even though titles share a common prefix', () => {
      upsertArtworkCacheEntry(cacheEntry({ catalogGameId: 'final-fantasy-vii', kind: 'header', localPath: 'C:/cache/ff7__header.jpg' }));
      upsertArtworkCacheEntry(cacheEntry({ catalogGameId: 'final-fantasy-vii-remake', kind: 'header', localPath: 'C:/cache/ff7-remake__header.jpg' }));
      upsertArtworkCacheEntry(cacheEntry({ catalogGameId: 'final-fantasy-vii-rebirth', kind: 'header', localPath: 'C:/cache/ff7-rebirth__header.jpg' }));

      const original = getArtworkCacheEntry('final-fantasy-vii', 'header');
      const remake = getArtworkCacheEntry('final-fantasy-vii-remake', 'header');
      const rebirth = getArtworkCacheEntry('final-fantasy-vii-rebirth', 'header');
      assert.ok(original && remake && rebirth);
      const paths = new Set([original!.localPath, remake!.localPath, rebirth!.localPath]);
      assert.equal(paths.size, 3, 'each edition must have its own independent cache row/localPath');
    });

    test('trusted resolution keeps each entry pinned to its own steamAppId-derived CDN URL', () => {
      const urls = [ff7, ff7Remake, ff7Rebirth].map((entry) =>
        resolveCatalogHeaderUrl(entry, { canonicalConfidence: 'trusted' }),
      );
      assert.equal(new Set(urls).size, 3);
    });

    test('weak resolution never falls back to a sibling edition\'s Steam CDN artwork', () => {
      // Distinct catalogGameIds from the cache-precedence test above (which
      // legitimately caches 'final-fantasy-vii'/'-remake'/'-rebirth' headers) —
      // this test is specifically about the no-cache, weak-confidence path.
      const uncachedFf7 = catalogEntry({ catalogGameId: 'ff7-uncached', displayName: 'Final Fantasy VII', steamAppId: 39140 });
      const uncachedRemake = catalogEntry({ catalogGameId: 'ff7-remake-uncached', displayName: 'Final Fantasy VII Remake', steamAppId: 1462040 });
      const uncachedRebirth = catalogEntry({ catalogGameId: 'ff7-rebirth-uncached', displayName: 'Final Fantasy VII Rebirth', steamAppId: 2909400 });
      for (const entry of [uncachedFf7, uncachedRemake, uncachedRebirth]) {
        assert.equal(resolveCatalogHeaderUrl(entry, { canonicalConfidence: 'weak' }), undefined);
      }
    });
  });

  describe('The Elder Scrolls IV: Oblivion vs Oblivion Remastered', () => {
    const oblivion = catalogEntry({ catalogGameId: 'oblivion', displayName: 'The Elder Scrolls IV: Oblivion', steamAppId: 22330 });
    const oblivionRemastered = catalogEntry({ catalogGameId: 'oblivion-remastered', displayName: 'The Elder Scrolls IV: Oblivion Remastered', steamAppId: 2623190 });

    test('trusted resolution distinguishes the original from the remaster', () => {
      const originalUrl = resolveCatalogCoverUrl(oblivion, { canonicalConfidence: 'trusted' });
      const remasterUrl = resolveCatalogCoverUrl(oblivionRemastered, { canonicalConfidence: 'trusted' });
      assert.notEqual(originalUrl, remasterUrl);
      assert.ok(originalUrl?.includes('22330'));
      assert.ok(remasterUrl?.includes('2623190'));
    });

    test('a curated coverUrl on the remaster is never shadowed by the original\'s data, and vice versa', () => {
      const curatedOriginal = catalogEntry({
        catalogGameId: 'oblivion',
        displayName: 'The Elder Scrolls IV: Oblivion',
        steamAppId: 22330,
        coverUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/22330/library_600x900_2x.jpg',
      });
      const curatedRemaster = catalogEntry({
        catalogGameId: 'oblivion-remastered',
        displayName: 'The Elder Scrolls IV: Oblivion Remastered',
        steamAppId: 2623190,
        coverUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/2623190/library_600x900_2x.jpg',
      });
      assert.notEqual(
        resolveCatalogCoverUrl(curatedOriginal, { canonicalConfidence: 'weak' }),
        resolveCatalogCoverUrl(curatedRemaster, { canonicalConfidence: 'weak' }),
      );
    });

    test('weak canonical identity for the remaster does not fall back to the original\'s headerUrl or vice versa', () => {
      const originalWithHeader = catalogEntry({
        catalogGameId: 'oblivion',
        displayName: 'The Elder Scrolls IV: Oblivion',
        steamAppId: 22330,
        headerUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/22330/header.jpg',
      });
      const remasterNoArt = catalogEntry({
        catalogGameId: 'oblivion-remastered',
        displayName: 'The Elder Scrolls IV: Oblivion Remastered',
        steamAppId: 2623190,
      });
      const originalHeader = resolveCatalogHeaderUrl(originalWithHeader, { canonicalConfidence: 'weak' });
      const remasterHeader = resolveCatalogHeaderUrl(remasterNoArt, { canonicalConfidence: 'weak' });
      assert.ok(originalHeader?.includes('22330'));
      assert.equal(remasterHeader, undefined, 'remaster with no curated art and only a weak identity must fall through to the SOLITH fallback, never borrow the original\'s art');
    });
  });

  describe('cache precedence over remote URLs (never let a stale/wrong remote URL win over a verified local file)', () => {
    test('an ok cache entry wins even when entry.coverUrl also points somewhere else', () => {
      const entry = catalogEntry({
        catalogGameId: 'cache-precedence-game',
        displayName: 'Cache Precedence Game',
        steamAppId: 55,
        coverUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/55/library_600x900_2x.jpg',
      });
      upsertArtworkCacheEntry(
        cacheEntry({ catalogGameId: 'cache-precedence-game', kind: 'cover', localPath: 'C:/cache/cache-precedence-game__cover.jpg' }),
      );
      const resolved = resolveCatalogCoverUrl(entry, { canonicalConfidence: 'trusted' });
      assert.ok(resolved?.includes('cache-precedence-game__cover.jpg'), 'local cache entry must win over entry.coverUrl');
    });

    test('a failed/pending/rights-blocked cache entry does not shadow a valid coverUrl', () => {
      const entry = catalogEntry({
        catalogGameId: 'never-cached-game',
        displayName: 'Never Cached Game',
        coverUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/77/library_600x900_2x.jpg',
      });
      upsertArtworkCacheEntry(
        cacheEntry({ catalogGameId: 'never-cached-game', kind: 'cover', status: 'failed', localPath: '', sizeBytes: 0 }),
      );
      assert.equal(resolveCatalogCoverUrl(entry, { canonicalConfidence: 'trusted' }), entry.coverUrl);
    });
  });
});
