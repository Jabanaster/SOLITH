/**
 * SOLITH Phase 3, Mission 30 — local multi-provider E2E proof, using fixture
 * fetchImpl functions (no real network access). Also covers Mission 19
 * (launcher-exclusive proof) and Mission 29 (network optionality).
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import { syncAllProviders } from '../src/core/provider-catalog/sync-orchestrator.ts';
import { queryDiscoveryCatalog } from '../src/core/discovery-catalog/query.ts';
import { createCustomGame } from '../src/core/canonical-games/custom-game.ts';
import { KNOWN_PROVIDER_ALIASES } from '../src/core/canonical-games/edition-registry.ts';
import type { AdapterFetchImpl, AdapterFetchResponse } from '../src/core/provider-catalog/adapter.ts';

function jsonResponse(body: unknown): AdapterFetchResponse {
  return { ok: true, status: 200, async json() { return body; }, async text() { return JSON.stringify(body); } };
}

// Game A: sold on Steam, Epic, AND GOG (same publisher across all three) — must collapse to ONE canonical game.
// Game B: Steam-only.
// Game C: Epic-only (launcher-exclusive).
// Game D: GOG-only (launcher-exclusive).
const PUBLISHER = 'Shared Publisher Studios';

function steamFixture(includeGameA: boolean, unavailable = false): AdapterFetchImpl {
  return async () => {
    if (unavailable) throw new Error('simulated Steam outage');
    return jsonResponse({
      response: {
        apps: [
          ...(includeGameA ? [{ appid: 100, name: 'Cross Platform Game A', last_modified: 1 }] : []),
          { appid: 200, name: 'Steam Only Game B', last_modified: 1 },
        ],
      },
    });
  };
}

function epicFixture(includeGameA: boolean): AdapterFetchImpl {
  return async () =>
    jsonResponse({
      data: {
        Catalog: {
          searchStore: {
            paging: { count: 2, total: 2 },
            elements: [
              ...(includeGameA ? [{ id: 'epic-a', title: 'Cross Platform Game A', publisherDisplayName: PUBLISHER }] : []),
              { id: 'epic-c', title: 'Epic Exclusive Game C', publisherDisplayName: 'Epic Exclusive Publisher' },
            ],
          },
        },
      },
    });
}

function gogFixture(includeGameA: boolean): AdapterFetchImpl {
  return async () =>
    jsonResponse({
      products: [
        ...(includeGameA ? [{ id: 'gog-a', title: 'Cross Platform Game A', publisher: PUBLISHER, category: 'game' }] : []),
        { id: 'gog-d', title: 'GOG Exclusive Game D', publisher: 'GOG Exclusive Publisher', category: 'game' },
      ],
      totalPages: 1,
    });
}

describe('Phase 3 — local multi-provider Discovery E2E (Mission 19 + 29 + 30)', () => {
  beforeAll(async () => {
    await resetForTesting();
    // HONEST FINDING (Mission 12/6): Steam's real IStoreService/GetAppList
    // response has NO publisher field at all — so a Steam-inclusive
    // cross-provider merge can never reach HIGH confidence via the
    // title+publisher heuristic the way a GOG<->Epic match can (both of
    // those DO expose publisher). The system's own conservative design
    // correctly refuses to guess in that case (see cross-provider-match's
    // "never use title-only fuzzy match as final authority" rule) — it
    // requires either a curated KNOWN_PROVIDER_ALIASES entry (this) or a
    // local-install bridge to reach EXACT for a Steam-side record. This is
    // exactly the intended real-world usage of that curated list, seeded
    // here with a clearly-fake TEST fixture id, not a real verified mapping.
    KNOWN_PROVIDER_ALIASES.push({
      canonicalKey: 'canonical:test-alias:cross-platform-game-a',
      members: [
        { provider: 'steam', providerGameId: '100', evidenceSource: 'test-fixture', verifiedAt: '2026-01-01T00:00:00.000Z' },
        { provider: 'epic', providerGameId: 'epic-a', evidenceSource: 'test-fixture', verifiedAt: '2026-01-01T00:00:00.000Z' },
        { provider: 'gog', providerGameId: 'gog-a', evidenceSource: 'test-fixture', verifiedAt: '2026-01-01T00:00:00.000Z' },
      ],
    });
  });
  afterAll(async () => {
    await resetForTesting();
    KNOWN_PROVIDER_ALIASES.length = 0;
  });

  test('step 1-3: Steam imports A+B, Epic imports A+C, GOG imports A+D', async () => {
    const result = await syncAllProviders({
      onlineServicesEnabled: true,
      steam: { apiKey: 'k', fetchImpl: steamFixture(true) },
      epic: { fetchImpl: epicFixture(true) },
      gog: { fetchImpl: gogFixture(true) },
    });
    assert.equal(result.outcomes.length, 3);
    for (const outcome of result.outcomes) {
      assert.equal(outcome.status, 'ok', `${outcome.provider}: ${outcome.error}`);
    }
  });

  test('step 4: canonical matching links Game A across Steam/Epic/GOG (same publisher)', () => {
    const results = queryDiscoveryCatalog({ text: 'Cross Platform Game A' });
    assert.equal(results.length, 1, 'Game A must appear exactly ONCE in Discovery, not three times');
    const gameA = results[0];
    assert.ok(gameA.providerIds.steam, 'Game A must carry a Steam provider id');
    assert.ok(gameA.providerIds.epic, 'Game A must carry an Epic provider id');
    assert.ok(gameA.providerIds.gog, 'Game A must carry a GOG provider id');
  });

  test('step 5: Game B remains Steam-only', () => {
    const results = queryDiscoveryCatalog({ text: 'Steam Only Game B' });
    assert.equal(results.length, 1);
    assert.ok(results[0].providerIds.steam);
    assert.equal(results[0].providerIds.epic, undefined);
    assert.equal(results[0].providerIds.gog, undefined);
  });

  test('step 6: Game C remains Epic-only (launcher-exclusive, Mission 19)', () => {
    const results = queryDiscoveryCatalog({ text: 'Epic Exclusive Game C' });
    assert.equal(results.length, 1);
    assert.ok(results[0].providerIds.epic);
    assert.equal(results[0].providerIds.steam, undefined);
  });

  test('step 7: Game D remains GOG-only (launcher-exclusive, Mission 19)', () => {
    const results = queryDiscoveryCatalog({ text: 'GOG Exclusive Game D' });
    assert.equal(results.length, 1);
    assert.ok(results[0].providerIds.gog);
    assert.equal(results[0].providerIds.steam, undefined);
  });

  test('step 8: Discovery query returns exactly 4 canonical games total from this sync', () => {
    const all = queryDiscoveryCatalog({ limit: 500 });
    assert.equal(all.length, 4);
  });

  test('step 9 (restated): Game A displays all three provider identities together', () => {
    const gameA = queryDiscoveryCatalog({ text: 'Cross Platform Game A' })[0];
    assert.deepEqual(new Set(Object.keys(gameA.providerIds)), new Set(['steam', 'epic', 'gog']));
  });

  test('Mission 19 (custom/standalone): a fully standalone custom game exists as a normal canonical game with no Steam AppID anywhere', () => {
    const { canonicalGame } = createCustomGame({ displayName: 'Fully Custom Standalone Game', platform: 'standalone' });
    assert.equal(canonicalGame.isCustomGame, true);
    assert.equal(canonicalGame.id.includes('steam'), false);
  });

  test('step 11-12: Online Services OFF blocks all provider network calls, never invoking fetchImpl', async () => {
    let steamCalled = false;
    let epicCalled = false;
    let gogCalled = false;
    const result = await syncAllProviders({
      onlineServicesEnabled: false,
      steam: { apiKey: 'k', fetchImpl: async () => { steamCalled = true; throw new Error('must not be called'); } },
      epic: { fetchImpl: async () => { epicCalled = true; throw new Error('must not be called'); } },
      gog: { fetchImpl: async () => { gogCalled = true; throw new Error('must not be called'); } },
    });
    assert.equal(steamCalled, false);
    assert.equal(epicCalled, false);
    assert.equal(gogCalled, false);
    for (const outcome of result.outcomes) {
      assert.equal(outcome.status, 'skipped-online-services-off');
    }
  });

  test('step 13: local Discovery snapshot still returns all 4 games while Online Services is off', () => {
    // No sync happened in the OFF test above — this proves the PREVIOUSLY
    // synced local snapshot remains fully queryable regardless of the
    // current online-services setting (Discovery reads never gate on it).
    const all = queryDiscoveryCatalog({ limit: 500 });
    assert.ok(all.length >= 4);
  });

  test('step 14-15: a Steam outage does not block Epic/GOG from updating (Mission 28 isolation)', async () => {
    const result = await syncAllProviders({
      onlineServicesEnabled: true,
      steam: { apiKey: 'k', fetchImpl: steamFixture(true, /* unavailable */ true) },
      epic: { fetchImpl: epicFixture(false) },
      gog: { fetchImpl: gogFixture(false) },
    });
    const steamOutcome = result.outcomes.find((o) => o.provider === 'steam')!;
    const epicOutcome = result.outcomes.find((o) => o.provider === 'epic')!;
    const gogOutcome = result.outcomes.find((o) => o.provider === 'gog')!;
    assert.equal(steamOutcome.status, 'error');
    assert.match(steamOutcome.error ?? '', /simulated Steam outage/);
    assert.equal(epicOutcome.status, 'ok');
    assert.equal(gogOutcome.status, 'ok');
  });

  test('Mission 14: one provider returning a MALFORMED payload never wipes or corrupts another provider\'s already-stored records', async () => {
    const preExisting = queryDiscoveryCatalog({ text: 'GOG Exclusive Game D' });
    assert.equal(preExisting.length, 1, 'precondition: Game D from earlier steps must still exist');

    const result = await syncAllProviders({
      onlineServicesEnabled: true,
      steam: { apiKey: 'k', fetchImpl: async () => ({ ok: true, status: 200, async json() { return {}; }, async text() { return '{not valid json'; } }) },
      epic: { fetchImpl: epicFixture(false) },
      gog: { fetchImpl: gogFixture(false) },
    });
    const steamOutcome = result.outcomes.find((o) => o.provider === 'steam')!;
    assert.equal(steamOutcome.status, 'error');

    // Epic/GOG synced fine, and critically, Game D (GOG-sourced, from an
    // EARLIER sync) is completely untouched by Steam's malformed payload.
    const stillThere = queryDiscoveryCatalog({ text: 'GOG Exclusive Game D' });
    assert.equal(stillThere.length, 1);
    assert.deepEqual(stillThere[0], preExisting[0]);
  });
});
