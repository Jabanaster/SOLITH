import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScanRegionProfile,
  planAdaptiveScan,
  planReferenceScan,
  type ScanRegionProfile,
  type ScanTelemetry,
} from '../../src/core/live-memory/adaptive-scan-planner.js';
import type { MemoryRegion } from '../../src/core/live-memory/types.js';

function region(size: number, regionType: MemoryRegion['regionType'], overrides: Partial<MemoryRegion> = {}): MemoryRegion {
  return { baseAddress: 0x1000n, size, writable: true, regionType, ...overrides };
}

function telemetry(overrides: Partial<ScanTelemetry> = {}): ScanTelemetry {
  return {
    strategy: 'BROAD_FULL',
    regionsConsidered: 10,
    regionsScanned: 10,
    regionsSkipped: 0,
    eligibleBytes: 1_000_000,
    scannedBytes: 1_000_000,
    elapsedMillis: 5,
    resultCount: 1000,
    coverage: 'complete',
    partialReads: 0,
    failedReads: 0,
    cancelled: false,
    recordedAt: 1,
    ...overrides,
  };
}

// ── buildScanRegionProfile ───────────────────────────────────────────────────

test('buildScanRegionProfile measures eligible bytes/regions and category breakdown', () => {
  const regions: MemoryRegion[] = [
    region(1000, 'image'),
    region(2000, 'private'),
    region(500, 'mapped'),
    region(300, 'private', { writable: false }), // ineligible: not writable
    region(0, 'private'), // ineligible: zero size
  ];
  const profile = buildScanRegionProfile(regions);

  assert.equal(profile.totalRegions, 5);
  assert.equal(profile.eligibleRegions, 3);
  assert.equal(profile.eligibleBytes, 3500);
  assert.equal(profile.moduleBackedBytes, 1000);
  assert.equal(profile.privateBytes, 2000);
  assert.equal(profile.mappedBytes, 500);
  assert.equal(profile.largestRegionBytes, 2000);
});

test('buildScanRegionProfile counts unreadable regions even when ineligible for scanning', () => {
  const regions: MemoryRegion[] = [region(100, 'private', { readable: false }), region(100, 'private', { readable: true })];
  const profile = buildScanRegionProfile(regions);
  assert.equal(profile.unreadableRegions, 1);
});

test('buildScanRegionProfile on an empty enumeration returns an all-zero profile, not a crash', () => {
  const profile = buildScanRegionProfile([]);
  assert.equal(profile.totalRegions, 0);
  assert.equal(profile.eligibleBytes, 0);
});

// ── Initial adaptation (§12): different measured profiles → different plans ─

test('planAdaptiveScan: a module-heavy profile with no prior telemetry orders private regions first', () => {
  const profile: ScanRegionProfile = {
    totalRegions: 2,
    eligibleRegions: 2,
    eligibleBytes: 1000,
    moduleBackedBytes: 800,
    privateBytes: 200,
    mappedBytes: 0,
    unreadableRegions: 0,
    largestRegionBytes: 800,
  };
  const plan = planAdaptiveScan({ profile, priorTelemetry: [] });
  assert.equal(plan.strategy, 'PRIVATE_FIRST');
  assert.equal(plan.regionOrder, 'private_first');
  assert.ok(plan.reasons.includes('MODULE_HEAVY_PROFILE'));
  assert.ok(plan.reasons.includes('NO_PRIOR_TELEMETRY'));
});

test('planAdaptiveScan: a private-heavy profile with no prior telemetry also prioritizes private regions, for a different measured reason', () => {
  const profile: ScanRegionProfile = {
    totalRegions: 2,
    eligibleRegions: 2,
    eligibleBytes: 1000,
    moduleBackedBytes: 100,
    privateBytes: 900,
    mappedBytes: 0,
    unreadableRegions: 0,
    largestRegionBytes: 900,
  };
  const plan = planAdaptiveScan({ profile, priorTelemetry: [] });
  assert.equal(plan.regionOrder, 'private_first');
  assert.ok(plan.reasons.includes('PRIVATE_HEAVY_PROFILE'));
  assert.ok(!plan.reasons.includes('MODULE_HEAVY_PROFILE'));
});

