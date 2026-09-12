import assert from 'node:assert/strict';
import test from 'node:test';
import { toSolithAssetUrl, resolveCatalogCoverUrl, resolveCatalogHeaderUrl } from '../src/core/trainer-catalog/cover-url.js';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.js';

/**
 * Core Product Completion audit, Mission 2 — adversarial and malformed
 * image-URL-scheme tests. Before this fix, any scheme not explicitly
 * recognized as "already browser-safe" fell through to a raw pass-through
 * of the original untrusted string, which would have been set directly as
 * <img src>.
 */

function baseEntry(overrides: Partial<TrainerCatalogEntry> = {}): TrainerCatalogEntry {
  return {
    catalogGameId: 'test-game',
    displayName: 'Test Game',
    executables: [],
    categories: [],
    verificationStatus: 'verified',
    sources: [],
    hasModPack: false,
    cheatCount: 0,
    searchableText: 'test game',
    ...overrides,
  };
}

test('javascript: URL is rejected, not passed through', () => {
  assert.equal(toSolithAssetUrl('javascript:alert(1)'), undefined);
});

test('vbscript: URL is rejected', () => {
  assert.equal(toSolithAssetUrl('vbscript:msgbox(1)'), undefined);
});

test('an unrecognized custom scheme is rejected', () => {
  assert.equal(toSolithAssetUrl('evil-scheme://payload'), undefined);
});

test('plain http: (non-TLS) is rejected — not in the allowlist', () => {
  assert.equal(toSolithAssetUrl('http://example.com/cover.jpg'), undefined);
});

test('data: URLs are rejected — no producer in this codebase ever emits one', () => {
  assert.equal(toSolithAssetUrl('data:image/png;base64,iVBORw0KGgo='), undefined);
});

test('blob: URLs are rejected — no producer in this codebase ever emits one', () => {
  assert.equal(toSolithAssetUrl('blob:https://example.com/uuid'), undefined);
});

test('a malformed/unparseable URL fails closed to undefined, never a raw pass-through', () => {
  assert.equal(toSolithAssetUrl('ht!tp://[not a url'), undefined);
  assert.equal(toSolithAssetUrl('   '), undefined);
});

test('protocol-relative ("//host/...") is rejected — would resolve against whatever scheme hosts the page', () => {
  assert.equal(toSolithAssetUrl('//evil.example.com/cover.jpg'), undefined);
});

test('https: URLs still pass through unchanged (real Steam CDN / remote-synced artwork)', () => {
  assert.equal(toSolithAssetUrl('https://cdn.example.com/cover.jpg'), 'https://cdn.example.com/cover.jpg');
});

test('an already solith-asset:// URL passes through unchanged (not double-wrapped)', () => {
  const url = 'solith-asset://local/C%3A%5Ccovers%5Cavowed.jpg';
  assert.equal(toSolithAssetUrl(url), url);
});

test('a Windows absolute path is still routed through the guarded solith-asset protocol', () => {
  const result = toSolithAssetUrl('C:\\covers\\game.jpg');
  assert.equal(result, 'solith-asset://local/C%3A%5Ccovers%5Cgame.jpg');
});

test('a relative bundled-asset path passes through unchanged', () => {
  assert.equal(toSolithAssetUrl('/assets/fallback.png'), '/assets/fallback.png');
  assert.equal(toSolithAssetUrl('./fallback.png'), './fallback.png');
});

test('resolveCatalogCoverUrl for an entry with a hostile coverUrl scheme resolves to undefined, not the payload', () => {
  const entry = baseEntry({ coverUrl: 'javascript:alert(document.cookie)' });
  assert.equal(resolveCatalogCoverUrl(entry), undefined);
});

test('resolveCatalogHeaderUrl for an entry with a hostile headerUrl scheme resolves to undefined, not the payload', () => {
  const entry = baseEntry({ headerUrl: 'data:text/html,<script>alert(1)</script>' });
  assert.equal(resolveCatalogHeaderUrl(entry), undefined);
});

test('undefined/empty input never throws and resolves to undefined', () => {
  assert.equal(toSolithAssetUrl(undefined), undefined);
  assert.equal(toSolithAssetUrl(''), undefined);
});
