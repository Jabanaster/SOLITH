import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { deriveArtworkResolutionState } from '../src/core/artwork-cache/artwork-resolution-state.ts';
import type { ArtworkCacheEntry } from '../src/core/artwork-cache/types.ts';

function entry(overrides: Partial<ArtworkCacheEntry> = {}): ArtworkCacheEntry {
  return {
    catalogGameId: 'stardew-valley',
    kind: 'header',
    sourceUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/413150/header.jpg',
    rightsClass: 'remote-unverified-rights',
    localPath: '',
    sizeBytes: 0,
    status: 'ok',
    fetchedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

describe('deriveArtworkResolutionState', () => {
  test('NONE: no custom art, no cache entry, not personal', () => {
    assert.equal(
      deriveArtworkResolutionState({ hasCustomArtwork: false, isPersonal: false }),
      'NONE',
    );
  });

  test('LOCAL_CUSTOM: custom art always wins, even with a successful cache entry present', () => {
    assert.equal(
      deriveArtworkResolutionState({
        hasCustomArtwork: true,
        cacheEntry: entry({ status: 'ok' }),
        isPersonal: true,
      }),
      'LOCAL_CUSTOM',
    );
  });

  test('LOCAL_CUSTOM: custom art wins even with no cache entry and not personal', () => {
    assert.equal(
      deriveArtworkResolutionState({ hasCustomArtwork: true, isPersonal: false }),
      'LOCAL_CUSTOM',
    );
  });

  test('LOCAL_CUSTOM: custom art wins over a FAILED cache entry', () => {
    assert.equal(
      deriveArtworkResolutionState({
        hasCustomArtwork: true,
        cacheEntry: entry({ status: 'failed', lastError: 'boom' }),
        isPersonal: true,
      }),
      'LOCAL_CUSTOM',
    );
  });

  test('LOCAL_CUSTOM: custom art wins over a RIGHTS_BLOCKED cache entry', () => {
    assert.equal(
      deriveArtworkResolutionState({
        hasCustomArtwork: true,
        cacheEntry: entry({ status: 'rights-blocked' }),
        isPersonal: true,
      }),
      'LOCAL_CUSTOM',
    );
  });

  test('LOCAL_CACHED_PROVIDER: no custom art, cache entry status ok', () => {
    assert.equal(
      deriveArtworkResolutionState({
        hasCustomArtwork: false,
        cacheEntry: entry({ status: 'ok' }),
        isPersonal: true,
      }),
      'LOCAL_CACHED_PROVIDER',
    );
  });

  test('FAILED: no custom art, cache entry status failed', () => {
    assert.equal(
      deriveArtworkResolutionState({
        hasCustomArtwork: false,
        cacheEntry: entry({ status: 'failed', lastError: 'HTTP 404' }),
        isPersonal: true,
      }),
      'FAILED',
    );
  });

  test('RIGHTS_BLOCKED: no custom art, cache entry status rights-blocked', () => {
    assert.equal(
      deriveArtworkResolutionState({
        hasCustomArtwork: false,
        cacheEntry: entry({ status: 'rights-blocked' }),
        isPersonal: true,
      }),
      'RIGHTS_BLOCKED',
    );
  });

  test('PROVIDER_AVAILABLE: cache entry pending, game is personal', () => {
    assert.equal(
      deriveArtworkResolutionState({
        hasCustomArtwork: false,
        cacheEntry: entry({ status: 'pending' }),
        isPersonal: true,
      }),
      'PROVIDER_AVAILABLE',
    );
  });

  test('NONE: cache entry pending, but game is NOT personal (Discovery-only)', () => {
    assert.equal(
      deriveArtworkResolutionState({
        hasCustomArtwork: false,
        cacheEntry: entry({ status: 'pending' }),
        isPersonal: false,
      }),
      'NONE',
    );
  });

  test('PROVIDER_AVAILABLE: no cache entry at all, but game is personal', () => {
    assert.equal(
      deriveArtworkResolutionState({ hasCustomArtwork: false, isPersonal: true }),
      'PROVIDER_AVAILABLE',
    );
  });

  test('NONE: no cache entry at all, and game is not personal', () => {
    assert.equal(
      deriveArtworkResolutionState({ hasCustomArtwork: false, isPersonal: false }),
      'NONE',
    );
  });
});
