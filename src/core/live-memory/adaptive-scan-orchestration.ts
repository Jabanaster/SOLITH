import {
  ScanCoverageTracker,
  encodeValue,
  selectScannableRegions,
  valueSize,
  type ScanResult,
} from './memory-scanner.js';
import {
  buildScanRegionProfile,
  planAdaptiveScan,
  planReferenceScan,
  type ScanPlan,
  type ScanTelemetry,
} from './adaptive-scan-planner.js';
import type { AdaptiveScanTelemetryStore } from './adaptive-scan-telemetry-store.js';
import type { LiveProcessHandle, LiveValueType, MemoryDriver, ScanMatch } from './types.js';

/**
 * P2-10 — impure orchestration layer. This is the only module that measures
 * a live region profile, calls the clock, executes a plan against real
 * process memory, and records the outcome. `adaptive-scan-planner.ts` stays
 * pure; this module carries its decisions out and feeds results back.
 *
 * The scan loop below intentionally mirrors `scanFirst`'s own per-region
 * matching rule (same `encodeValue`/`valueSize` encoding, same aligned-offset
 * `indexOf` search, same region-eligibility rule via the exported
 * `selectScannableRegions`/`ScanCoverageTracker`) so "semantic correctness"
 * (§6) stays identical to the canonical scanner — the only thing this loop
 * adds is control over which eligible region is read *next*, plus a real
 * `await` between regions. `scanFirst` itself has no such yield point (it is
 * one synchronous call across every region), so it cannot be interrupted
 * once started — this loop genuinely can be, which is what makes real
 * mid-scan cancellation (§17) possible for a planned scan, not just a
 * pre-flight cancel check.
 */
export interface AdaptiveScanOutcome {
  plan: ScanPlan;
  result: ScanResult;
  telemetry: ScanTelemetry;
}

export interface RunPlannedScanOptions {
  /** 'adaptive' (default) consults profile + prior telemetry; 'reference' always runs the deterministic baseline plan — used for the §9 correctness comparison. */
  mode?: 'adaptive' | 'reference';
  signal?: { aborted: boolean };
  /** Forces a safe fallback plan regardless of mode — set by the caller when it already knows telemetry can't be trusted (§15). */
  forceFallbackReason?: 'TELEMETRY_STALE' | 'TELEMETRY_CORRUPT' | 'PROCESS_IDENTITY_MISMATCH';
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Measures the current region profile, asks the planner for a plan (adaptive
 * or reference), executes it region-by-region (yielding between regions so a
 * concurrent `signal.aborted = true` genuinely interrupts a run in progress),
 * times it, and records real telemetry into `store` for the next call in this
 * same attach to consume.
 */
export async function runPlannedScan(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  dataType: LiveValueType,
  targetValue: number,
  store: AdaptiveScanTelemetryStore,
  options: RunPlannedScanOptions = {},
): Promise<AdaptiveScanOutcome> {
  const regions = driver.getRegions(handle);
  const profile = buildScanRegionProfile(regions);
  const priorTelemetry = store.list();

  const plan =
    options.mode === 'reference'
      ? planReferenceScan()
      : planAdaptiveScan({ profile, priorTelemetry, forceFallbackReason: options.forceFallbackReason });

  const startedAt = Date.now();
  const result = await executePlannedScan(driver, handle, dataType, targetValue, plan, options.signal);
  const elapsedMillis = Date.now() - startedAt;

  // Both counts are derived from the real reason strings `memory-scanner.ts`
  // already attaches to each skipped region (see `readFailureReason` and the
  // `region_exceeds_max_region_bytes` literal in `selectScannableRegions`) —
  // never a manufactured/placeholder value.
  const partialReads = result.skippedRegions.filter((r) => r.reason.startsWith('region_exceeds_max_region_bytes')).length;
  const failedReads = result.skippedRegions.filter((r) => r.reason.startsWith('region_read_failed')).length;

  const telemetry: ScanTelemetry = {
    strategy: plan.strategy,
    regionsConsidered: profile.eligibleRegions,
    regionsScanned: result.regionsScanned,
    regionsSkipped: result.skippedRegions.length,
    eligibleBytes: profile.eligibleBytes,
    scannedBytes: result.bytesScanned,
    elapsedMillis,
    resultCount: result.matches.length,
    coverage: result.completeness.state,
    partialReads,
    failedReads,
    cancelled: result.completeness.state === 'cancelled',
    recordedAt: Date.now(),
  };

  store.record(telemetry);

  return { plan, result, telemetry };
}

async function executePlannedScan(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  dataType: LiveValueType,
  targetValue: number,
  plan: ScanPlan,
  signal?: { aborted: boolean },
): Promise<ScanResult> {
  const needle = encodeValue(dataType, targetValue);
  const step = needle.length;

  const coverage = new ScanCoverageTracker();
  const regions = selectScannableRegions(driver, handle, plan.maxRegionBytes, coverage, plan.regionOrder);

  const matches: ScanMatch[] = [];
  let bytesScanned = 0;
  let regionsScanned = 0;
  let firstRegion = true;

  for (const region of regions) {
    // Real yield point between regions (not before the first one, so a
    // single-region scan behaves identically to `scanFirst`) — this is what
    // lets a cancel requested from another IPC call actually land mid-scan.
    if (!firstRegion) await yieldToEventLoop();
    firstRegion = false;

    if (signal?.aborted) {
      coverage.recordCancelled(bytesScanned);
      break;
    }
    if (bytesScanned + region.size > plan.maxTotalBytes) {
      coverage.recordResourceLimit(bytesScanned);
      break;
    }

    let buf: Buffer;
    try {
      buf = driver.readBuffer(handle, region.baseAddress, region.size);
    } catch (err) {
      if (coverage.recordReadFailure(region.baseAddress, region.size, bytesScanned, err)) break;
      continue;
    }

    bytesScanned += region.size;
    regionsScanned += 1;

    let searchOffset = 0;
    while (true) {
      const found = buf.indexOf(needle, searchOffset);
      if (found === -1) break;
      if (found % step === 0) {
        matches.push({ address: region.baseAddress + BigInt(found), value: targetValue });
        if (matches.length >= plan.maxMatches) {
          coverage.recordResourceLimit(bytesScanned);
          break;
        }
      }
      searchOffset = found + 1;
    }

    if (coverage.stoppedEarly) break;
  }

  return {
    matches,
    regionsScanned,
    bytesScanned,
    truncated: coverage.truncated,
    ...coverage.coverage(matches.length),
  };
}
