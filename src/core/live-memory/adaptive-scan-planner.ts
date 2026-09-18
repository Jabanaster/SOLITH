import type { MemoryRegion, ScanBounds } from './types.js';

/**
 * P2-10 — Adaptive Scan Planner.
 *
 * Pure decision logic: given a measured region profile of the attached
 * process (and, optionally, telemetry recorded from earlier scans in this
 * same attach), decide a concrete scan strategy, region order, and bounds —
 * with structured reasons tying every decision back to a specific measured
 * input. No I/O anywhere in this module: it never reads memory, never
 * enumerates regions itself, and never touches the clock. That is what makes
 * `planAdaptiveScan`/`planReferenceScan` deterministic (same input always
 * produces the same plan) and unit-testable without a live process.
 *
 * `adaptive-scan-orchestration.ts` is the impure layer that measures a real
 * `ScanRegionProfile` from `driver.getRegions()`, loads prior telemetry from
 * `AdaptiveScanTelemetryStore`, calls into this module, executes the plan via
 * `scanFirst`'s new `ScanBounds.regionOrder` hook, and records the outcome.
 */

// ── Region profile (measured input) ─────────────────────────────────────────

/** Aggregate, measured characteristics of the attached process's eligible memory — the profile input a plan is based on. */
export interface ScanRegionProfile {
  totalRegions: number;
  eligibleRegions: number;
  eligibleBytes: number;
  moduleBackedBytes: number;
  privateBytes: number;
  mappedBytes: number;
  unreadableRegions: number;
  largestRegionBytes: number;
}

const EMPTY_PROFILE: ScanRegionProfile = {
  totalRegions: 0,
  eligibleRegions: 0,
  eligibleBytes: 0,
  moduleBackedBytes: 0,
  privateBytes: 0,
  mappedBytes: 0,
  unreadableRegions: 0,
  largestRegionBytes: 0,
};

/**
 * Builds a `ScanRegionProfile` from a raw region enumeration. Eligible means
 * "a value scan would consider this" — writable and positive size — mirroring
 * `memory-scanner.ts`'s own `selectScannableRegions` eligibility rule, minus
 * the `maxRegionBytes` cap (that is a *bounds* decision the planner makes
 * from the profile, not part of measuring the profile itself).
 */
export function buildScanRegionProfile(regions: readonly MemoryRegion[]): ScanRegionProfile {
  if (regions.length === 0) return { ...EMPTY_PROFILE };

  let eligibleRegions = 0;
  let eligibleBytes = 0;
  let moduleBackedBytes = 0;
  let privateBytes = 0;
  let mappedBytes = 0;
  let unreadableRegions = 0;
  let largestRegionBytes = 0;

  for (const region of regions) {
    if (region.readable === false) unreadableRegions += 1;
    if (!region.writable || region.size <= 0) continue;

    eligibleRegions += 1;
    eligibleBytes += region.size;
    if (region.size > largestRegionBytes) largestRegionBytes = region.size;

    switch (region.regionType) {
      case 'image':
        moduleBackedBytes += region.size;
        break;
      case 'private':
        privateBytes += region.size;
        break;
      case 'mapped':
        mappedBytes += region.size;
        break;
      default:
        break;
    }
  }

  return {
    totalRegions: regions.length,
    eligibleRegions,
    eligibleBytes,
    moduleBackedBytes,
    privateBytes,
    mappedBytes,
    unreadableRegions,
    largestRegionBytes,
  };
}

// ── Telemetry (measured outcome of a previous plan) ─────────────────────────

/** What a scan actually measured while executing a plan — the feedback a later plan can adapt to. */
export interface ScanTelemetry {
  strategy: ScanStrategy;
  regionsConsidered: number;
  regionsScanned: number;
  regionsSkipped: number;
  eligibleBytes: number;
  scannedBytes: number;
  elapsedMillis: number;
  resultCount: number;
  coverage: 'complete' | 'complete_with_skipped_regions' | 'cancelled' | 'process_exited' | 'resource_limit' | 'failed';
  partialReads: number;
  failedReads: number;
  cancelled: boolean;
  recordedAt: number;
}

