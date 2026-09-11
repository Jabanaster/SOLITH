/**
 * ROADMAP §online-foundation Mission 10 — sync manifest client tests.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchSyncManifest, type SyncManifestFetchImpl } from '../src/core/sync-manifest/client.ts';
import type { SyncManifestDelta } from '../src/core/sync-manifest/types.ts';

function jsonFetch(status: number, body: unknown): SyncManifestFetchImpl {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  });
}

const sampleEntry = {
  solithGameId: 'game-a',
  title: 'Game A',
  normalizedTitle: 'game a',
  aliases: [],
  providerIds: {},
  type: 'game',
  genres: [],
  tags: [],
  trainerAvailable: false,
  ctAvailable: false,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const sampleDelta: SyncManifestDelta = {
  catalogRevision: '1',
  trainerRevision: '1',
  changedCatalogEntries: [sampleEntry],
  changedTrainerCoverage: [],
  deletedSolithGameIds: [],
};

describe('fetchSyncManifest', () => {
  test('returns the parsed delta on a successful response', async () => {
    const result = await fetchSyncManifest({
      service: 'discovery-catalog',
      endpointUrl: 'https://mock.invalid/sync',
      fetchImpl: jsonFetch(200, sampleDelta),
    });

    assert.ok(!('error' in result));
    assert.equal((result as SyncManifestDelta).catalogRevision, '1');
    assert.equal((result as SyncManifestDelta).changedCatalogEntries.length, 1);
  });

  test('never throws on a non-2xx HTTP status — returns a typed error result', async () => {
    const result = await fetchSyncManifest({
      service: 'discovery-catalog',
      endpointUrl: 'https://mock.invalid/sync',
      fetchImpl: jsonFetch(500, { error: 'boom' }),
    });

    assert.ok('error' in result);
  });

  test('never throws when fetchImpl itself rejects (offline/network failure) — returns a typed error result', async () => {
    const fetchImpl: SyncManifestFetchImpl = async () => {
      throw new Error('simulated offline');
    };

    const result = await fetchSyncManifest({
      service: 'discovery-catalog',
      endpointUrl: 'https://mock.invalid/sync',
      fetchImpl,
    });

    assert.ok('error' in result);
    assert.match((result as { error: string }).error, /simulated offline/);
  });

  test('never throws on malformed JSON — returns a typed error result', async () => {
    const fetchImpl: SyncManifestFetchImpl = async () => ({
      ok: true,
      status: 200,
      async text() {
        return '{not valid json';
      },
    });

    const result = await fetchSyncManifest({
      service: 'discovery-catalog',
      endpointUrl: 'https://mock.invalid/sync',
      fetchImpl,
    });

    assert.ok('error' in result);
  });

  test('never throws when the response JSON does not match the delta shape', async () => {
    const result = await fetchSyncManifest({
      service: 'discovery-catalog',
      endpointUrl: 'https://mock.invalid/sync',
      fetchImpl: jsonFetch(200, { unexpected: true }),
    });

    assert.ok('error' in result);
  });

  test('forwards service and sinceRevision as query parameters', async () => {
    let capturedUrl = '';
    const fetchImpl: SyncManifestFetchImpl = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify(sampleDelta);
        },
      };
    };

    await fetchSyncManifest({
      service: 'discovery-catalog',
      endpointUrl: 'https://mock.invalid/sync',
      sinceRevision: '42',
      fetchImpl,
    });

    const parsed = new URL(capturedUrl);
    assert.equal(parsed.searchParams.get('service'), 'discovery-catalog');
    assert.equal(parsed.searchParams.get('since'), '42');
  });
});
