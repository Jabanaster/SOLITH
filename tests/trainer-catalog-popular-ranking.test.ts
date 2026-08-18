import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRankSignals,
  rankPopularTrainerEntries,
  projectPopularTrainerEntries,
  POPULAR_TRAINER_LIMIT,
} from '../src/core/trainer-catalog/popular-ranking.js';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.js';

function makeEntry(overrides: Partial<TrainerCatalogEntry> & { catalogGameId: string }): TrainerCatalogEntry {
  return {
    displayName: overrides.displayName ?? overrides.catalogGameId,
    steamAppId: undefined,
    executables: [],
    categories: [],
    verificationStatus: 'community',
    sources: [],
    hasModPack: false,
    cheatCount: 0,
    searchableText: '',
    ...overrides,
  };
}

describe('computeRankSignals', () => {
  it('marks installed entries via the installedCatalogGameIds context set', () => {
    const entry = makeEntry({ catalogGameId: 'a' });
    const signals = computeRankSignals(entry, { installedCatalogGameIds: new Set(['a']) });
    assert.equal(signals.installed, true);
  });

  it('requires both verified provenance and a real mod pack for verifiedSolithSupport', () => {
    const verifiedNoPack = makeEntry({ catalogGameId: 'a', verificationStatus: 'verified', hasModPack: false });
    const packNoVerify = makeEntry({ catalogGameId: 'b', verificationStatus: 'community', hasModPack: true });
    const both = makeEntry({ catalogGameId: 'c', verificationStatus: 'verified', hasModPack: true });
    assert.equal(computeRankSignals(verifiedNoPack).verifiedSolithSupport, false);
    assert.equal(computeRankSignals(packNoVerify).verifiedSolithSupport, false);
    assert.equal(computeRankSignals(both).verifiedSolithSupport, true);
  });

  it('sums real local demand evidence into popularityValue without fabricating a score', () => {
    const entry = makeEntry({ catalogGameId: 'a' });
    const withDemand = computeRankSignals(entry, {
      popularityByCatalogGameId: new Map([['a', { notifyCount: 3, verificationRequests: 2 }]]),
    });
    assert.equal(withDemand.popularityValue, 5);
    assert.equal(withDemand.popularityIsFallback, false);

    const withoutDemand = computeRankSignals(entry);
    assert.equal(withoutDemand.popularityValue, 0);
    assert.equal(withoutDemand.popularityIsFallback, true);
  });

  it('never marks recentlyReleased or enduringFavorite true — no evidence field exists yet', () => {
    const entry = makeEntry({ catalogGameId: 'a' });
    const signals = computeRankSignals(entry);
    assert.equal(signals.recentlyReleased, false);
    assert.equal(signals.enduringFavorite, false);
  });
});

describe('rankPopularTrainerEntries — eligibility boundary', () => {
  it('never ranks an excluded entry even with high popularity evidence', () => {
    const excluded = makeEntry({ catalogGameId: 'excluded', antiCheat: 'protected-multiplayer' });
    const eligible = makeEntry({ catalogGameId: 'eligible' });
    const ranked = rankPopularTrainerEntries([excluded, eligible], {
      popularityByCatalogGameId: new Map([['excluded', { notifyCount: 999 }]]),
    });
    assert.deepEqual(ranked.map((r) => r.entry.catalogGameId), ['eligible']);
  });

  it('handles an unsupported (not excluded) entry by ranking it, without the verified-support boost', () => {
    const unsupported = makeEntry({ catalogGameId: 'unsupported', explicitlyUnsupported: true });
    const ranked = rankPopularTrainerEntries([unsupported]);
    assert.deepEqual(ranked.map((r) => r.entry.catalogGameId), ['unsupported']);
    assert.equal(ranked[0].rankSignals.verifiedSolithSupport, false);
  });

  it('re-applies the eligibility boundary even if the caller forgot to pre-filter', () => {
    const excluded = makeEntry({ catalogGameId: 'a', catalogExclusionFlags: ['mmo'] });
    const ranked = rankPopularTrainerEntries([excluded]);
    assert.equal(ranked.length, 0);
  });
});

describe('rankPopularTrainerEntries — priority order', () => {
  it('ranks installed above everything else', () => {
    const installed = makeEntry({ catalogGameId: 'installed' });
    const verified = makeEntry({ catalogGameId: 'verified', verificationStatus: 'verified', hasModPack: true });
    const ranked = rankPopularTrainerEntries([verified, installed], {
      installedCatalogGameIds: new Set(['installed']),
    });
    assert.equal(ranked[0].entry.catalogGameId, 'installed');
  });

  it('ranks verified SOLITH support above popularity when neither is installed', () => {
    const verified = makeEntry({ catalogGameId: 'verified', verificationStatus: 'verified', hasModPack: true });
    const popular = makeEntry({ catalogGameId: 'popular' });
    const ranked = rankPopularTrainerEntries([popular, verified], {
      popularityByCatalogGameId: new Map([['popular', { notifyCount: 1000 }]]),
    });
    assert.equal(ranked[0].entry.catalogGameId, 'verified');
  });

  it('ranks higher popularity above lower popularity when installed/verified tiers are equal', () => {
    const low = makeEntry({ catalogGameId: 'low' });
    const high = makeEntry({ catalogGameId: 'high' });
    const ranked = rankPopularTrainerEntries([low, high], {
      popularityByCatalogGameId: new Map([
        ['low', { notifyCount: 1 }],
        ['high', { notifyCount: 10 }],
      ]),
    });
    assert.deepEqual(ranked.map((r) => r.entry.catalogGameId), ['high', 'low']);
  });
});

