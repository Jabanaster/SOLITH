/**
 * Phase 3.2 Owner Follow-up Mission 1 — tombstone STATE ENGINE hostile tests.
 *
 * Real workerd + real local D1 (same as test/ingest.test.ts) for the E2E
 * scenarios; plain unit tests for the pure decision functions.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { computeCanonicalLifecycleStatus, nextLifecycleStatusOnCycleClose } from '../src/tombstone-lifecycle';

const TOKEN = 'test-fixture-ingest-token-do-not-use-in-prod';

function authHeaders() {
  return { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` };
}

async function ingest(body: unknown) {
  return app.request('/internal/ingest/steam', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }, env);
}

async function ingestProvider(provider: string, body: unknown) {
  return app.request(`/internal/ingest/${provider}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }, env);
}

function batch(overrides: {
  provider?: string;
  syncId: string;
  records: unknown[];
  syncCycleId?: string;
  cycleComplete?: boolean;
}) {
  return {
    provider: overrides.provider ?? 'steam',
    syncId: overrides.syncId,
    observedAt: new Date().toISOString(),
    records: overrides.records,
    ...(overrides.syncCycleId ? { syncCycleId: overrides.syncCycleId } : {}),
    ...(overrides.cycleComplete !== undefined ? { cycleComplete: overrides.cycleComplete } : {}),
  };
}

function record(providerGameId: string, title: string, extra: Record<string, unknown> = {}) {
  return { provider: 'steam', providerGameId, title, type: 'game', lastUpdated: new Date().toISOString(), ...extra };
}

async function providerLifecycle(provider: string, providerGameId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT lifecycle_status FROM provider_catalog_records WHERE provider = ? AND provider_game_id = ?')
    .bind(provider, providerGameId)
    .first<{ lifecycle_status: string }>();
  return row?.lifecycle_status ?? null;
}

async function discoveryLifecycleByProviderGame(provider: string, providerGameId: string): Promise<string | null> {
  const link = await env.DB.prepare('SELECT canonical_game_id FROM canonical_provider_links WHERE provider = ? AND provider_game_id = ?')
    .bind(provider, providerGameId)
    .first<{ canonical_game_id: string }>();
  if (!link) return null;
  const row = await env.DB.prepare('SELECT lifecycle_status FROM discovery_catalog_entries WHERE solith_game_id = ?').bind(link.canonical_game_id).first<{ lifecycle_status: string }>();
  return row?.lifecycle_status ?? null;
}

describe('computeCanonicalLifecycleStatus (pure)', () => {
  it('ANY active provider wins, regardless of how many are stale/tombstoned', () => {
    expect(computeCanonicalLifecycleStatus(['TOMBSTONED', 'STALE', 'ACTIVE'])).toBe('ACTIVE');
  });
  it('all tombstoned -> tombstoned', () => {
    expect(computeCanonicalLifecycleStatus(['TOMBSTONED', 'TOMBSTONED'])).toBe('TOMBSTONED');
  });
  it('mix of stale and tombstoned, no active -> stale (not tombstoned)', () => {
    expect(computeCanonicalLifecycleStatus(['TOMBSTONED', 'STALE'])).toBe('STALE');
  });
  it('single-provider (launcher-exclusive) game mirrors that provider exactly', () => {
    expect(computeCanonicalLifecycleStatus(['STALE'])).toBe('STALE');
  });
  it('empty list defaults to the least-destructive status', () => {
    expect(computeCanonicalLifecycleStatus([])).toBe('ACTIVE');
  });
});

describe('nextLifecycleStatusOnCycleClose (pure)', () => {
  it('observed this cycle -> ACTIVE from any prior state', () => {
    expect(nextLifecycleStatusOnCycleClose('TOMBSTONED', true, false)).toBe('ACTIVE');
    expect(nextLifecycleStatusOnCycleClose('STALE', true, false)).toBe('ACTIVE');
    expect(nextLifecycleStatusOnCycleClose('ACTIVE', true, false)).toBe('ACTIVE');
  });
  it('first missed cycle: ACTIVE -> STALE', () => {
    expect(nextLifecycleStatusOnCycleClose('ACTIVE', false, false)).toBe('STALE');
  });
  it('second consecutive missed cycle (STALE from a DIFFERENT, earlier cycle): STALE -> TOMBSTONED', () => {
    expect(nextLifecycleStatusOnCycleClose('STALE', false, false)).toBe('TOMBSTONED');
  });
  it('re-evaluating the SAME cycle that just set STALE is a no-op, not a second miss', () => {
    expect(nextLifecycleStatusOnCycleClose('STALE', false, true)).toBe('STALE');
  });
  it('already tombstoned and still absent stays TOMBSTONED (idempotent floor)', () => {
    expect(nextLifecycleStatusOnCycleClose('TOMBSTONED', false, false)).toBe('TOMBSTONED');
  });
});

describe('tombstone engine — hostile E2E (real D1)', () => {
  it('a batch with no syncCycleId never opens or evaluates a cycle (no lifecycle tracking opted into)', async () => {
    const id = `no-cycle-${Math.random().toString(36).slice(2)}`;
    const response = await ingest(batch({ syncId: `s-${id}`, records: [record(id, 'No Cycle Game')] }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { lifecycleEvaluation?: unknown };
    expect(body.lifecycleEvaluation).toBeUndefined();
    expect(await providerLifecycle('steam', id)).toBe('ACTIVE');
  });

  it('malformed response: a schema-invalid batch claiming cycleComplete never reaches evaluation', async () => {
    const cycleId = `malformed-cycle-${Math.random().toString(36).slice(2)}`;
    const response = await ingest({
      provider: 'steam',
      syncId: `s-${cycleId}`,
      observedAt: new Date().toISOString(),
      records: [{ provider: 'steam', providerGameId: 'x', title: 'x', type: 'not-a-real-type', lastUpdated: new Date().toISOString() }],
      syncCycleId: cycleId,
      cycleComplete: true,
    });
    expect(response.status).toBe(400);
    const cycleRow = await env.DB.prepare('SELECT * FROM provider_sync_cycles WHERE provider = ? AND cycle_id = ?').bind('steam', cycleId).first();
    expect(cycleRow).toBeNull();
  });

  it('cycleComplete:true with no syncCycleId is rejected as malformed (completion signal with nothing to close)', async () => {
    const response = await ingest({
      provider: 'steam',
      syncId: `s-${Math.random().toString(36).slice(2)}`,
      observedAt: new Date().toISOString(),
      records: [record('y', 'y')],
      cycleComplete: true,
    });
    expect(response.status).toBe(400);
  });

  it('provider failure: a genuinely FAILED batch (rejected as a syncId conflict) does not degrade lifecycle even if it claimed cycleComplete', async () => {
    const cycleId = `fail-cycle-${Math.random().toString(36).slice(2)}`;
    const syncId = `s-${cycleId}`;
    const id = `fail-game-${cycleId}`;
    const first = await ingest(batch({ syncId, records: [record(id, 'Fail Game')], syncCycleId: cycleId, cycleComplete: true }));
    expect(first.status).toBe(200);
    expect(await providerLifecycle('steam', id)).toBe('ACTIVE');

    // Reuse the same syncId with DIFFERENT content -> 409 conflict, must not re-run/degrade anything.
    const conflicting = await ingest(batch({ syncId, records: [record(id, 'Fail Game RENAMED')], syncCycleId: cycleId, cycleComplete: true }));
    expect(conflicting.status).toBe(409);
    expect(await providerLifecycle('steam', id)).toBe('ACTIVE');
  });

  it('single omission: absent after ONE successfully completed cycle -> STALE, not TOMBSTONED', async () => {
    const cycleA = `single-omit-a-${Math.random().toString(36).slice(2)}`;
    const cycleB = `single-omit-b-${Math.random().toString(36).slice(2)}`;
    const id = `single-omit-game-${cycleA}`;

    const seen = await ingest(batch({ syncId: `s-${cycleA}`, records: [record(id, 'Single Omit Game')], syncCycleId: cycleA, cycleComplete: true }));
    expect(seen.status).toBe(200);
    expect(await providerLifecycle('steam', id)).toBe('ACTIVE');

    // Cycle B completes WITHOUT re-observing this game — an unrelated record keeps the batch non-empty.
    const missed = await ingest(batch({ syncId: `s-${cycleB}`, records: [record(`unrelated-${cycleB}`, 'Unrelated')], syncCycleId: cycleB, cycleComplete: true }));
    expect(missed.status).toBe(200);
    const missedBody = (await missed.json()) as { lifecycleEvaluation: { markedStale: number; markedTombstoned: number } };
    expect(missedBody.lifecycleEvaluation.markedStale).toBeGreaterThanOrEqual(1);
    expect(await providerLifecycle('steam', id)).toBe('STALE');
    expect(await discoveryLifecycleByProviderGame('steam', id)).toBe('STALE');
  });

  it('repeated omission: absent after TWO consecutive completed cycles -> TOMBSTONED', async () => {
    const cycleA = `repeat-omit-a-${Math.random().toString(36).slice(2)}`;
    const cycleB = `repeat-omit-b-${Math.random().toString(36).slice(2)}`;
    const cycleC = `repeat-omit-c-${Math.random().toString(36).slice(2)}`;
    const id = `repeat-omit-game-${cycleA}`;

    await ingest(batch({ syncId: `s-${cycleA}`, records: [record(id, 'Repeat Omit Game')], syncCycleId: cycleA, cycleComplete: true }));
    expect(await providerLifecycle('steam', id)).toBe('ACTIVE');

    await ingest(batch({ syncId: `s-${cycleB}`, records: [record(`unrelated-${cycleB}`, 'Unrelated')], syncCycleId: cycleB, cycleComplete: true }));
    expect(await providerLifecycle('steam', id)).toBe('STALE');

    const secondMiss = await ingest(batch({ syncId: `s-${cycleC}`, records: [record(`unrelated-${cycleC}`, 'Unrelated')], syncCycleId: cycleC, cycleComplete: true }));
    expect(secondMiss.status).toBe(200);
    expect(await providerLifecycle('steam', id)).toBe('TOMBSTONED');
    expect(await discoveryLifecycleByProviderGame('steam', id)).toBe('TOMBSTONED');
  });

  it('reappearance: a TOMBSTONED record observed again immediately goes back to ACTIVE', async () => {
    const cycleA = `reappear-a-${Math.random().toString(36).slice(2)}`;
    const cycleB = `reappear-b-${Math.random().toString(36).slice(2)}`;
    const cycleC = `reappear-c-${Math.random().toString(36).slice(2)}`;
    const id = `reappear-game-${cycleA}`;

    await ingest(batch({ syncId: `s-${cycleA}`, records: [record(id, 'Reappear Game')], syncCycleId: cycleA, cycleComplete: true }));
    await ingest(batch({ syncId: `s-${cycleB}`, records: [record(`unrelated-${cycleB}`, 'Unrelated')], syncCycleId: cycleB, cycleComplete: true }));
    await ingest(batch({ syncId: `s-${cycleC}`, records: [record(`unrelated-${cycleC}`, 'Unrelated')], syncCycleId: cycleC, cycleComplete: true }));
    expect(await providerLifecycle('steam', id)).toBe('TOMBSTONED');

    const cycleD = `reappear-d-${Math.random().toString(36).slice(2)}`;
    const reappeared = await ingest(batch({ syncId: `s-${cycleD}`, records: [record(id, 'Reappear Game')], syncCycleId: cycleD, cycleComplete: false }));
    expect(reappeared.status).toBe(200);
    expect(await providerLifecycle('steam', id)).toBe('ACTIVE');
    expect(await discoveryLifecycleByProviderGame('steam', id)).toBe('ACTIVE');
  });

  it('multi-provider canonical game: one provider going fully tombstoned must NOT degrade a game still active on another provider', async () => {
    const sharedTitle = `Multi Provider Shared Title ${Math.random().toString(36).slice(2)}`;
    const sharedPublisher = `Shared Publisher ${Math.random().toString(36).slice(2)}`;
    const steamId = `mp-steam-${Math.random().toString(36).slice(2)}`;
    const gogId = `mp-gog-${Math.random().toString(36).slice(2)}`;

    // Seed a real curated alias so these two merge to EXACT (otherwise a
    // title+publisher match only reaches POSSIBLE per the Phase 3.1 P1 fix,
    // which would never produce a shared canonical_provider_links entry at
    // all — this test specifically needs an authoritative multi-provider
    // link to exist, so it drives the match through the KNOWN_PROVIDER_ALIASES
    // mechanism rather than asserting a merge the real matcher wouldn't make).
    // Since production's alias list ships empty, this test instead directly
    // seeds a shared canonical_game_id via two separate single-provider
    // UNLINKED ingests and then manually links them the way a curated-alias
    // match result would — proving the ROLLUP logic (the thing this test is
    // actually about), not re-proving the matcher itself (already covered
    // elsewhere).
    const cycleSteam = `mp-steam-cycle-${steamId}`;
    await ingest(batch({ syncId: `s-${cycleSteam}`, records: [record(steamId, sharedTitle, { publisher: sharedPublisher })], syncCycleId: cycleSteam, cycleComplete: true }));
    const cycleGog = `mp-gog-cycle-${gogId}`;
    await ingestProvider(
      'gog',
      batch({ provider: 'gog', syncId: `s-${cycleGog}`, records: [{ provider: 'gog', providerGameId: gogId, title: sharedTitle, type: 'game', publisher: sharedPublisher, lastUpdated: new Date().toISOString() }], syncCycleId: cycleGog, cycleComplete: true }),
    );

    const steamLink = await env.DB.prepare('SELECT canonical_game_id FROM canonical_provider_links WHERE provider = ? AND provider_game_id = ?').bind('steam', steamId).first<{ canonical_game_id: string }>();
    expect(steamLink).toBeTruthy();
    const canonicalGameId = steamLink!.canonical_game_id;

    // Manually point GOG's authoritative link at the SAME canonical game to
    // simulate what a curated alias merge would have produced — isolating
    // the rollup behavior under test from the matcher's own POSSIBLE-only
    // conservatism (already covered by cross-provider-match.test.ts).
    await env.DB.prepare('UPDATE canonical_provider_links SET canonical_game_id = ? WHERE provider = ? AND provider_game_id = ?').bind(canonicalGameId, 'gog', gogId).run();
    await env.DB.prepare("UPDATE discovery_catalog_entries SET provider_ids_json = json_patch(provider_ids_json, json_object('gog', ?)) WHERE solith_game_id = ?").bind(gogId, canonicalGameId).run();

    // Now tombstone GOG's copy across two missed cycles while Steam keeps observing it.
    const gogMiss1 = `mp-gog-miss1-${gogId}`;
    await ingestProvider('gog', batch({ provider: 'gog', syncId: `s-${gogMiss1}`, records: [{ provider: 'gog', providerGameId: `unrelated-${gogMiss1}`, title: 'Unrelated', type: 'game', lastUpdated: new Date().toISOString() }], syncCycleId: gogMiss1, cycleComplete: true }));
    expect(await providerLifecycle('gog', gogId)).toBe('STALE');
    // Steam re-observes its own copy in a fresh cycle — must stay ACTIVE and keep discovery ACTIVE despite GOG's STALE state.
    const steamCycle2 = `mp-steam-cycle2-${steamId}`;
    await ingest(batch({ syncId: `s-${steamCycle2}`, records: [record(steamId, sharedTitle, { publisher: sharedPublisher })], syncCycleId: steamCycle2, cycleComplete: true }));
    expect(await discoveryLifecycleByProviderGame('steam', steamId)).toBe('ACTIVE');

    const gogMiss2 = `mp-gog-miss2-${gogId}`;
    await ingestProvider('gog', batch({ provider: 'gog', syncId: `s-${gogMiss2}`, records: [{ provider: 'gog', providerGameId: `unrelated-${gogMiss2}`, title: 'Unrelated', type: 'game', lastUpdated: new Date().toISOString() }], syncCycleId: gogMiss2, cycleComplete: true }));
    expect(await providerLifecycle('gog', gogId)).toBe('TOMBSTONED');

    // GOG is now fully tombstoned but Steam is still ACTIVE — the canonical
    // game's discovery status must remain ACTIVE, never destroyed.
    const row = await env.DB.prepare('SELECT lifecycle_status FROM discovery_catalog_entries WHERE solith_game_id = ?').bind(canonicalGameId).first<{ lifecycle_status: string }>();
    expect(row?.lifecycle_status).toBe('ACTIVE');
  });

  it('launcher-exclusive game: single-provider canonical game mirrors its one provider through the full ACTIVE -> STALE -> TOMBSTONED -> ACTIVE lifecycle', async () => {
    const cycleA = `exclusive-a-${Math.random().toString(36).slice(2)}`;
    const cycleB = `exclusive-b-${Math.random().toString(36).slice(2)}`;
    const cycleC = `exclusive-c-${Math.random().toString(36).slice(2)}`;
    const cycleD = `exclusive-d-${Math.random().toString(36).slice(2)}`;
    const id = `exclusive-game-${cycleA}`;

    await ingest(batch({ syncId: `s-${cycleA}`, records: [record(id, 'Exclusive Launcher Game')], syncCycleId: cycleA, cycleComplete: true }));
    expect(await discoveryLifecycleByProviderGame('steam', id)).toBe('ACTIVE');

    await ingest(batch({ syncId: `s-${cycleB}`, records: [record(`unrelated-${cycleB}`, 'Unrelated')], syncCycleId: cycleB, cycleComplete: true }));
    expect(await discoveryLifecycleByProviderGame('steam', id)).toBe('STALE');

    await ingest(batch({ syncId: `s-${cycleC}`, records: [record(`unrelated-${cycleC}`, 'Unrelated')], syncCycleId: cycleC, cycleComplete: true }));
    expect(await discoveryLifecycleByProviderGame('steam', id)).toBe('TOMBSTONED');

    await ingest(batch({ syncId: `s-${cycleD}`, records: [record(id, 'Exclusive Launcher Game')], syncCycleId: cycleD, cycleComplete: false }));
    expect(await discoveryLifecycleByProviderGame('steam', id)).toBe('ACTIVE');
  });

  it('idempotent lifecycle evaluation: re-closing the same cycle twice never double-degrades or crashes', async () => {
    const cycleA = `idempotent-a-${Math.random().toString(36).slice(2)}`;
    const cycleB = `idempotent-b-${Math.random().toString(36).slice(2)}`;
    const id = `idempotent-game-${cycleA}`;

    // Cycle A: the game is genuinely observed and completes cleanly (past, already-closed cycle).
    await ingest(batch({ syncId: `s-${cycleA}`, records: [record(id, 'Idempotent Game')], syncCycleId: cycleA, cycleComplete: true }));
    expect(await providerLifecycle('steam', id)).toBe('ACTIVE');

    // Cycle B opens (not yet complete) without observing the game.
    await ingest(batch({ syncId: `s-open-${cycleB}`, records: [record(`unrelated-open-${cycleB}`, 'Unrelated Open')], syncCycleId: cycleB, cycleComplete: false }));
    expect(await providerLifecycle('steam', id)).toBe('ACTIVE'); // an OPEN (incomplete) cycle must never evaluate anything yet.

    // Two DIFFERENT batches both assert completion of the SAME cycle B (a
    // legitimate retry scenario: the caller's completion acknowledgment
    // didn't land the first time and it resends a small trailing batch that
    // again asserts cycleComplete:true for the same cycleId).
    const first = await ingest(batch({ syncId: `s-close1-${cycleB}`, records: [record(`unrelated-a-${cycleB}`, 'Unrelated A')], syncCycleId: cycleB, cycleComplete: true }));
    expect(first.status).toBe(200);
    expect(await providerLifecycle('steam', id)).toBe('STALE');

    const second = await ingest(batch({ syncId: `s-close2-${cycleB}`, records: [record(`unrelated-b-${cycleB}`, 'Unrelated B')], syncCycleId: cycleB, cycleComplete: true }));
    expect(second.status).toBe(200);
    // Re-evaluating the SAME cycle B boundary a second time must not push an
    // already-STALE row to TOMBSTONED — that would require a genuinely NEW
    // completed cycle (cycle C), not a repeat evaluation of cycle B.
    expect(await providerLifecycle('steam', id)).toBe('STALE');
  });
});