// ── Plan vocabulary ──────────────────────────────────────────────────────────

export type ScanStrategy =
  | 'REFERENCE_FULL'
  | 'BROAD_FULL'
  | 'MODULE_DEFERRED'
  | 'PRIVATE_FIRST'
  | 'LARGEST_FIRST'
  | 'NARROWED_BY_PRIOR_CANDIDATES';

export type ScanPlanReason =
  | 'NO_PRIOR_TELEMETRY'
  | 'MODULE_HEAVY_PROFILE'
  | 'PRIVATE_HEAVY_PROFILE'
  | 'LARGE_REGION_PROFILE'
  | 'PRIOR_CANDIDATE_SET_SMALL'
  | 'PRIOR_CANDIDATE_SET_LARGE'
  | 'HIGH_PARTIAL_READ_RATE'
  | 'REFERENCE_FALLBACK'
  | 'UNIFORM_PROFILE';

export interface ScanPlan {
  strategy: ScanStrategy;
  reasons: ScanPlanReason[];
  regionOrder: NonNullable<ScanBounds['regionOrder']>;
  maxRegionBytes: number;
  maxTotalBytes: number;
  maxMatches: number;
}

export interface ScanPlanInput {
  profile: ScanRegionProfile;
  /**
   * Prior telemetry for this same attach, oldest-first, already filtered by
   * the orchestration layer to the current process instance (a fresh attach
   * always starts with an empty array — see `AdaptiveScanTelemetryStore`).
   */
  priorTelemetry: readonly ScanTelemetry[];
  /**
   * Set by the orchestration layer when it already determined prior telemetry
   * cannot be trusted (corrupt, stale beyond the session's own bound, or the
   * identity check failed) — forces a safe reference plan instead of reading
   * `priorTelemetry` for adaptive decisions. Keeping this an explicit input
   * (rather than an implicit fallback probe inside this module) is what keeps
   * `planAdaptiveScan` pure and deterministic.
   */
  forceFallbackReason?: 'TELEMETRY_STALE' | 'TELEMETRY_CORRUPT' | 'PROCESS_IDENTITY_MISMATCH';
}

// Tunable thresholds. Kept as named constants, not magic numbers, so the
// reasons above stay traceable to a specific measured cutoff.
const MODULE_HEAVY_FRACTION = 0.5;
const PRIVATE_HEAVY_FRACTION = 0.5;
const DEFAULT_MAX_REGION_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_MAX_MATCHES = 10_000;
const SMALL_CANDIDATE_THRESHOLD = 500;
// Deliberately below the default 10,000 maxMatches cap — a prior scan's
// resultCount can never exceed whatever maxMatches it ran with, so a
// threshold at or above that cap could never actually be reached and this
// branch would be dead code wearing a passing unit test.
const LARGE_CANDIDATE_THRESHOLD = 5_000;
const NARROWED_MAX_MATCHES = 2_000;
const HIGH_PARTIAL_READ_RATE = 0.1; // 10% of considered regions skipped/failed

/** Deterministic baseline: full coverage, OS enumeration order, no measurement-driven tuning. Used to prove adaptive mode preserves correctness (§9) and as the safe fallback (§15). */
export function planReferenceScan(reason: ScanPlanReason = 'REFERENCE_FALLBACK'): ScanPlan {
  return {
    strategy: 'REFERENCE_FULL',
    reasons: [reason],
    regionOrder: 'as_enumerated',
    maxRegionBytes: DEFAULT_MAX_REGION_BYTES,
    maxTotalBytes: DEFAULT_MAX_TOTAL_BYTES,
    maxMatches: DEFAULT_MAX_MATCHES,
  };
}

