import { before as beforeAll, after as afterAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import {
  upsertCanonicalProviderLink,
  getCanonicalProviderLink,
  listProviderLinksForCanonical,
  listAppliedProviderLinksForCanonical,
  listLinksNeedingReview,
} from '../src/core/canonical-games/provider-link-store.ts';

describe('canonical provider link store (Mission 11/13)', () => {
  beforeAll(async () => {
    await resetForTesting();
  });
  afterAll(async () => {
    await resetForTesting();
  });

  test('round-trips an EXACT link with evidence', () => {
    upsertCanonicalProviderLink({
      provider: 'steam',
      providerGameId: '1091500',
      canonicalGameId: 'canonical:cp77',
      confidence: 'EXACT',
      evidence: [{ canonicalGameId: 'canonical:cp77', confidence: 'EXACT', evidence: 'known-provider-alias', reason: 'test' }],
    });
    const link = getCanonicalProviderLink('steam', '1091500');
    assert.ok(link);
    assert.equal(link!.confidence, 'EXACT');
    assert.equal(link!.canonicalGameId, 'canonical:cp77');
    assert.equal(link!.evidence[0].evidence, 'known-provider-alias');
  });

  test('one canonical game can have multiple provider links (Steam + GOG + Epic)', () => {
    const cid = 'canonical:multi';
    upsertCanonicalProviderLink({ provider: 'steam', providerGameId: 's1', canonicalGameId: cid, confidence: 'HIGH', evidence: [] });
    upsertCanonicalProviderLink({ provider: 'gog', providerGameId: 'g1', canonicalGameId: cid, confidence: 'HIGH', evidence: [] });
    upsertCanonicalProviderLink({ provider: 'epic', providerGameId: 'e1', canonicalGameId: cid, confidence: 'EXACT', evidence: [] });

    const links = listProviderLinksForCanonical(cid);
    assert.equal(links.length, 3);
    assert.deepEqual(new Set(links.map((l) => l.provider)), new Set(['steam', 'gog', 'epic']));
  });

  test('listAppliedProviderLinksForCanonical excludes POSSIBLE/AMBIGUOUS', () => {
    const cid = 'canonical:mixed-confidence';
    upsertCanonicalProviderLink({ provider: 'steam', providerGameId: 'a', canonicalGameId: cid, confidence: 'EXACT', evidence: [] });
    upsertCanonicalProviderLink({ provider: 'gog', providerGameId: 'b', canonicalGameId: cid, confidence: 'POSSIBLE', evidence: [] });
    upsertCanonicalProviderLink({ provider: 'epic', providerGameId: 'c', canonicalGameId: cid, confidence: 'AMBIGUOUS', evidence: [] });

    const applied = listAppliedProviderLinksForCanonical(cid);
    assert.equal(applied.length, 1);
    assert.equal(applied[0].provider, 'steam');
  });

  test('listLinksNeedingReview surfaces POSSIBLE and AMBIGUOUS across all canonical games', () => {
    upsertCanonicalProviderLink({ provider: 'steam', providerGameId: 'review-1', canonicalGameId: 'canonical:r1', confidence: 'POSSIBLE', evidence: [] });
    upsertCanonicalProviderLink({ provider: 'gog', providerGameId: 'review-2', canonicalGameId: 'canonical:r2', confidence: 'AMBIGUOUS', evidence: [] });
    upsertCanonicalProviderLink({ provider: 'epic', providerGameId: 'review-3', canonicalGameId: 'canonical:r3', confidence: 'EXACT', evidence: [] });

    const needingReview = listLinksNeedingReview();
    const providerGameIds = needingReview.map((l) => l.providerGameId);
    assert.ok(providerGameIds.includes('review-1'));
    assert.ok(providerGameIds.includes('review-2'));
    assert.ok(!providerGameIds.includes('review-3'));
  });

  test('upserting the same (provider, providerGameId) updates in place, never duplicates', () => {
    upsertCanonicalProviderLink({ provider: 'steam', providerGameId: 'dup-test', canonicalGameId: 'canonical:first', confidence: 'POSSIBLE', evidence: [] });
    upsertCanonicalProviderLink({ provider: 'steam', providerGameId: 'dup-test', canonicalGameId: 'canonical:second', confidence: 'HIGH', evidence: [] });

    const link = getCanonicalProviderLink('steam', 'dup-test');
    assert.equal(link!.canonicalGameId, 'canonical:second');
    assert.equal(link!.confidence, 'HIGH');
    assert.equal(listProviderLinksForCanonical('canonical:first').length, 0);
  });

  test('getCanonicalProviderLink returns null for an unknown pair', () => {
    assert.equal(getCanonicalProviderLink('steam', 'never-existed'), null);
  });
});
