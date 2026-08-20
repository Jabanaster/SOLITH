import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAllowedArtworkUrl,
  isAllowedArtworkContentType,
  isPersistableRightsClass,
  extensionForContentType,
  MAX_ARTWORK_BYTES,
  MAX_ARTWORK_REDIRECTS,
} from '../src/core/artwork-cache/fetch-policy.ts';
import { artworkCacheKey } from '../src/core/artwork-cache/cache-key.ts';

describe('isAllowedArtworkUrl', () => {
  test('accepts an https URL on the Steam CDN allowlist', () => {
    assert.equal(isAllowedArtworkUrl('https://cdn.cloudflare.steamstatic.com/steam/apps/620/header.jpg'), true);
  });

  test('rejects http (non-https) even on an allowlisted host', () => {
    assert.equal(isAllowedArtworkUrl('http://cdn.cloudflare.steamstatic.com/steam/apps/620/header.jpg'), false);
  });

  test('rejects a host not on the allowlist', () => {
    assert.equal(isAllowedArtworkUrl('https://evil.example.com/steam/apps/620/header.jpg'), false);
  });

  test('rejects a malformed URL without throwing', () => {
    assert.equal(isAllowedArtworkUrl('not a url'), false);
  });

  test('rejects an allowlisted host used only as a subdomain suffix (no bypass via lookalike hostnames)', () => {
    assert.equal(isAllowedArtworkUrl('https://cdn.cloudflare.steamstatic.com.evil.com/x.jpg'), false);
  });
});

describe('isAllowedArtworkContentType', () => {
  test('accepts jpeg/png/webp', () => {
    assert.equal(isAllowedArtworkContentType('image/jpeg'), true);
    assert.equal(isAllowedArtworkContentType('image/png; charset=binary'), true);
    assert.equal(isAllowedArtworkContentType('image/webp'), true);
  });

  test('rejects SVG explicitly, never silently rasterizes it', () => {
    assert.equal(isAllowedArtworkContentType('image/svg+xml'), false);
  });

  test('rejects missing/unknown content-type', () => {
    assert.equal(isAllowedArtworkContentType(undefined), false);
    assert.equal(isAllowedArtworkContentType(null), false);
    assert.equal(isAllowedArtworkContentType('text/html'), false);
  });
});

describe('extensionForContentType', () => {
  test('maps known types to their extension, defaults unknown-but-allowed cases to jpg', () => {
    assert.equal(extensionForContentType('image/png'), 'png');
    assert.equal(extensionForContentType('image/webp'), 'webp');
    assert.equal(extensionForContentType('image/jpeg'), 'jpg');
  });
});

describe('isPersistableRightsClass', () => {
  test('SOLITH-owned artwork may be persisted', () => {
    assert.equal(isPersistableRightsClass('solith-owned'), true);
  });

  test('explicitly-licensed artwork may be persisted', () => {
    assert.equal(isPersistableRightsClass('explicitly-licensed'), true);
  });

  test('user-provided artwork may be persisted', () => {
    assert.equal(isPersistableRightsClass('user-provided'), true);
  });

  test('remote-unverified-rights artwork (e.g. Steam CDN) is rejected from persistent cache', () => {
    assert.equal(isPersistableRightsClass('remote-unverified-rights'), false);
  });

  test('an unknown/malformed rights class fails closed (rejected), never defaults to allowed', () => {
    // Defends a DB row corrupted or written by a future bug — the allowlist is a
    // strict membership check, not a denylist, so anything not explicitly
    // approved is refused.
    assert.equal(isPersistableRightsClass('garbage-value' as never), false);
    assert.equal(isPersistableRightsClass('' as never), false);
  });
});

describe('policy caps', () => {
  test('size and redirect caps are positive, sane bounds', () => {
    assert.ok(MAX_ARTWORK_BYTES > 0 && MAX_ARTWORK_BYTES <= 32 * 1024 * 1024);
    assert.ok(MAX_ARTWORK_REDIRECTS >= 1 && MAX_ARTWORK_REDIRECTS <= 10);
  });
});

describe('artworkCacheKey', () => {
  test('is deterministic and stable for the same inputs', () => {
    assert.equal(artworkCacheKey('stardew-valley', 'header'), artworkCacheKey('stardew-valley', 'header'));
  });

  test('differs across kinds for the same game (cross-kind collision prevention)', () => {
    assert.notEqual(artworkCacheKey('stardew-valley', 'header'), artworkCacheKey('stardew-valley', 'cover'));
  });

  test('differs across games for the same kind (cross-game overwrite prevention)', () => {
    assert.notEqual(artworkCacheKey('game-a', 'header'), artworkCacheKey('game-b', 'header'));
  });

  test('rejects an empty catalogGameId rather than producing a degenerate key', () => {
    assert.throws(() => artworkCacheKey('', 'header'));
    assert.throws(() => artworkCacheKey('###', 'header'));
  });

  test('is filesystem-safe (no path separators or traversal sequences)', () => {
    const key = artworkCacheKey('../../etc/passwd', 'header');
    assert.ok(!key.includes('/'));
    assert.ok(!key.includes('\\'));
    assert.ok(!key.includes('..'));
  });
});