/**
 * The one function with real adaptive logic. Every branch is driven by a
 * measured field on `input.profile` or `input.priorTelemetry` — never by a
 * caller-supplied scan-type label (that would be the "static routing table
 * wearing an adaptive label" the mission spec explicitly forbids).
 */
export function planAdaptiveScan(input: ScanPlanInput): ScanPlan {
  if (input.forceFallbackReason) {
    return planReferenceScan('REFERENCE_FALLBACK');
  }

  const { profile } = input;
  const reasons: ScanPlanReason[] = [];
  let regionOrder: ScanPlan['regionOrder'] = 'as_enumerated';
  let maxRegionBytes = DEFAULT_MAX_REGION_BYTES;
  let maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES;
  let maxMatches = DEFAULT_MAX_MATCHES;
  let strategy: ScanStrategy;

  const latest = input.priorTelemetry.length > 0 ? input.priorTelemetry[input.priorTelemetry.length - 1] : undefined;

  if (!latest) {
    // Initial-scan adaptation (§12): no feedback yet, decide purely from the
    // measured memory-layout profile of this attach.
    reasons.push('NO_PRIOR_TELEMETRY');
    const moduleFraction = profile.eligibleBytes > 0 ? profile.moduleBackedBytes / profile.eligibleBytes : 0;
    const privateFraction = profile.eligibleBytes > 0 ? profile.privateBytes / profile.eligibleBytes : 0;

    if (moduleFraction >= MODULE_HEAVY_FRACTION) {
      strategy = 'PRIVATE_FIRST';
      regionOrder = 'private_first';
      reasons.push('MODULE_HEAVY_PROFILE');
    } else if (privateFraction >= PRIVATE_HEAVY_FRACTION) {
      strategy = 'PRIVATE_FIRST';
      regionOrder = 'private_first';
      reasons.push('PRIVATE_HEAVY_PROFILE');
    } else {
      strategy = 'BROAD_FULL';
      reasons.push('UNIFORM_PROFILE');
    }

    if (profile.largestRegionBytes > maxRegionBytes) {
      // A cap smaller than an actual eligible region would silently exclude
      // it — that is a completeness violation (§7), not an optimization.
      maxRegionBytes = profile.largestRegionBytes;
      reasons.push('LARGE_REGION_PROFILE');
    }
  } else {
    // Follow-up adaptation (§13): a prior scan in this attach measured real
    // outcomes (its own result count becomes the "prior candidate set" the
    // next plan reacts to) — use that, not the raw profile alone, to narrow
    // the next plan.
    if (latest.resultCount > 0 && latest.resultCount <= SMALL_CANDIDATE_THRESHOLD) {
      strategy = 'NARROWED_BY_PRIOR_CANDIDATES';
      regionOrder = 'private_first';
      maxTotalBytes = Math.max(latest.scannedBytes, 1);
      reasons.push('PRIOR_CANDIDATE_SET_SMALL');
    } else if (latest.resultCount >= LARGE_CANDIDATE_THRESHOLD) {
      strategy = 'LARGEST_FIRST';
      regionOrder = 'largest_first';
      maxMatches = NARROWED_MAX_MATCHES;
      reasons.push('PRIOR_CANDIDATE_SET_LARGE');
    } else {
      strategy = 'BROAD_FULL';
    }

    if (latest.regionsConsidered > 0) {
      const partialReadRate = (latest.partialReads + latest.failedReads) / latest.regionsConsidered;
      if (partialReadRate > HIGH_PARTIAL_READ_RATE) {
        maxRegionBytes = Math.max(1, Math.floor(maxRegionBytes / 2));
        reasons.push('HIGH_PARTIAL_READ_RATE');
      }
    }

    if (profile.largestRegionBytes > maxRegionBytes) {
      maxRegionBytes = profile.largestRegionBytes;
      if (!reasons.includes('LARGE_REGION_PROFILE')) reasons.push('LARGE_REGION_PROFILE');
    }
  }

  return { strategy, reasons, regionOrder, maxRegionBytes, maxTotalBytes, maxMatches };
}
