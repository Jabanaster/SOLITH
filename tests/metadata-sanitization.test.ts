/**
 * SOLITH Phase 3.1, Mission 8 — closes the disclosed P3: developer/
 * publisher/genres/tags previously skipped the HTML-sanitization title
 * gets. Hostile payload proof for sanitizeDisplayMetadata(List) directly,
 * plus proof the GOG/Epic adapters actually route their fields through it.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeDisplayMetadata, sanitizeDisplayMetadataList } from '../src/core/trainer-catalog/normalize-title.ts';
import { epicSyncPage } from '../src/core/provider-catalog/epic-adapter.ts';
import { gogSyncPage } from '../src/core/provider-catalog/gog-adapter.ts';
import type { AdapterFetchImpl, AdapterFetchResponse } from '../src/core/provider-catalog/adapter.ts';

function jsonResponse(body: unknown): AdapterFetchResponse {
  return { ok: true, status: 200, async json() { return body; }, async text() { return JSON.stringify(body); } };
}

describe('sanitizeDisplayMetadata — hostile payloads (Mission 8)', () => {
  test('strips <script> tags, keeps inner text', () => {
    const result = sanitizeDisplayMetadata('<script>alert(document.cookie)</script>Real Studio');
    assert.ok(result);
    assert.doesNotMatch(result!, /<script>/);
    assert.match(result!, /Real Studio/);
  });

  test('strips <img onerror=...> entirely (no attribute soup survives)', () => {
    const result = sanitizeDisplayMetadata('<img src=x onerror="alert(1)">Studio Name');
    assert.ok(result);
    assert.doesNotMatch(result!, /onerror/);
    assert.doesNotMatch(result!, /<img/);
  });

  test('strips inline SVG payloads', () => {
    const result = sanitizeDisplayMetadata('<svg onload="alert(1)"><circle/></svg>Studio');
    assert.ok(result);
    assert.doesNotMatch(result!, /onload/);
    assert.doesNotMatch(result!, /<svg/);
  });

  test('a value that is PURE attribute soup after tag-stripping is rejected outright', () => {
    const result = sanitizeDisplayMetadata('href="javascript:alert(1)"');
    assert.equal(result, null);
  });

  test('HTML entity tricks decode safely without re-introducing markup', () => {
    // &lt;script&gt; decodes to the TEXT "<script>" (not live markup) — this
    // is correct: entities are for display text, not a smuggling vector,
    // since the decoded string is stored as a plain field value, never
    // re-parsed as HTML by SOLITH.
    const result = sanitizeDisplayMetadata('Studio &amp; Co &lt;official&gt;');
    assert.equal(result, 'Studio & Co <official>');
  });

  test('numeric and hex HTML entities decode correctly', () => {
    const result = sanitizeDisplayMetadata('Caf&#233; Studio');
    assert.equal(result, 'Café Studio');
  });

  test('very long strings are bounded, never stored unbounded', () => {
    const huge = 'A'.repeat(10000);
    const result = sanitizeDisplayMetadata(huge);
    assert.ok(result);
    assert.ok(result!.length <= 200);
  });

  test('control characters are stripped without touching legitimate Unicode', () => {
    const withControlChars = 'Studio' + String.fromCharCode(0) + String.fromCharCode(7) + String.fromCharCode(27) + 'Name';
    const result = sanitizeDisplayMetadata(withControlChars);
    assert.equal(result, 'StudioName');
  });

  test('legitimate Unicode (accents, CJK, emoji-adjacent symbols) is preserved', () => {
    const result = sanitizeDisplayMetadata('株式会社スタジオ');
    assert.equal(result, '株式会社スタジオ');
  });

  test('a short legitimate value (unlike normalizeCatalogTitle) is NOT rejected for being short', () => {
    // e.g. a real 2-letter studio initialism or a short genre like "RPG"
    assert.equal(sanitizeDisplayMetadata('RPG'), 'RPG');
    assert.equal(sanitizeDisplayMetadata('EA'), 'EA');
  });

  test('empty/whitespace-only/non-string input returns null, never a fabricated fallback', () => {
    assert.equal(sanitizeDisplayMetadata(''), null);
    assert.equal(sanitizeDisplayMetadata('   '), null);
    assert.equal(sanitizeDisplayMetadata(null), null);
    assert.equal(sanitizeDisplayMetadata(undefined), null);
  });

  test('sanitizeDisplayMetadataList drops non-string and empty-after-sanitize entries, keeps valid ones', () => {
    // Tag-stripping preserves inner TEXT content (matching normalizeCatalogTitle's
    // behavior) — only the markup itself is removed, so "<script>x</script>" keeps its "x".
    const result = sanitizeDisplayMetadataList(['RPG', '<script></script>', 123, null, '  ', 'Action']);
    assert.deepEqual(result, ['RPG', 'Action']);
  });

  test('sanitizeDisplayMetadataList returns [] for non-array input', () => {
    assert.deepEqual(sanitizeDisplayMetadataList('not-an-array'), []);
    assert.deepEqual(sanitizeDisplayMetadataList(null), []);
  });
});

describe('adapters actually route developer/publisher/genres through sanitization', () => {
  test('Epic adapter sanitizes developerDisplayName/publisherDisplayName', async () => {
    const fetchImpl: AdapterFetchImpl = async () =>
      jsonResponse({
        data: {
          Catalog: {
            searchStore: {
              paging: { count: 1, total: 1 },
              elements: [
                {
                  id: '1',
                  title: 'Hostile Metadata Game',
                  developerDisplayName: '<script>alert(1)</script>Evil Dev',
                  publisherDisplayName: '<img onerror=alert(1)>Evil Pub',
                },
              ],
            },
          },
        },
      });
    const result = await epicSyncPage({ fetchImpl, getKnownRevision: () => null });
    assert.equal(result.records.length, 1);
    assert.doesNotMatch(result.records[0].developer ?? '', /<script>/);
    assert.doesNotMatch(result.records[0].publisher ?? '', /onerror/);
    assert.match(result.records[0].developer ?? '', /Evil Dev/);
  });

  test('GOG adapter sanitizes developer/publisher/genres', async () => {
    const fetchImpl: AdapterFetchImpl = async () =>
      jsonResponse({
        products: [
          {
            id: 1,
            title: 'Hostile Metadata Game',
            category: 'game',
            developer: '<svg onload=alert(1)></svg>Evil Dev',
            publisher: 'Normal Publisher',
            genres: ['<script></script>RPG', 'Action'],
          },
        ],
        totalPages: 1,
      });
    const result = await gogSyncPage({ fetchImpl, getKnownRevision: () => null });
    assert.equal(result.records.length, 1);
    assert.doesNotMatch(result.records[0].developer ?? '', /<svg/);
    assert.deepEqual(result.records[0].genres, ['RPG', 'Action']);
  });
});
