/**
 * SOLITH Phase 3.1, Mission 7 — closes the disclosed P3: an AMBIGUOUS
 * match's full candidate list must survive on disk, not collapse to one row.
 */
import { before as beforeAll, after as afterAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import { recordLinkCandidates, listCandidatesForRecord, listAllLinkCandidatesNeedingReview } from '../src/core/canonical-games/provider-link-candidate-store.ts';
import { getCanonicalProviderLink } from '../src/core/canonical-games/provider-link-store.ts';

describe('canonical provider link candidates (Mission 7)', () => {
  beforeAll(async () => {
    await resetForTesting();
  });
  afterAll(async () => {
    await resetForTesting();
  });

  test('AMBIGUOUS: all candidate relationships are preserved, not collapsed to one row', () => {
    const candidates = [
      { canonicalGameId: 'canonical:one', confidence: 'POSSIBLE' as const, evidence: 'normalized-title-and-publisher' as const, reason: 'match A' },
      { canonicalGameId: 'canonical:two', confidence: 'POSSIBLE' as const, evidence: 'normalized-title-and-publisher' as const, reason: 'match B' },
      { canonicalGameId: 'canonical:three', confidence: 'POSSIBLE' as const, evidence: 'normalized-title-only' as const, reason: 'match C' },
    ];
    recordLinkCandidates('steam', 'ambiguous-game', 'AMBIGUOUS', candidates);

    const stored = listCandidatesForRecord('steam', 'ambiguous-game');
    assert.equal(stored.length, 3, 'all 3 candidates must be persisted as separate rows, not just the last one');
    const canonicalIds = stored.map((c) => c.candidateCanonicalGameId).sort();
    assert.deepEqual(canonicalIds, ['canonical:one', 'canonical:three', 'canonical:two']);
  });

  test('AMBIGUOUS/POSSIBLE candidates never appear in the authoritative canonical_provider_links table', () => {
    recordLinkCandidates('gog', 'possible-game', 'POSSIBLE', [
      { canonicalGameId: 'canonical:maybe', confidence: 'POSSIBLE', evidence: 'normalized-title-only', reason: 'weak match' },
    ]);
    const authoritative = getCanonicalProviderLink('gog', 'possible-game');
    assert.equal(authoritative, null, 'a POSSIBLE candidate must never appear as an applied link');
  });

  test('re-syncing a record replaces its candidate set rather than accumulating stale rows', () => {
    recordLinkCandidates('epic', 'resync-game', 'AMBIGUOUS', [
      { canonicalGameId: 'canonical:old-a', confidence: 'AMBIGUOUS', evidence: 'normalized-title-only', reason: 'old' },
      { canonicalGameId: 'canonical:old-b', confidence: 'AMBIGUOUS', evidence: 'normalized-title-only', reason: 'old' },
    ]);
    recordLinkCandidates('epic', 'resync-game', 'POSSIBLE', [
      { canonicalGameId: 'canonical:new-a', confidence: 'POSSIBLE', evidence: 'normalized-title-and-publisher', reason: 'new, stronger' },
    ]);
    const stored = listCandidatesForRecord('epic', 'resync-game');
    assert.equal(stored.length, 1);
    assert.equal(stored[0].candidateCanonicalGameId, 'canonical:new-a');
  });

  test('listAllLinkCandidatesNeedingReview surfaces candidates across all providers', () => {
    const all = listAllLinkCandidatesNeedingReview();
    const pairs = all.map((c) => `${c.provider}:${c.providerGameId}`);
    assert.ok(pairs.includes('steam:ambiguous-game'));
    assert.ok(pairs.includes('gog:possible-game'));
    assert.ok(pairs.includes('epic:resync-game'));
  });

  test('a record with zero candidates (defensive) stores nothing and does not throw', () => {
    recordLinkCandidates('xbox', 'no-candidates-game', 'AMBIGUOUS', []);
    assert.deepEqual(listCandidatesForRecord('xbox', 'no-candidates-game'), []);
  });
});
