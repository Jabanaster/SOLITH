import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { epicSyncPage, EPIC_CATALOG_GRAPHQL_ENDPOINT } from '../src/core/provider-catalog/epic-adapter.ts';
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

describe('Epic catalog adapter', () => {
  test('normalizes a real-shaped GraphQL response', async () => {
    let requestedUrl = '';
    const fetchImpl: AdapterFetchImpl = async (url) => {
      requestedUrl = url;
      return jsonResponse({
        data: {
          Catalog: {
            searchStore: {
              paging: { count: 1, total: 1 },
              elements: [
                {
                  id: 'abc123',
                  namespace: 'epic-exclusive-ns',
                  title: 'Epic Exclusive Game',
                  effectiveDate: '2024-03-15T00:00:00.000Z',
                  developerDisplayName: 'Some Dev',
                  publisherDisplayName: 'Some Publisher',
                  categories: [{ path: 'games' }],
                  urlSlug: 'epic-exclusive-game',
                },
              ],
            },
          },
        },
      });
    };
    const result = await epicSyncPage({ fetchImpl, getKnownRevision: noKnownRevisions });
    assert.equal(result.status, 'ok');
    assert.equal(result.records.length, 1);
    const record = result.records[0];
    assert.equal(record.provider, 'epic');
    assert.equal(record.providerGameId, 'abc123');
    assert.equal(record.title, 'Epic Exclusive Game');
    assert.equal(record.developer, 'Some Dev');
    assert.equal(record.storeUrl, 'https://store.epicgames.com/p/epic-exclusive-game');
    assert.ok(record.rawRevision);
    assert.equal(result.complete, true);
    assert.equal(requestedUrl, EPIC_CATALOG_GRAPHQL_ENDPOINT);
  });

  test('excludes non-game categories (DLC/soundtrack) — Mission 7', async () => {
    const fetchImpl: AdapterFetchImpl = async () =>
      jsonResponse({
        data: {
          Catalog: {
            searchStore: {
              paging: { count: 2, total: 2 },
              elements: [
                { id: '1', title: 'Real Game', categories: [{ path: 'games' }] },
                { id: '2', title: 'Some DLC Pack', categories: [{ path: 'addons/dlc' }] },
              ],
            },
          },
        },
      });
    const result = await epicSyncPage({ fetchImpl, getKnownRevision: noKnownRevisions });
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].providerGameId, '1');
  });

  test('paginates via start/count offset cursor', async () => {
    const fetchImpl: AdapterFetchImpl = async () =>
      jsonResponse({
        data: { Catalog: { searchStore: { paging: { count: 1, total: 5 }, elements: [{ id: '1', title: 'Game 1' }] } } },
      });
    const result = await epicSyncPage({ fetchImpl, getKnownRevision: noKnownRevisions, cursor: '3' });
    assert.equal(result.complete, false);
    assert.equal(result.nextCursor, '4');
  });

  test('content-hash-based change detection skips unchanged records (Mission 8 fallback)', async () => {
    const elementBody = { id: '1', title: 'Stable Game', developerDisplayName: 'Dev' };
    const fetchImpl: AdapterFetchImpl = async () =>
      jsonResponse({ data: { Catalog: { searchStore: { paging: { count: 1, total: 1 }, elements: [elementBody] } } } });

    const first = await epicSyncPage({ fetchImpl, getKnownRevision: noKnownRevisions });
    assert.equal(first.records.length, 1);
    const knownHash = first.records[0].rawRevision!;

    const second = await epicSyncPage({ fetchImpl, getKnownRevision: () => knownHash });
    assert.equal(second.records.length, 0);
    assert.equal(second.skippedUnchangedCount, 1);
  });

  test('fails closed on GraphQL errors field', async () => {
    const fetchImpl: AdapterFetchImpl = async () => jsonResponse({ errors: [{ message: 'bad query' }] });
    const result = await epicSyncPage({ fetchImpl, getKnownRevision: noKnownRevisions });
    assert.equal(result.status, 'error');
  });

  test('fails closed on missing elements array', async () => {
    const fetchImpl: AdapterFetchImpl = async () => jsonResponse({ data: { Catalog: { searchStore: {} } } });
    const result = await epicSyncPage({ fetchImpl, getKnownRevision: noKnownRevisions });
    assert.equal(result.status, 'error');
    assert.match(result.error ?? '', /missing data\.Catalog/);
  });

  test('a malformed entry (no id, no title) is dropped, not fatal', async () => {
    const fetchImpl: AdapterFetchImpl = async () =>
      jsonResponse({
        data: {
          Catalog: {
            searchStore: {
              paging: { count: 2, total: 2 },
              elements: [{ title: 'No ID Game' }, { id: '2', title: 'Valid Game' }],
            },
          },
        },
      });
    const result = await epicSyncPage({ fetchImpl, getKnownRevision: noKnownRevisions });
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].providerGameId, '2');
  });

  test('rejects HTML/script content in the title (shared normalizeCatalogTitle sanitization)', async () => {
    const fetchImpl: AdapterFetchImpl = async () =>
      jsonResponse({
        data: {
          Catalog: {
            searchStore: {
              paging: { count: 1, total: 1 },
              elements: [{ id: '1', title: '<script>alert(1)</script>' }],
            },
          },
        },
      });
    const result = await epicSyncPage({ fetchImpl, getKnownRevision: noKnownRevisions });
    assert.equal(result.records.length, 1);
    assert.doesNotMatch(result.records[0].title, /<script>/);
  });
});