test('planAdaptiveScan: a mixed/uniform profile takes the broad-full strategy in OS enumeration order', () => {
  const profile: ScanRegionProfile = {
    totalRegions: 2,
    eligibleRegions: 2,
    eligibleBytes: 1000,
    moduleBackedBytes: 400,
    privateBytes: 400,
    mappedBytes: 200,
    unreadableRegions: 0,
    largestRegionBytes: 400,
  };
  const plan = planAdaptiveScan({ profile, priorTelemetry: [] });
  assert.equal(plan.strategy, 'BROAD_FULL');
  assert.equal(plan.regionOrder, 'as_enumerated');
});

test('§12 proof: two meaningfully different measured profiles yield two different plans', () => {
  const moduleHeavy: ScanRegionProfile = {
    totalRegions: 1,
    eligibleRegions: 1,
    eligibleBytes: 1000,
    moduleBackedBytes: 900,
    privateBytes: 100,
    mappedBytes: 0,
    unreadableRegions: 0,
    largestRegionBytes: 900,
  };
  const uniform: ScanRegionProfile = {
    totalRegions: 1,
    eligibleRegions: 1,
    eligibleBytes: 1000,
    moduleBackedBytes: 300,
    privateBytes: 300,
    mappedBytes: 400,
    unreadableRegions: 0,
    largestRegionBytes: 300,
  };
  const planA = planAdaptiveScan({ profile: moduleHeavy, priorTelemetry: [] });
  const planB = planAdaptiveScan({ profile: uniform, priorTelemetry: [] });
  assert.notEqual(planA.strategy, planB.strategy);
  assert.notEqual(planA.regionOrder, planB.regionOrder);
});

test('planAdaptiveScan: an eligible region larger than the default cap raises maxRegionBytes rather than silently excluding it (§7 completeness)', () => {
  const profile: ScanRegionProfile = {
    totalRegions: 1,
    eligibleRegions: 1,
    eligibleBytes: 200 * 1024 * 1024,
    moduleBackedBytes: 0,
    privateBytes: 200 * 1024 * 1024,
    mappedBytes: 0,
    unreadableRegions: 0,
    largestRegionBytes: 200 * 1024 * 1024, // bigger than the 64 MiB default cap
  };
  const plan = planAdaptiveScan({ profile, priorTelemetry: [] });
  assert.ok(plan.maxRegionBytes >= 200 * 1024 * 1024);
  assert.ok(plan.reasons.includes('LARGE_REGION_PROFILE'));
});

// ── Follow-up adaptation (§13): plan changes because prior measured results differ ─

test('§13 proof: a small prior result count narrows the next plan (PRIOR_CANDIDATE_SET_SMALL)', () => {
  const profile: ScanRegionProfile = {
    totalRegions: 2,
    eligibleRegions: 2,
    eligibleBytes: 2_000_000_000,
    moduleBackedBytes: 500_000_000,
    privateBytes: 500_000_000,
    mappedBytes: 0,
    unreadableRegions: 0,
    largestRegionBytes: 1_000_000_000,
  };
  const prior = telemetry({ resultCount: 50, scannedBytes: 40_000 });
  const plan = planAdaptiveScan({ profile, priorTelemetry: [prior] });
  assert.equal(plan.strategy, 'NARROWED_BY_PRIOR_CANDIDATES');
  assert.ok(plan.reasons.includes('PRIOR_CANDIDATE_SET_SMALL'));
  assert.equal(plan.maxTotalBytes, 40_000);
});

