import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { gogSyncPage, GOG_CATALOG_ENDPOINT } from '../src/core/provider-catalog/gog-adapter.ts';
import type { AdapterFetchImpl, AdapterFetchResponse } from '../src/core/provider-catalog/adapter.ts';

function jsonResponse(body: unknown, status = 200): AdapterFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

const noKnownRevisions = () => null;

describe('GOG catalog adapter', () => {
  test('normalizes a real-shaped filtered-catalog response', async () => {
    let requestedUrl = '';
    const fetchImpl: AdapterFetchImpl = async (url) => {
      requestedUrl = url;
      return jsonResponse({
        products: [
          {
            id: 1423049311,
            title: 'GOG Exclusive Classic',
            url: '/game/gog_exclusive_classic',
            releaseDate: '1998-11-19',
            developer: 'Some Dev',
            publisher: 'Some Publisher',
            genres: ['RPG'],
            category: 'game',
          },
        ],
        totalPages: 1,
        page: 1,
      });
    };
    const result = await gogSyncPage({ fetchImpl, getKnownRevision: noKnownRevisions });
    assert.equal(result.status, 'ok');
    assert.equal(result.records.length, 1);
    const record = result.records[0];
    assert.equal(record.provider, 'gog');
    assert.equal(record.providerGameId, '1423049311');
    assert.equal(record.storeUrl, 'https://www.gog.com/game/gog_exclusive_classic');
    assert.deepEqual(record.genres, ['RPG']);
    assert.equal(result.complete, true);
    assert.ok(requestedUrl.startsWith(GOG_CATALOG_ENDPOINT));
  });

  test('excludes DLC/bonus/pack products from base-game results (Mission 10)', async () => {
    const fetchImpl: AdapterFetchImpl = async () =>
      jsonResponse({
        products: [
          { id: 1, title: 'Base Game', category: 'game' },
          { id: 2, title: 'Some DLC', category: 'dlc' },
          { id: 3, title: 'Soundtrack Pack Bundle', category: 'pack' },
        ],
        totalPages: 1,
      });
    const result = await gogSyncPage({ fetchImpl, getKnownRevision: noKnownRevisions });
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].providerGameId, '1');
  });

  test('paginates via page cursor', async () => {
    const fetchImpl: AdapterFetchImpl = async () => jsonResponse({ products: [{ id: 1, title: 'A', category: 'game' }], totalPages: 3 });
    const result = await gogSyncPage({ fetchImpl, getKnownRevision: noKnownRevisions, cursor: '1' });
    assert.equal(result.complete, false);
    assert.equal(result.nextCursor, '2');
  });

  test('completes on the final page', async () => {
    const fetchImpl: AdapterFetchImpl = async () => jsonResponse({ products: [{ id: 1, title: 'A', category: 'game' }], totalPages: 2 });
    const result = await gogSyncPage({ fetchImpl, getKnownRevision: noKnownRevisions, cursor: '2' });
    assert.equal(result.complete, true);
    assert.equal(result.nextCursor, undefined);
  });

  test('content-hash change detection skips unchanged rows', async () => {
    const product = { id: 1, title: 'Stable', category: 'game', developer: 'D' };
    const fetchImpl: AdapterFetchImpl = async () => jsonResponse({ products: [product], totalPages: 1 });
    const first = await gogSyncPage({ fetchImpl, getKnownRevision: noKnownRevisions });
    const knownHash = first.records[0].rawRevision!;
    const second = await gogSyncPage({ fetchImpl, getKnownRevision: () => knownHash });
    assert.equal(second.records.length, 0);
    assert.equal(second.skippedUnchangedCount, 1);
  });

  test('fails closed on missing products array', async () => {
    const result = await gogSyncPage({ fetchImpl: async () => jsonResponse({}), getKnownRevision: noKnownRevisions });
    assert.equal(result.status, 'error');
    assert.match(result.error ?? '', /missing products/);
  });

  test('a malformed product (no id) is dropped, not fatal', async () => {
    const fetchImpl: AdapterFetchImpl = async () =>
      jsonResponse({ products: [{ title: 'No ID' }, { id: 2, title: 'Valid', category: 'game' }], totalPages: 1 });
    const result = await gogSyncPage({ fetchImpl, getKnownRevision: noKnownRevisions });
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].providerGameId, '2');
  });

  test('SECURITY: a malicious absolute URL in the url field can never escape the gog.com domain (storeUrl phishing fix)', async () => {
    const fetchImpl: AdapterFetchImpl = async () =>
      jsonResponse({ products: [{ id: 1, title: 'Malicious Entry', category: 'game', url: 'http://phish.example.com/steal-credentials' }], totalPages: 1 });
    const result = await gogSyncPage({ fetchImpl, getKnownRevision: noKnownRevisions });
    assert.equal(result.records.length, 1);
    // The security property that matters: the URL's ORIGIN is always
    // gog.com — a browser/shell.openExternal navigating this can never land
    // on the attacker's domain, even though the raw text is preserved
    // (harmlessly) as a path segment.
    assert.equal(new URL(result.records[0].storeUrl!).hostname, 'www.gog.com');
  });

  test('fails closed on non-200 response', async () => {
    const result = await gogSyncPage({ fetchImpl: async () => jsonResponse({}, 500), getKnownRevision: noKnownRevisions });
    assert.equal(result.status, 'error');
    assert.match(result.error ?? '', /HTTP 500/);
  });
});
