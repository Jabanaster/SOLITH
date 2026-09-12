/**
 * ROADMAP Mission 6 — verifies (with a real DB-backed test, not assumption)
 * that the artwork-cache lookup layer in cover-url.ts degrades safely for
 * a stale 'ok' row: a DB row can claim status 'ok' with a localPath that no
 * longer exists on disk (file deleted, drive unmounted, cache dir wiped by
 * the user, etc.) — cover-url.ts's resolveCachedArtworkUrl deliberately does
 * NOT stat() the file on every render (that would add a synchronous
 * filesystem syscall to a hot render path across every visible card), so it
 * still returns a solith-asset:// URL for that path. The actual "degrade to
 * fallback" happens one layer up, at render time: every real consumer
 * (GameCard.tsx, CatalogCard in TrainerLibraryPage.tsx, DetailBanner.tsx)
 * wires an <img onError> handler that swaps to the SOLITH branded fallback
 * the moment the browser fails to load that (now-missing) file — the exact
 * same mechanism that already handles a dead/expired CDN URL. This test
 * proves the lookup layer's half of that contract: it must never throw and
 * must still hand back a resolvable-looking URL rather than silently
 * dropping to `undefined` (which would skip straight to the fallback
 * without ever giving the real file a chance, on the rare case a caller's
 * filesystem view is stale rather than the disk state itself).
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import { upsertArtworkCacheEntry } from '../src/core/artwork-cache/store.ts';
import { resolveCatalogCoverUrl, resolveCatalogHeaderUrl } from '../src/core/trainer-catalog/cover-url.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';

function baseEntry(overrides: Partial<TrainerCatalogEntry> = {}): TrainerCatalogEntry {
  return {
    catalogGameId: 'stardew-valley',
    displayName: 'Stardew Valley',
    executables: [],
    categories: [],
    verificationStatus: 'verified',
    sources: [],
    hasModPack: false,
    cheatCount: 0,
    searchableText: 'stardew valley',
    ...overrides,
  };
}

/** cover-url.ts's cache accessors load via a fire-and-forget dynamic import at module init — give it a tick to settle before asserting on cache-backed behavior. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe('resolveCatalogCoverUrl / resolveCatalogHeaderUrl — stale cache row (file missing on disk despite an "ok" DB row)', () => {
  beforeAll(async () => {
    await resetForTesting();
    await settle();
  });

  afterAll(async () => {
    await resetForTesting();
  });

  test('an "ok" cache row whose localPath no longer exists on disk still resolves to a URL, never throws, never silently returns undefined', async () => {
    upsertArtworkCacheEntry({
      catalogGameId: 'stardew-valley',
      kind: 'cover',
      sourceUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/413150/library_600x900_2x.jpg',
      rightsClass: 'user-provided',
      localPath: 'C:/nonexistent/does-not-exist-anymore/stardew-valley__cover.jpg',
      sizeBytes: 12345,
      status: 'ok',
      fetchedAt: '2026-01-01T00:00:00.000Z',
    });

    const entry = baseEntry({ steamAppId: 413150 });
    assert.doesNotThrow(() => resolveCatalogCoverUrl(entry));

    const resolved = resolveCatalogCoverUrl(entry);
    // Real behavior recorded here, not assumed: the cache lookup trusts the
    // DB row's status and hands back the local path unchanged (routed
    // through the guarded solith-asset:// protocol) — it is the browser's
    // failed image load (404 on that solith-asset path) plus each
    // consumer's onError handler that actually swaps to the fallback.
    assert.equal(resolved, 'solith-asset://local/' + encodeURIComponent('C:/nonexistent/does-not-exist-anymore/stardew-valley__cover.jpg'));
  });

  test('a "failed" cache row never resolves to a cached URL — falls through to the rest of the hierarchy instead', async () => {
    upsertArtworkCacheEntry({
      catalogGameId: 'no-such-cache-hit',
      kind: 'header',
      sourceUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/999999/header.jpg',
      rightsClass: 'remote-unverified-rights',
      localPath: '',
      sizeBytes: 0,
      status: 'failed',
      fetchedAt: '2026-01-01T00:00:00.000Z',
      lastError: 'HTTP 404',
    });

    // No curated headerUrl and no steamAppId means the hierarchy has
    // nothing left to fall through to — proves 'failed' rows are excluded
    // from the cache tier (not accidentally treated as a hit) rather than
    // asserting a specific downstream URL.
    const entry = baseEntry({ catalogGameId: 'no-such-cache-hit', displayName: 'No Such Cache Hit' });
    assert.equal(resolveCatalogHeaderUrl(entry), undefined);
  });

  test('a "rights-blocked" cache row never resolves to a cached URL either', async () => {
    upsertArtworkCacheEntry({
      catalogGameId: 'blocked-game',
      kind: 'header',
      sourceUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1/header.jpg',
      rightsClass: 'remote-unverified-rights',
      localPath: '',
      sizeBytes: 0,
      status: 'rights-blocked',
      fetchedAt: '2026-01-01T00:00:00.000Z',
    });

    const entry = baseEntry({ catalogGameId: 'blocked-game', displayName: 'Blocked Game' });
    assert.equal(resolveCatalogHeaderUrl(entry), undefined);
  });
});
