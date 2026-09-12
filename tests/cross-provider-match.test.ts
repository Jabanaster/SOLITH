import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { matchProviderRecordToCanonical, type CanonicalCandidateGame } from '../src/core/canonical-games/cross-provider-match.ts';
import { KNOWN_PROVIDER_ALIASES } from '../src/core/canonical-games/edition-registry.ts';
import type { ProviderGameRecord } from '../src/core/provider-catalog/types.ts';

function record(overrides: Partial<ProviderGameRecord>): ProviderGameRecord {
  return {
    provider: 'steam',
    providerGameId: 'x',
    title: 'A Game',
    type: 'game',
    lastUpdated: new Date().toISOString(),
    ...overrides,
  };
}

function candidate(overrides: Partial<CanonicalCandidateGame>): CanonicalCandidateGame {
  return {
    canonicalGameId: 'canonical:x',
    normalizedTitle: 'A Game',
    linkedProviderIds: [],
    ...overrides,
  };
}

describe('cross-provider canonical matching (Mission 12/13/14)', () => {
  test('same game, same publisher, different providers -> POSSIBLE, never auto-applied (security fix: metadata-only match can never reach HIGH)', () => {
    // SECURITY FIX (Phase 3 hostile review, P1): title+publisher corroboration
    // used to auto-merge at HIGH confidence with zero review. Both fields are
    // fully attacker-controlled on unauthenticated/unofficial provider
    // endpoints (Epic/GOG) — a spoofed response supplying a real public
    // title+publisher could silently merge into an existing canonical game.
    // This now stays POSSIBLE (review queue only); real Steam-inclusive
    // merges require a curated KNOWN_PROVIDER_ALIASES entry or a local-install
    // bridge — see the multi-provider-catalog-e2e.test.ts Game A scenario.
    const result = matchProviderRecordToCanonical({
      record: record({ provider: 'gog', providerGameId: 'gog-2077', title: 'Cyberpunk 2077', publisher: 'CD PROJEKT RED' }),
      candidates: [candidate({ canonicalGameId: 'canonical:cp77', normalizedTitle: 'Cyberpunk 2077', publisher: 'CD Projekt Red' })],
    });
    assert.equal(result.confidence, 'POSSIBLE');
    assert.notEqual(result.confidence, 'HIGH');
    assert.equal(result.candidates[0].canonicalGameId, 'canonical:cp77');
  });

  test('same title, no publisher corroboration, close release year -> POSSIBLE, never auto-merged', () => {
    const result = matchProviderRecordToCanonical({
      record: record({ title: 'Some Indie Game', releaseDate: '2020-05-01' }),
      candidates: [candidate({ normalizedTitle: 'Some Indie Game', releaseYear: 2020 })],
    });
    assert.equal(result.confidence, 'POSSIBLE');
  });

  test('title-only match with no other corroboration is never treated as final/HIGH authority', () => {
    const result = matchProviderRecordToCanonical({
      record: record({ title: 'Generic Title' }),
      candidates: [candidate({ normalizedTitle: 'Generic Title' })],
    });
    assert.equal(result.confidence, 'POSSIBLE');
    assert.notEqual(result.confidence, 'HIGH');
    assert.notEqual(result.confidence, 'EXACT');
  });

  test('Oblivion vs Oblivion Remastered must never merge, even with matching publisher', () => {
    const result = matchProviderRecordToCanonical({
      record: record({ title: 'Oblivion Remastered', publisher: 'Bethesda' }),
      candidates: [candidate({ normalizedTitle: 'Oblivion', publisher: 'Bethesda' })],
    });
    assert.notEqual(result.confidence, 'HIGH');
    assert.notEqual(result.confidence, 'EXACT');
  });

  test('DOOM vs DOOM Eternal must never merge', () => {
    const result = matchProviderRecordToCanonical({
      record: record({ title: 'DOOM Eternal', publisher: 'Bethesda' }),
      candidates: [candidate({ normalizedTitle: 'DOOM', publisher: 'Bethesda' })],
    });
    assert.notEqual(result.confidence, 'HIGH');
  });

  test('Dark Souls / II / III remain distinct even with identical publisher', () => {
    const r1 = matchProviderRecordToCanonical({
      record: record({ title: 'Dark Souls II', publisher: 'Bandai Namco' }),
      candidates: [candidate({ normalizedTitle: 'Dark Souls', publisher: 'Bandai Namco' })],
    });
    assert.notEqual(r1.confidence, 'HIGH');
    const r2 = matchProviderRecordToCanonical({
      record: record({ title: 'Dark Souls III', publisher: 'Bandai Namco' }),
      candidates: [candidate({ normalizedTitle: 'Dark Souls II', publisher: 'Bandai Namco' })],
    });
    assert.notEqual(r2.confidence, 'HIGH');
  });

  test('Final Fantasy VII Remake and Rebirth remain distinct from the original and each other', () => {
    const remakeVsOriginal = matchProviderRecordToCanonical({
      record: record({ title: 'Final Fantasy VII Remake', publisher: 'Square Enix' }),
      candidates: [candidate({ normalizedTitle: 'Final Fantasy VII', publisher: 'Square Enix' })],
    });
    assert.notEqual(remakeVsOriginal.confidence, 'HIGH');
    const remakeVsRebirth = matchProviderRecordToCanonical({
      record: record({ title: 'Final Fantasy VII Rebirth', publisher: 'Square Enix' }),
      candidates: [candidate({ normalizedTitle: 'Final Fantasy VII Remake', publisher: 'Square Enix' })],
    });
    assert.notEqual(remakeVsRebirth.confidence, 'HIGH');
  });

  test('Hitman 1/2/3 remain distinct despite shared publisher', () => {
    const result = matchProviderRecordToCanonical({
      record: record({ title: 'Hitman 3', publisher: 'IO Interactive' }),
      candidates: [candidate({ normalizedTitle: 'Hitman 2', publisher: 'IO Interactive' })],
    });
    assert.notEqual(result.confidence, 'HIGH');
  });

  test('demo variant of a real title never merges with the full game (different normalized titles)', () => {
    const result = matchProviderRecordToCanonical({
      record: record({ title: 'Some Game Demo', type: 'demo', publisher: 'Pub' }),
      candidates: [candidate({ normalizedTitle: 'Some Game', publisher: 'Pub' })],
    });
    // "Some Game Demo" and "Some Game" are different normalized titles, so
    // the demo never even reaches the base-game candidate as a match —
    // proving demo titles are not silently collapsed with the base game.
    assert.equal(result.confidence, 'UNLINKED');
  });

  test('two distinct trusted matches for the same title -> AMBIGUOUS, never silently picks one', () => {
    const result = matchProviderRecordToCanonical({
      record: record({ title: 'Multi Match', publisher: 'Pub A' }),
      candidates: [
        candidate({ canonicalGameId: 'canonical:one', normalizedTitle: 'Multi Match', publisher: 'Pub A' }),
        candidate({ canonicalGameId: 'canonical:two', normalizedTitle: 'Multi Match', publisher: 'pub a inc' }),
      ],
    });
    assert.equal(result.confidence, 'AMBIGUOUS');
    assert.ok(result.candidates.length >= 2);
  });

  test('no candidates at all -> UNLINKED (launcher-exclusive game stands alone)', () => {
    const result = matchProviderRecordToCanonical({
      record: record({ title: 'Totally Unique Exclusive Title' }),
      candidates: [],
    });
    assert.equal(result.confidence, 'UNLINKED');
    assert.deepEqual(result.candidates, []);
  });

  test('a curated KNOWN_PROVIDER_ALIASES entry produces EXACT confidence via the exact (provider, providerGameId) pair, not title matching', () => {
    KNOWN_PROVIDER_ALIASES.push({
      canonicalKey: 'canonical:test:curated-alias-game',
      members: [
        { provider: 'steam', providerGameId: '999', evidenceSource: 'test-fixture', verifiedAt: '2026-01-01T00:00:00.000Z' },
        { provider: 'gog', providerGameId: 'gog-999', evidenceSource: 'test-fixture', verifiedAt: '2026-01-01T00:00:00.000Z' },
      ],
    });
    try {
      const result = matchProviderRecordToCanonical({
        record: record({ provider: 'steam', providerGameId: '999', title: 'Whatever Title Steam Uses' }),
        candidates: [],
      });
      assert.equal(result.confidence, 'EXACT');
      assert.equal(result.candidates[0].canonicalGameId, 'canonical:test:curated-alias-game');
      assert.equal(result.candidates[0].evidence, 'known-provider-alias');

      // A DIFFERENT providerGameId for the same provider must NOT match the alias.
      const nonMatch = matchProviderRecordToCanonical({
        record: record({ provider: 'steam', providerGameId: '1000', title: 'Different Game' }),
        candidates: [],
      });
      assert.notEqual(nonMatch.confidence, 'EXACT');
    } finally {
      KNOWN_PROVIDER_ALIASES.length = 0;
    }
  });

  test('local-install bridge produces EXACT confidence regardless of title', () => {
    // Uses the local-install bridge path (the other EXACT path), proving EXACT
    // can be reached without any title/publisher heuristic at all.
    const result = matchProviderRecordToCanonical({
      record: record({ title: 'Whatever This Is Called On This Store' }),
      candidates: [],
      localInstallCanonicalGameId: 'canonical:bridged-game',
    });
    assert.equal(result.confidence, 'EXACT');
    assert.equal(result.candidates[0].evidence, 'local-install-bridge');
  });

  test('an unparseable/empty title never matches anything and is UNLINKED, not crashed', () => {
    const result = matchProviderRecordToCanonical({
      record: record({ title: '   ' }),
      candidates: [candidate({})],
    });
    assert.equal(result.confidence, 'UNLINKED');
  });
});
