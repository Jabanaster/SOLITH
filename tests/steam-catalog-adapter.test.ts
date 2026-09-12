import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { steamSyncPage, STEAM_STORE_SERVICE_BASE } from '../src/core/provider-catalog/steam-adapter.ts';
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

function fetchImplReturning(body: unknown, status = 200): AdapterFetchImpl {
  return async () => jsonResponse(body, status);
}

const noKnownRevisions = () => null;

describe('Steam catalog adapter', () => {
  test('normalizes a real-shaped response and requires an API key', async () => {
    const result = await steamSyncPage({
      apiKey: '',
      fetchImpl: fetchImplReturning({ response: { apps: [] } }),
      getKnownRevision: noKnownRevisions,
    });
    assert.equal(result.status, 'error');
    assert.match(result.error ?? '', /API key/);
  });

  test('normalizes apps, filters malformed entries, tracks pagination cursor', async () => {
    let requestedUrl = '';
    const fetchImpl: AdapterFetchImpl = async (url) => {
      requestedUrl = url;
      return jsonResponse({
        response: {
          apps: [
            { appid: 570, name: 'Dota 2', last_modified: 1700000000 },
            { appid: -5, name: 'Bad ID' }, // invalid appid, must be dropped
            { appid: 730, name: '' }, // empty title, must be dropped
            { appid: 'not-a-number', name: 'Also Bad' }, // wrong type, must be dropped
          ],
          have_more_results: true,
          last_appid: 730,
        },
      });
    };
    const result = await steamSyncPage({ apiKey: 'test-key', fetchImpl, getKnownRevision: noKnownRevisions });
    assert.equal(result.status, 'ok');
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].providerGameId, '570');
    assert.equal(result.records[0].provider, 'steam');
    assert.equal(result.records[0].type, 'game');
    assert.equal(result.complete, false);
    assert.equal(result.nextCursor, '730');
    assert.ok(requestedUrl.startsWith(STEAM_STORE_SERVICE_BASE));
    assert.match(requestedUrl, /include_games=true/);
    assert.match(requestedUrl, /include_dlc=false/);
  });

  test('defaults exclude DLC/software/videos/hardware (Mission 4)', async () => {
    let requestedUrl = '';
    const fetchImpl: AdapterFetchImpl = async (url) => {
      requestedUrl = url;
      return jsonResponse({ response: { apps: [] } });
    };
    await steamSyncPage({ apiKey: 'k', fetchImpl, getKnownRevision: noKnownRevisions });
    assert.match(requestedUrl, /include_dlc=false/);
    assert.match(requestedUrl, /include_software=false/);
    assert.match(requestedUrl, /include_videos=false/);
    assert.match(requestedUrl, /include_hardware=false/);
  });

  test('completes when have_more_results is false', async () => {
    const result = await steamSyncPage({
      apiKey: 'k',
      fetchImpl: fetchImplReturning({ response: { apps: [{ appid: 1, name: 'A' }], have_more_results: false } }),
      getKnownRevision: noKnownRevisions,
    });
    assert.equal(result.complete, true);
    assert.equal(result.nextCursor, undefined);
  });

  test('skips unchanged rows via rawRevision (Mission 5: no-change sync)', async () => {
    const result = await steamSyncPage({
      apiKey: 'k',
      fetchImpl: fetchImplReturning({ response: { apps: [{ appid: 1, name: 'Game A', last_modified: 100 }] } }),
      getKnownRevision: () => '100',
    });
    assert.equal(result.records.length, 0);
    assert.equal(result.skippedUnchangedCount, 1);
    assert.equal(result.fetchedCount, 1);
  });

  test('a renamed app produces a real changed record (different title, same appid)', async () => {
    const result = await steamSyncPage({
      apiKey: 'k',
      fetchImpl: fetchImplReturning({ response: { apps: [{ appid: 1, name: 'New Title', last_modified: 200 }] } }),
      getKnownRevision: () => '100',
    });
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].title, 'New Title');
  });

  test('fails closed on malformed JSON body', async () => {
    const fetchImpl: AdapterFetchImpl = async () => ({
      ok: true,
      status: 200,
      async json() {
        throw new Error('unused');
      },
      async text() {
        return '{not valid json';
      },
    });
    const result = await steamSyncPage({ apiKey: 'k', fetchImpl, getKnownRevision: noKnownRevisions });
    assert.equal(result.status, 'error');
    assert.match(result.error ?? '', /not valid JSON/);
  });

  test('fails closed on missing response.apps array', async () => {
    const result = await steamSyncPage({ apiKey: 'k', fetchImpl: fetchImplReturning({ response: {} }), getKnownRevision: noKnownRevisions });
    assert.equal(result.status, 'error');
    assert.match(result.error ?? '', /missing response\.apps/);
  });

  test('fails closed on a non-200 upstream response', async () => {
    const result = await steamSyncPage({ apiKey: 'k', fetchImpl: fetchImplReturning({}, 503), getKnownRevision: noKnownRevisions });
    assert.equal(result.status, 'error');
    assert.match(result.error ?? '', /HTTP 503/);
  });

  test('fails closed on an oversized response body (huge payload guard)', async () => {
    const fetchImpl: AdapterFetchImpl = async () => ({
      ok: true,
      status: 200,
      async json() {
        return {};
      },
      async text() {
        return 'x'.repeat(65 * 1024 * 1024);
      },
    });
    const result = await steamSyncPage({ apiKey: 'k', fetchImpl, getKnownRevision: noKnownRevisions });
    assert.equal(result.status, 'error');
    assert.match(result.error ?? '', /byte cap/);
  });

  test('a network error from fetchImpl is returned typed, never thrown', async () => {
    const fetchImpl: AdapterFetchImpl = async () => {
      throw new Error('simulated DNS failure');
    };
    const result = await steamSyncPage({ apiKey: 'k', fetchImpl, getKnownRevision: noKnownRevisions });
    assert.equal(result.status, 'error');
    assert.match(result.error ?? '', /network error/);
  });

  test('the API key never appears in the returned error string', async () => {
    const fetchImpl: AdapterFetchImpl = async () => {
      throw new Error('simulated failure');
    };
    const result = await steamSyncPage({ apiKey: 'super-secret-key-12345', fetchImpl, getKnownRevision: noKnownRevisions });
    assert.doesNotMatch(JSON.stringify(result), /super-secret-key-12345/);
  });
});
