/**
 * ROADMAP §4.3 managed local artwork cache — schema/persistence tests.
 * Isolated from shared project data via resetForTesting() (:memory: sql.js).
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import {
  upsertArtworkCacheEntry,
  getArtworkCacheEntry,
  listOkArtworkCacheKeys,
  listFailedArtworkCacheEntries,
  listAllArtworkCacheEntries,
} from '../src/core/artwork-cache/store.ts';
import type { ArtworkCacheEntry } from '../src/core/artwork-cache/types.ts';

function entry(overrides: Partial<ArtworkCacheEntry> & { catalogGameId: string; kind: ArtworkCacheEntry['kind'] }): ArtworkCacheEntry {
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

describe('artwork_cache store', () => {
  beforeAll(async () => {
    await resetForTesting();
  });

  afterAll(async () => {
    await resetForTesting();
  });

  test('round-trips a cache entry through upsert/get', () => {
    upsertArtworkCacheEntry(entry({ catalogGameId: 'stardew-valley', kind: 'header' }));
    const read = getArtworkCacheEntry('stardew-valley', 'header');
    assert.ok(read);
    assert.equal(read!.status, 'ok');
    assert.equal(read!.sizeBytes, 1000);
    assert.equal(read!.lastError, undefined);
  });

  test('upsert overwrites the prior row for the same (catalogGameId, kind) pair', () => {
    upsertArtworkCacheEntry(entry({ catalogGameId: 'overwrite-me', kind: 'cover', status: 'ok', sizeBytes: 111 }));
    upsertArtworkCacheEntry(entry({ catalogGameId: 'overwrite-me', kind: 'cover', status: 'failed', sizeBytes: 0, lastError: 'HTTP 404' }));
    const read = getArtworkCacheEntry('overwrite-me', 'cover');
    assert.equal(read!.status, 'failed');
    assert.equal(read!.lastError, 'HTTP 404');
    const all = listAllArtworkCacheEntries().filter((e) => e.catalogGameId === 'overwrite-me');
    assert.equal(all.length, 1, 'must overwrite, never accumulate duplicate rows');
  });

  test('a header and a cover for the same game are independent rows', () => {
    upsertArtworkCacheEntry(entry({ catalogGameId: 'dual-kind', kind: 'header' }));
    upsertArtworkCacheEntry(entry({ catalogGameId: 'dual-kind', kind: 'cover' }));
    assert.ok(getArtworkCacheEntry('dual-kind', 'header'));
    assert.ok(getArtworkCacheEntry('dual-kind', 'cover'));
    assert.equal(getArtworkCacheEntry('dual-kind', 'icon'), null);
  });

  test('listOkArtworkCacheKeys only includes status=ok rows', () => {
    upsertArtworkCacheEntry(entry({ catalogGameId: 'ok-game', kind: 'header', status: 'ok' }));
    upsertArtworkCacheEntry(entry({ catalogGameId: 'failed-game', kind: 'header', status: 'failed', sizeBytes: 0 }));
    const keys = listOkArtworkCacheKeys();
    assert.ok(keys.has('ok-game__header'));
    assert.ok(!keys.has('failed-game__header'));
  });

  test('listFailedArtworkCacheEntries only includes status=failed rows', () => {
    const failed = listFailedArtworkCacheEntries();
    assert.ok(failed.some((e) => e.catalogGameId === 'failed-game'));
    assert.ok(!failed.some((e) => e.catalogGameId === 'ok-game'));
  });

  test('listFailedArtworkCacheEntries excludes rights-blocked rows (retrying cannot fix a rights decision)', () => {
    upsertArtworkCacheEntry(entry({ catalogGameId: 'rights-blocked-game', kind: 'header', status: 'rights-blocked', rightsClass: 'remote-unverified-rights', sizeBytes: 0 }));
    const failed = listFailedArtworkCacheEntries();
    assert.ok(!failed.some((e) => e.catalogGameId === 'rights-blocked-game'));
  });

  test('round-trips rightsClass and an optional licenseNote', () => {
    upsertArtworkCacheEntry(
      entry({ catalogGameId: 'licensed-game', kind: 'cover', rightsClass: 'explicitly-licensed', licenseNote: 'CC-BY-4.0, per publisher email 2026-01-01' }),
    );
    const read = getArtworkCacheEntry('licensed-game', 'cover');
    assert.equal(read!.rightsClass, 'explicitly-licensed');
    assert.equal(read!.licenseNote, 'CC-BY-4.0, per publisher email 2026-01-01');
  });

  test('licenseNote is omitted (not an empty string) when never set', () => {
    upsertArtworkCacheEntry(entry({ catalogGameId: 'no-license-note', kind: 'header' }));
    const read = getArtworkCacheEntry('no-license-note', 'header');
    assert.equal(read!.licenseNote, undefined);
  });
});