test('§13 proof: a large prior result count switches to largest-first with a tighter match cap (PRIOR_CANDIDATE_SET_LARGE)', () => {
  const profile: ScanRegionProfile = {
    totalRegions: 2,
    eligibleRegions: 2,
    eligibleBytes: 2_000_000_000,
    moduleBackedBytes: 500_000_000,
    privateBytes: 500_000_000,
    mappedBytes: 0,
    unreadableRegions: 0,
    largestRegionBytes: 1_000_000_000,
  };
  const prior = telemetry({ resultCount: 48_000 });
  const plan = planAdaptiveScan({ profile, priorTelemetry: [prior] });
  assert.equal(plan.strategy, 'LARGEST_FIRST');
  assert.equal(plan.regionOrder, 'largest_first');
  assert.ok(plan.reasons.includes('PRIOR_CANDIDATE_SET_LARGE'));
  assert.ok(plan.maxMatches < 10_000);
});

test('§13/§11 proof: a small-result-count scan followed by a large-result-count scan produce two different plans from the same profile', () => {
  const profile: ScanRegionProfile = {
    totalRegions: 2,
    eligibleRegions: 2,
    eligibleBytes: 2_000_000_000,
    moduleBackedBytes: 1_000_000_000,
    privateBytes: 1_000_000_000,
    mappedBytes: 0,
    unreadableRegions: 0,
    largestRegionBytes: 1_000_000_000,
  };
  const planAfterSparse = planAdaptiveScan({ profile, priorTelemetry: [telemetry({ resultCount: 12 })] });
  const planAfterDense = planAdaptiveScan({ profile, priorTelemetry: [telemetry({ resultCount: 30_000 })] });
  assert.notEqual(planAfterSparse.strategy, planAfterDense.strategy);
});

test('planAdaptiveScan: a high partial/failed-read rate on the prior scan shrinks maxRegionBytes (HIGH_PARTIAL_READ_RATE)', () => {
  const profile: ScanRegionProfile = {
    totalRegions: 10,
    eligibleRegions: 10,
    eligibleBytes: 1000,
    moduleBackedBytes: 500,
    privateBytes: 500,
    mappedBytes: 0,
    unreadableRegions: 0,
    largestRegionBytes: 100,
  };
  const prior = telemetry({ resultCount: 5000, regionsConsidered: 10, partialReads: 3, failedReads: 0 });
  const baseline = planReferenceScan();
  const plan = planAdaptiveScan({ profile, priorTelemetry: [prior] });
  assert.ok(plan.reasons.includes('HIGH_PARTIAL_READ_RATE'));
  assert.ok(plan.maxRegionBytes < baseline.maxRegionBytes);
});

// ── Reference mode (§9): deterministic baseline, ignores profile/telemetry ──

test('planReferenceScan always returns the full-coverage, as-enumerated baseline regardless of profile', () => {
  const plan = planReferenceScan();
  assert.equal(plan.strategy, 'REFERENCE_FULL');
  assert.equal(plan.regionOrder, 'as_enumerated');
});

test('a forced fallback reason always produces the reference plan, even with rich prior telemetry available', () => {
  const profile: ScanRegionProfile = {
    totalRegions: 1,
    eligibleRegions: 1,
    eligibleBytes: 1000,
    moduleBackedBytes: 900,
    privateBytes: 100,
    mappedBytes: 0,
    unreadableRegions: 0,
    largestRegionBytes: 900,
  };
  const plan = planAdaptiveScan({
    profile,
    priorTelemetry: [telemetry({ resultCount: 40_000 })],
    forceFallbackReason: 'TELEMETRY_STALE',
  });
  assert.equal(plan.strategy, 'REFERENCE_FULL');
  assert.ok(plan.reasons.includes('REFERENCE_FALLBACK'));
});

// ── Determinism (§14) ────────────────────────────────────────────────────────

test('planAdaptiveScan is deterministic: identical input always produces an identical plan', () => {
  const profile: ScanRegionProfile = {
    totalRegions: 3,
    eligibleRegions: 3,
    eligibleBytes: 500_000,
    moduleBackedBytes: 300_000,
    privateBytes: 200_000,
    mappedBytes: 0,
    unreadableRegions: 1,
    largestRegionBytes: 200_000,
  };
  const priorTelemetry = [telemetry({ resultCount: 40 })];
  const planA = planAdaptiveScan({ profile, priorTelemetry });
  const planB = planAdaptiveScan({ profile, priorTelemetry });
  assert.deepEqual(planA, planB);
});
