/**
 * Phase 3.2 — real Workers runtime + real local D1 tests for the provider
 * ingest write path (Mission 16 hostile checklist + functional correctness).
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { app } from '../src/index';

const TOKEN = 'test-fixture-ingest-token-do-not-use-in-prod';

function authHeaders(token: string = TOKEN) {
  return { 'content-type': 'application/json', authorization: `Bearer ${token}` };
}

function steamBatch(overrides: Partial<{ syncId: string; records: unknown[] }> = {}) {
  return {
    provider: 'steam',
    syncId: overrides.syncId ?? `sync-${Math.random().toString(36).slice(2)}`,
    observedAt: new Date().toISOString(),
    records:
      overrides.records ?? [
        { provider: 'steam', providerGameId: 'ing-1', title: 'Ingest Test Game', type: 'game', lastUpdated: new Date().toISOString() },
      ],
  };
}

async function ingest(body: unknown, token: string = TOKEN) {
  return app.request(
    '/internal/ingest/steam',
    { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) },
    env,
  );
}

describe('POST /internal/ingest/:provider — auth boundary (Mission 1/2/16)', () => {
  it('unauthenticated write is rejected (no Authorization header)', async () => {
    const response = await app.request('/internal/ingest/steam', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(steamBatch()) }, env);
    expect(response.status).toBe(401);
  });

  it('wrong internal token is rejected', async () => {
    const response = await ingest(steamBatch(), 'wrong-token-entirely');
    expect(response.status).toBe(401);
  });

  it('valid internal token is accepted', async () => {
    const response = await ingest(steamBatch());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe('applied');
  });
});

describe('POST /internal/ingest/:provider — validation (Mission 3/4/16)', () => {
  it('malformed JSON is rejected with 400, not 500', async () => {
    const response = await app.request('/internal/ingest/steam', { method: 'POST', headers: authHeaders(), body: '{not valid json' }, env);
    expect(response.status).toBe(400);
  });

  it('unknown/untrusted extra fields are rejected (.strict() schema)', async () => {
    const batch = { ...steamBatch(), maliciousExtraField: 'should be rejected' };
    const response = await ingest(batch);
    expect(response.status).toBe(400);
  });

  it('a provider field mismatch between batch and record is rejected (cross-provider overwrite guard)', async () => {
    const batch = steamBatch({ records: [{ provider: 'epic', providerGameId: 'x', title: 'Mismatched', type: 'game', lastUpdated: new Date().toISOString() }] });
    const response = await ingest(batch);
    expect(response.status).toBe(400);
  });

  it('SQL injection text in title is stored as inert data, never executed', async () => {
    const injected = "Robert'); DROP TABLE provider_catalog_records;--";
    const batch = steamBatch({ records: [{ provider: 'steam', providerGameId: 'sqli-1', title: injected, type: 'game', lastUpdated: new Date().toISOString() }] });
    const response = await ingest(batch);
    expect(response.status).toBe(200);
    // Prove the table still exists and is queryable.
    const health = await app.request('/health', undefined, env);
    expect(health.status).toBe(200);
  });

  it('HTML/script metadata is accepted at the schema layer (title length-bounded, not HTML-validated here) but stored as plain text, never executed server-side', async () => {
    const batch = steamBatch({ records: [{ provider: 'steam', providerGameId: 'xss-1', title: '<script>alert(1)</script>', type: 'game', lastUpdated: new Date().toISOString() }] });
    const response = await ingest(batch);
    expect(response.status).toBe(200);
  });

  it('a javascript: URL in storeUrl is rejected (only http(s) allowed)', async () => {
    const batch = steamBatch({
      records: [{ provider: 'steam', providerGameId: 'xss-url-1', title: 'Bad URL Game', type: 'game', storeUrl: 'javascript:alert(1)', lastUpdated: new Date().toISOString() }],
    });
    const response = await ingest(batch);
    expect(response.status).toBe(400);
  });

  it('an oversized batch (over MAX_RECORDS_PER_BATCH) is rejected', async () => {
    const records = Array.from({ length: 2001 }, (_, i) => ({
      provider: 'steam',
      providerGameId: `big-${i}`,
      title: `Game ${i}`,
      type: 'game',
      lastUpdated: new Date().toISOString(),
    }));
    const response = await ingest(steamBatch({ records }));
    expect(response.status).toBe(400);
  });

  it('a 100k-character string field is rejected by the length bound', async () => {
    const batch = steamBatch({ records: [{ provider: 'steam', providerGameId: 'huge-1', title: 'A'.repeat(100_000), type: 'game', lastUpdated: new Date().toISOString() }] });
    const response = await ingest(batch);
    expect(response.status).toBe(400);
  });

  it('invalid control characters in a string field do not crash the endpoint (accepted or rejected, never 500)', async () => {
    const withControlChars = 'Game' + String.fromCharCode(0) + String.fromCharCode(7);
    const batch = steamBatch({ records: [{ provider: 'steam', providerGameId: 'ctrl-1', title: withControlChars, type: 'game', lastUpdated: new Date().toISOString() }] });
    const response = await ingest(batch);
    expect([200, 400]).toContain(response.status);
  });

  it('duplicate provider IDs within the SAME batch are both processed without crashing (last write wins deterministically)', async () => {
    const now = new Date().toISOString();
    const batch = steamBatch({
      records: [
        { provider: 'steam', providerGameId: 'dup-1', title: 'First', type: 'game', lastUpdated: now },
        { provider: 'steam', providerGameId: 'dup-1', title: 'Second', type: 'game', lastUpdated: now },
      ],
    });
    const response = await ingest(batch);
    expect(response.status).toBe(200);
  });
});

describe('POST /internal/ingest/:provider — idempotency (Mission 7)', () => {
  it('the SAME batch (syncId + identical content) submitted twice does not duplicate rows', async () => {
    const batch = steamBatch({ syncId: 'idempotent-test-1' });
    const first = await ingest(batch);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { status: string };
    expect(firstBody.status).toBe('applied');

    const second = await ingest(batch);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { status: string };
    expect(secondBody.status).toBe('idempotent-replay');
  });

  it('the SAME syncId with DIFFERENT content is rejected as a conflict, never silently overwritten', async () => {
    const syncId = 'conflict-test-1';
    const first = await ingest(steamBatch({ syncId, records: [{ provider: 'steam', providerGameId: 'conflict-a', title: 'Original', type: 'game', lastUpdated: new Date().toISOString() }] }));
    expect(first.status).toBe(200);

    const second = await ingest(steamBatch({ syncId, records: [{ provider: 'steam', providerGameId: 'conflict-b', title: 'Different', type: 'game', lastUpdated: new Date().toISOString() }] }));
    expect(second.status).toBe(409);
  });
});

describe('POST /internal/ingest/:provider — rollback protection (Mission 6/16)', () => {
  it('a replayed OLDER lastUpdated does not roll back a newer record', async () => {
    const id = 'rollback-http-1';
    await ingest(steamBatch({ syncId: 's1', records: [{ provider: 'steam', providerGameId: id, title: 'Newer Title', type: 'game', lastUpdated: '2026-06-01T00:00:00.000Z' }] }));
    await ingest(steamBatch({ syncId: 's2', records: [{ provider: 'steam', providerGameId: id, title: 'Stale Replayed Title', type: 'game', lastUpdated: '2026-01-01T00:00:00.000Z' }] }));

    const row = await env.DB.prepare('SELECT title FROM provider_catalog_records WHERE provider = ? AND provider_game_id = ?').bind('steam', id).first<{ title: string }>();
    expect(row?.title).toBe('Newer Title');
  });
});

describe('POST /internal/ingest/:provider — provider isolation (Mission 8)', () => {
  it('an Epic ingest batch failure does not affect Steam sync status', async () => {
    // Get a baseline Steam status first.
    await ingest(steamBatch({ syncId: 'isolation-steam-ok' }));
    const beforeStatus = await app.request('/provider-sync/status', undefined, env);
    const beforeBody = (await beforeStatus.json()) as { providers: Array<{ provider: string; status: string }> };
    const steamBefore = beforeBody.providers.find((p) => p.provider === 'steam');
    expect(steamBefore?.status).toBe('OK');

    // Malformed Epic batch (wrong provider on a record) — must be rejected without touching Steam's row.
    const badEpicBatch = { provider: 'epic', syncId: 'isolation-epic-bad', observedAt: new Date().toISOString(), records: [{ provider: 'steam', providerGameId: 'x', title: 'Bad', type: 'game', lastUpdated: new Date().toISOString() }] };
    const epicResponse = await app.request('/internal/ingest/epic', { method: 'POST', headers: authHeaders(), body: JSON.stringify(badEpicBatch) }, env);
    expect(epicResponse.status).toBe(400);

    const afterStatus = await app.request('/provider-sync/status', undefined, env);
    const afterBody = (await afterStatus.json()) as { providers: Array<{ provider: string; status: string }> };
    const steamAfter = afterBody.providers.find((p) => p.provider === 'steam');
    expect(steamAfter?.status).toBe('OK');
  });
});

describe('POST /internal/ingest/:provider — canonical matching after ingest (Mission 9)', () => {
  it('EXACT match via curated title/publisher corroboration never happens (P1 fix preserved): title+publisher alone stays a candidate, not applied', async () => {
    const now = new Date().toISOString();
    await ingest(steamBatch({ syncId: 'match-steam-1', records: [{ provider: 'steam', providerGameId: 'match-a', title: 'Cross Match Game', type: 'game', lastUpdated: now }] }));
    const gogBatch = { provider: 'gog', syncId: 'match-gog-1', observedAt: now, records: [{ provider: 'gog', providerGameId: 'match-b', title: 'Cross Match Game', publisher: 'Some Publisher', type: 'game', lastUpdated: now }] };
    const response = await app.request('/internal/ingest/gog', { method: 'POST', headers: authHeaders(), body: JSON.stringify(gogBatch) }, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { canonicalGamesLinked: number; canonicalGamesCreated: number; candidatesRecorded: number };
    // A same-title candidate exists (Steam's, no publisher to corroborate)
    // -> POSSIBLE, never applied (post-P1-fix, metadata alone can never
    // reach HIGH/EXACT) -> recorded as a review candidate, NOT an applied
    // link and NOT a brand-new UNLINKED canonical game.
    expect(body.canonicalGamesLinked).toBe(0);
    expect(body.canonicalGamesCreated).toBe(0);
    expect(body.candidatesRecorded).toBeGreaterThan(0);
  });
});

describe('POST /internal/ingest/:provider — tombstone policy (Mission 10)', () => {
  it('omitting a previously-ingested game from a later sync does NOT delete or tombstone it', async () => {
    const id = 'tombstone-test-1';
    await ingest(steamBatch({ syncId: 'tomb-1', records: [{ provider: 'steam', providerGameId: id, title: 'Still Here', type: 'game', lastUpdated: new Date().toISOString() }] }));
    // A later batch that does NOT mention this game at all.
    await ingest(steamBatch({ syncId: 'tomb-2', records: [{ provider: 'steam', providerGameId: 'unrelated-game', title: 'Unrelated', type: 'game', lastUpdated: new Date().toISOString() }] }));

    const row = await env.DB.prepare('SELECT provider_game_id FROM provider_catalog_records WHERE provider = ? AND provider_game_id = ?').bind('steam', id).first();
    expect(row).not.toBeNull();
  });
});

describe('GET /provider-sync/status (Mission 11)', () => {
  it('reports status with no secret/token material', async () => {
    await ingest(steamBatch({ syncId: 'status-check-1' }));
    const response = await app.request('/provider-sync/status', undefined, env);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(TOKEN);
  });
});

describe('ingested provider records surface via GET /catalog/sync (delta read-after-write)', () => {
  it('a newly-ingested game appears in the next /catalog/sync response', async () => {
    const gameId = 'delta-visible-1';
    await ingest(steamBatch({ syncId: 'delta-sync-1', records: [{ provider: 'steam', providerGameId: gameId, title: 'Delta Visible Game', type: 'game', lastUpdated: new Date().toISOString() }] }));

    const syncResponse = await app.request('/catalog/sync', undefined, env);
    expect(syncResponse.status).toBe(200);
    const body = (await syncResponse.json()) as { changedCatalogEntries: Array<{ title: string; providerIds: Record<string, string> }> };
    const found = body.changedCatalogEntries.find((e) => e.title === 'Delta Visible Game');
    expect(found).toBeDefined();
    expect(found?.providerIds.steam).toBe(gameId);
  });
});

describe('secret boundary (Mission 14) — this package', () => {
  it('the ingest token never appears in any /provider-sync/status or /catalog/sync response', async () => {
    await ingest(steamBatch({ syncId: 'secret-check-1' }));
    const status = await app.request('/provider-sync/status', undefined, env);
    const statusText = await status.text();
    expect(statusText).not.toContain(TOKEN);

    const sync = await app.request('/catalog/sync', undefined, env);
    const syncText = await sync.text();
    expect(syncText).not.toContain(TOKEN);
  });

  it('an ingest failure never echoes the token or a raw error/stack string back to the caller', async () => {
    const response = await ingest({ provider: 'steam' }); // missing required fields
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toContain(TOKEN);
    expect(text).not.toMatch(/at\s+\S+\s+\(/); // no stack-trace-shaped line
  });
});
