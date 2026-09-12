import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeAccuracyPriority,
  rankByAccuracyPriority,
  type AccuracyPriorityEvidence,
} from '../src/core/trainer-catalog/personal-accuracy-priority.js';

function makeEvidence(overrides: Partial<AccuracyPriorityEvidence> = {}): AccuracyPriorityEvidence {
  return {
    canonicalGameId: 'game-a',
    isInstalled: false,
    ownedConfirmed: false,
    identityTier: 5,
    identityTrusted: false,
    hasExecutableEvidence: false,
    hasVersionHint: false,
    bestSourceVerificationStatus: 'unverified',
    deduplicatedCheatCount: 0,
    nativeReadyCandidateCount: 0,
    hasLocalVerificationReceipt: false,
    ...overrides,
  };
}

test('installed always outranks owned regardless of sub-priority evidence', () => {
  const installedWeak = computeAccuracyPriority(makeEvidence({ canonicalGameId: 'installed-weak', isInstalled: true }));
  const ownedStrong = computeAccuracyPriority(makeEvidence({
    canonicalGameId: 'owned-strong',
    ownedConfirmed: true,
    identityTier: 1,
    identityTrusted: true,
    hasExecutableEvidence: true,
    hasVersionHint: true,
    bestSourceVerificationStatus: 'verified',
    deduplicatedCheatCount: 50,
    nativeReadyCandidateCount: 50,
    hasLocalVerificationReceipt: true,
  }));
  assert.ok(installedWeak.score > ownedStrong.score, 'installed band must always outrank owned band');
});

test('owned always outranks other/neither regardless of sub-priority evidence', () => {
  const ownedWeak = computeAccuracyPriority(makeEvidence({ canonicalGameId: 'owned-weak', ownedConfirmed: true }));
  const otherStrong = computeAccuracyPriority(makeEvidence({
    canonicalGameId: 'other-strong',
    identityTier: 1,
    identityTrusted: true,
    hasExecutableEvidence: true,
    hasVersionHint: true,
    bestSourceVerificationStatus: 'verified',
    deduplicatedCheatCount: 50,
    nativeReadyCandidateCount: 50,
    hasLocalVerificationReceipt: true,
  }));
  assert.ok(ownedWeak.score > otherStrong.score, 'owned band must always outrank other band');
});

test('within the same band, stronger canonical identity confidence (lower tier) ranks higher', () => {
  const tier1 = computeAccuracyPriority(makeEvidence({ canonicalGameId: 'tier1', isInstalled: true, identityTier: 1 }));
  const tier5 = computeAccuracyPriority(makeEvidence({ canonicalGameId: 'tier5', isInstalled: true, identityTier: 5 }));
  assert.ok(tier1.score > tier5.score);
});

test('within the same band and identity tier, executable evidence outranks its absence', () => {
  const withExe = computeAccuracyPriority(makeEvidence({ canonicalGameId: 'with-exe', isInstalled: true, hasExecutableEvidence: true }));
  const withoutExe = computeAccuracyPriority(makeEvidence({ canonicalGameId: 'without-exe', isInstalled: true, hasExecutableEvidence: false }));
  assert.ok(withExe.score > withoutExe.score);
});

test('verified provenance outranks unverified, all else equal', () => {
  const verified = computeAccuracyPriority(makeEvidence({ canonicalGameId: 'v', isInstalled: true, bestSourceVerificationStatus: 'verified' }));
  const unverified = computeAccuracyPriority(makeEvidence({ canonicalGameId: 'u', isInstalled: true, bestSourceVerificationStatus: 'unverified' }));
  assert.ok(verified.score > unverified.score);
});

test('rankByAccuracyPriority produces band-grouped, deterministic, tie-broken order', () => {
  const entries: AccuracyPriorityEvidence[] = [
    makeEvidence({ canonicalGameId: 'zzz-other' }),
    makeEvidence({ canonicalGameId: 'aaa-owned', ownedConfirmed: true }),
    makeEvidence({ canonicalGameId: 'bbb-installed', isInstalled: true }),
    makeEvidence({ canonicalGameId: 'aaa-installed', isInstalled: true }),
  ];
  const ranked = rankByAccuracyPriority(entries);
  assert.deepEqual(ranked.map((r) => r.canonicalGameId), ['aaa-installed', 'bbb-installed', 'aaa-owned', 'zzz-other']);
});

test('rankByAccuracyPriority is a pure function — repeated calls on the same input produce identical output', () => {
  const entries: AccuracyPriorityEvidence[] = [
    makeEvidence({ canonicalGameId: 'g1', isInstalled: true, identityTier: 3 }),
    makeEvidence({ canonicalGameId: 'g2', ownedConfirmed: true, identityTier: 1 }),
    makeEvidence({ canonicalGameId: 'g3' }),
  ];
  const first = rankByAccuracyPriority(entries).map((r) => r.canonicalGameId);
  const second = rankByAccuracyPriority(entries).map((r) => r.canonicalGameId);
  assert.deepEqual(first, second);
});

test('never auto-executes anything — module exposes only pure scoring functions, no launch/attach/write APIs', async () => {
  const moduleExports = Object.keys(
    await import('../src/core/trainer-catalog/personal-accuracy-priority.js'),
  );
  for (const exportName of moduleExports) {
    assert.doesNotMatch(exportName, /launch|attach|execute|write|run/i);
  }
});