describe('rankPopularTrainerEntries — stability and determinism', () => {
  it('produces the same order regardless of input insertion order', () => {
    const a = makeEntry({ catalogGameId: 'a', displayName: 'Alpha' });
    const b = makeEntry({ catalogGameId: 'b', displayName: 'Bravo' });
    const c = makeEntry({ catalogGameId: 'c', displayName: 'Charlie' });
    const order1 = rankPopularTrainerEntries([a, b, c]).map((r) => r.entry.catalogGameId);
    const order2 = rankPopularTrainerEntries([c, a, b]).map((r) => r.entry.catalogGameId);
    const order3 = rankPopularTrainerEntries([b, c, a]).map((r) => r.entry.catalogGameId);
    assert.deepEqual(order1, order2);
    assert.deepEqual(order2, order3);
  });

  it('breaks exact ties deterministically by display name then catalogGameId', () => {
    const a = makeEntry({ catalogGameId: 'z-id', displayName: 'Same Title' });
    const b = makeEntry({ catalogGameId: 'a-id', displayName: 'Same Title' });
    const ranked = rankPopularTrainerEntries([a, b]);
    assert.deepEqual(ranked.map((r) => r.entry.catalogGameId), ['a-id', 'z-id']);
  });

  it('same input produces the same output across repeated calls', () => {
    const entries = [
      makeEntry({ catalogGameId: 'a' }),
      makeEntry({ catalogGameId: 'b', verificationStatus: 'verified', hasModPack: true }),
    ];
    const first = rankPopularTrainerEntries(entries).map((r) => r.entry.catalogGameId);
    const second = rankPopularTrainerEntries(entries).map((r) => r.entry.catalogGameId);
    assert.deepEqual(first, second);
  });
});

describe('projectPopularTrainerEntries — limit', () => {
  it('returns all eligible entries when fewer than the limit exist', () => {
    const entries = Array.from({ length: 10 }, (_, i) => makeEntry({ catalogGameId: `g${i}` }));
    const projected = projectPopularTrainerEntries(entries);
    assert.equal(projected.length, 10);
  });

  it('returns exactly POPULAR_TRAINER_LIMIT entries when more eligible entries exist', () => {
    const entries = Array.from({ length: POPULAR_TRAINER_LIMIT + 25 }, (_, i) => makeEntry({ catalogGameId: `g${i}` }));
    const projected = projectPopularTrainerEntries(entries);
    assert.equal(projected.length, POPULAR_TRAINER_LIMIT);
  });

  it('does not pad the limit with excluded entries', () => {
    const excluded = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ catalogGameId: `excluded-${i}`, catalogExclusionFlags: ['mmo'] }),
    );
    const eligible = Array.from({ length: 3 }, (_, i) => makeEntry({ catalogGameId: `eligible-${i}` }));
    const projected = projectPopularTrainerEntries([...excluded, ...eligible]);
    assert.equal(projected.length, 3);
    assert.ok(projected.every((r) => r.entry.catalogGameId.startsWith('eligible-')));
  });
});

describe('rankPopularTrainerEntries — canonical/launcher-duplicate dedup', () => {
  it('collapses duplicate catalogGameId rows to a single Popular position', () => {
    const dupA = makeEntry({ catalogGameId: 'shared', displayName: 'Shared Game (source A)' });
    const dupB = makeEntry({ catalogGameId: 'shared', displayName: 'Shared Game (source B)' });
    const ranked = rankPopularTrainerEntries([dupA, dupB]);
    assert.equal(ranked.length, 1);
  });
});

describe('rankPopularTrainerEntries — verification/support-state separation', () => {
  it('excludes a verified entry that also carries exclusion evidence', () => {
    const verifiedButExcluded = makeEntry({
      catalogGameId: 'a',
      verificationStatus: 'verified',
      hasModPack: true,
      antiCheat: 'protected-online-only',
    });
    const ranked = rankPopularTrainerEntries([verifiedButExcluded]);
    assert.equal(ranked.length, 0);
  });

  it('allows a community/unverified entry with no exclusion evidence to rank', () => {
    const community = makeEntry({ catalogGameId: 'a', verificationStatus: 'community' });
    const ranked = rankPopularTrainerEntries([community]);
    assert.equal(ranked.length, 1);
  });
});
