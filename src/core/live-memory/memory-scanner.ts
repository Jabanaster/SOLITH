import type { CanonicalCompleteness, CanonicalSkippedRange } from './scanner-backend.js';
import type {
  LiveProcessHandle,
  LiveValueType,
  MemoryDriver,
  MemoryRegion,
  ScanBounds,
  ScanComparison,
  ScanMatch,
  TypedScanMatch,
} from './types.js';

const DEFAULT_MAX_REGION_BYTES = 64 * 1024 * 1024; // 64 MiB — skip pathologically large single mappings
// 2 GiB — bounds total scan time/memory per pass. Raised from an initial 512 MiB after real-machine
// testing against Stardew Valley.exe (a modest 2016 MonoGame/.NET title) showed its actual committed
// writable footprint is ~957 MiB, which a 512 MiB cap truncated before reaching the target value at
// all (0 matches instead of the correct 1). 2 GiB gives real headroom for larger/AAA titles; a scan of
// close to 1 GiB took ~2.2s in that test, so this remains bounded rather than unbounded.
const DEFAULT_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_MAX_MATCHES = 10_000; // keeps the result set usable; a real narrowing workflow needs far fewer

// An unknown-value first scan holds every scanned region's raw bytes alive at once (needed to compare
// against on the next scan), not just a filtered match list — so its default budget is smaller than a
// known-value scanFirst's 2 GiB. 512 MiB is enough for a modest single-process footprint (see the
// Stardew Valley measurement above at ~957 MiB, admittedly close to this — callers scanning a AAA
// title's full space should pass an explicit larger maxTotalBytes and accept the added memory cost).
const DEFAULT_UNKNOWN_MAX_TOTAL_BYTES = 512 * 1024 * 1024;

/**
 * The one truth rule every scan in this module obeys (D01 final closure §2).
 *
 * An eligible region that could not be examined means the result is NOT
 * complete coverage of what was asked for — no matter which function was
 * called, and no matter whether any matches were found. Before this was
 * centralized, six sibling functions each answered that question differently
 * (`scanFirst`, `scanNext`, `scanFirstUnknown`, `scanNextFromSnapshot`,
 * `scanNextFromSnapshotMultiType`, `scanFirstByComparison` all did a bare
 * `catch { continue; }`), so an unreadable region produced a result that
 * claimed `truncated: false` and a zero-match result that read as an
 * authoritative "this value is not in the process".
 *
 * Rather than invent a parallel truth model, this reuses the canonical
 * `CanonicalCompleteness` states the scanner-backend contract already
 * defines, so a legacy scan result and a backend scan outcome answer
 * "was this complete?" in exactly the same vocabulary.
 */
export interface ScanCoverage {
  /**
   * Eligible regions that were skipped because they could not be read.
   * Empty when every eligible region was examined.
   */
  skippedRegions: CanonicalSkippedRange[];
  /** Canonical completeness — the same states the scanner-backend contract uses. */
  completeness: CanonicalCompleteness;
  /**
   * True iff the match set is empty AND coverage was genuinely complete.
   * A zero-match result with incomplete coverage is "not found here, so far",
   * never "not present".
   */
  isAuthoritativeAbsence: boolean;
}

export interface ScanResult extends ScanCoverage {
  matches: ScanMatch[];
  regionsScanned: number;
  bytesScanned: number;
  /**
   * True if the results do not represent complete coverage of the requested
   * scan — the scan stopped early due to maxTotalBytes or maxMatches, or an
   * eligible region could not be read and was skipped. Never claim
   * completeness when part of the requested range was not actually scanned.
   *
   * Kept as the single boolean summary for existing callers; `completeness`
   * carries the structured reason and `skippedRegions` the specific ranges.
   */
  truncated: boolean;
}

/**
 * A short, non-sensitive reason string for a region read that failed. Keeps the
 * driver's own message (which names the real cause — a protection change, a
 * freed mapping, memoryjs's 1 MiB `readBuffer` ceiling) instead of flattening
 * every failure into one opaque label.
 */
function readFailureReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `region_read_failed: ${message}`;
}

/**
 * Distinguishes "this process is gone" from "this one region could not be
 * read". Matched on the driver's own message text because `MemoryDriver` does
 * not carry typed error kinds; both the native driver and memoryjs surface
 * process exit as one of these.
 *
 * The distinction matters for truthfulness: a single unreadable region leaves
 * a scan complete-with-gaps and worth continuing, whereas a process that
 * exited mid-scan invalidates every remaining region, so continuing would
 * quietly manufacture "not found" answers about a process that no longer
 * exists.
 */
export function isProcessGoneError(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    message.includes('process_exited') ||
    message.includes('process exited') ||
    message.includes('process is not running') ||
    message.includes('invalid handle') ||
    message.includes('no such process')
  );
}

/**
 * Accumulates the coverage facts of one scan so every function in this module
 * reports them identically. Two distinct events are tracked, because
 * conflating them is what made the old `truncated` flag ambiguous:
 *
 * - `recordSkippedRegion` — an eligible region could not be examined. Coverage
 *   is no longer complete, but the scan should carry on to later regions.
 * - `recordStop` — the scan stopped before covering the requested space
 *   (byte budget, match cap, resource limit). The caller must break out.
 */
/**
 * Selects the regions a value scan is allowed to examine, and records the ones
 * excluded purely for exceeding `maxRegionBytes`.
 *
 * Those are eligible, writable regions the caller DID ask about; the bound is
 * a cost control, not a statement that they hold nothing. Filtering them out
 * silently is the same truth loss as a swallowed read failure — it just
 * happened one line earlier, before the `try`, which is why the original D01
 * audit did not catch it.
 *
 * A non-writable region is genuinely out of scope for a value scan (the whole
 * point is to find something writable), so excluding those is not a gap.
 */
export function selectScannableRegions(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  maxRegionBytes: number,
  coverage: ScanCoverageTracker,
  regionOrder?: ScanBounds['regionOrder'],
): ReturnType<MemoryDriver['getRegions']> {
  const all = driver.getRegions(handle);
  if (all.length === 0) {
    // A live process always has mapped regions, so an empty enumeration means
    // we could not see the target at all — in practice, that it has exited.
    //
    // This is the real signature of process exit on this platform, and it is
    // not the one you would guess: with a still-open handle, `readBuffer` and
    // `readMemory` against a dead process do NOT throw. They return garbage
    // bytes. Only `getRegions` reports it, by coming back empty. Without this
    // check a scan of a dead process loops zero times, finds nothing, and
    // reports a *complete* scan with an authoritative absence — a confident
    // "this value is not in the process" about a process that no longer
    // exists.
    coverage.recordStop({ state: 'failed', reason: 'no_regions_enumerated: the target reports no mapped memory' });
    return [];
  }
  const eligible: ReturnType<MemoryDriver['getRegions']> = [];
  for (const region of all) {
    if (!region.writable || region.size <= 0) continue;
    if (region.size > maxRegionBytes) {
      coverage.recordSkippedRegion(
        region.baseAddress,
        region.size,
        `region_exceeds_max_region_bytes: ${region.size} > ${maxRegionBytes}`,
      );
      continue;
    }
    eligible.push(region);
  }
  return orderEligibleRegions(eligible, regionOrder);
}

/**
 * P2-10 adaptive scan planner hook. Reorders (never filters) the already-
 * eligible region list. `Array#sort` is stable in the Node/V8 versions this
 * project targets, so regions tied on the sort key keep their original OS
 * enumeration order relative to each other — the reorder is deterministic for
 * a given `getRegions()` snapshot, which `planAdaptiveScan`'s determinism
 * contract depends on.
 */
function orderEligibleRegions(
  eligible: ReturnType<MemoryDriver['getRegions']>,
  regionOrder: ScanBounds['regionOrder'],
): ReturnType<MemoryDriver['getRegions']> {
  switch (regionOrder) {
    case 'module_first':
      return [...eligible].sort((a, b) => moduleRank(a) - moduleRank(b));
    case 'private_first':
      return [...eligible].sort((a, b) => privateRank(a) - privateRank(b));
    case 'largest_first':
      return [...eligible].sort((a, b) => b.size - a.size);
    case 'as_enumerated':
    case undefined:
    default:
      return eligible;
  }
}

function moduleRank(region: MemoryRegion): number {
  return region.regionType === 'image' ? 0 : 1;
}

function privateRank(region: MemoryRegion): number {
  return region.regionType === 'private' ? 0 : 1;
}

export class ScanCoverageTracker {
  private readonly skippedRanges: CanonicalSkippedRange[] = [];
  private stop: CanonicalCompleteness | null = null;

  recordSkippedRegion(baseAddress: bigint, size: number | bigint, reason: string): void {
    this.skippedRanges.push({ baseAddress, size: BigInt(size), reason });
  }

  recordStop(completeness: CanonicalCompleteness): void {
    // First stop wins — it is the one that actually ended the scan.
    this.stop ??= completeness;
  }

  recordResourceLimit(atByte: number | bigint): void {
    this.recordStop({ state: 'resource_limit', atByte: BigInt(atByte) });
  }

  recordProcessExited(atByte: number | bigint): void {
    this.recordStop({ state: 'process_exited', atByte: BigInt(atByte) });
  }

  recordCancelled(atByte: number | bigint): void {
    this.recordStop({ state: 'cancelled', atByte: BigInt(atByte) });
  }

  /**
   * Records a failed region read, promoting it to a terminal `process_exited`
   * stop when the driver says the process is gone. Returns true when the
   * caller must stop iterating.
   */
  recordReadFailure(baseAddress: bigint, size: number | bigint, bytesSoFar: number | bigint, err: unknown): boolean {
    if (isProcessGoneError(err)) {
      this.recordProcessExited(bytesSoFar);
      return true;
    }
    this.recordSkippedRegion(baseAddress, size, readFailureReason(err));
    return false;
  }

  /**
   * Folds an upstream result's coverage into this one. A scan derived from an
   * incomplete snapshot can never be more complete than the snapshot it was
   * derived from — which `scanNextFromSnapshot` and
   * `scanNextFromSnapshotMultiType` previously got wrong by reporting only
   * their own `truncated` and discarding the snapshot's.
   */
  inherit(upstream: ScanCoverage): void {
    for (const range of upstream.skippedRegions) this.skippedRanges.push(range);
    if (upstream.completeness.state !== 'complete' && upstream.completeness.state !== 'complete_with_skipped_regions') {
      this.recordStop(upstream.completeness);
    }
  }

  /** True once the scan stopped early; the caller must stop iterating regions. */
  get stoppedEarly(): boolean {
    return this.stop !== null;
  }

  get truncated(): boolean {
    return this.stop !== null || this.skippedRanges.length > 0;
  }

  /**
   * Coverage for a result that makes no presence/absence claim at all (an
   * unknown-value baseline snapshot captures bytes; it does not search for
   * anything), so `isAuthoritativeAbsence` is always false.
   */
  coverageWithoutAbsenceClaim(): ScanCoverage {
    return { ...this.coverage(0), isAuthoritativeAbsence: false };
  }

  coverage(matchCount: number): ScanCoverage {
    const completeness: CanonicalCompleteness =
      this.stop ??
      (this.skippedRanges.length > 0
        ? { state: 'complete_with_skipped_regions', skipped: [...this.skippedRanges] }
        : { state: 'complete' });
    return {
      skippedRegions: [...this.skippedRanges],
      completeness,
      isAuthoritativeAbsence: matchCount === 0 && completeness.state === 'complete',
    };
  }
}

interface RegionSnapshot {
  baseAddress: bigint;
  data: Buffer;
}

/**
 * Opaque handle returned by scanFirstUnknown, consumed by scanNextFromSnapshot.
 * Holds raw region bytes (not decoded values) so the same snapshot can be
 * compared against any LiveValueType interpretation later, and so building it
 * doesn't require allocating one JS object per candidate the way an
 * enumerate-every-value first scan would (that would be hundreds of millions
 * of objects for a 512 MiB+ region set).
 */
export interface UnknownScanSnapshot extends ScanCoverage {
  regions: RegionSnapshot[];
  regionsScanned: number;
  bytesScanned: number;
  truncated: boolean;
}

export function valueSize(dataType: LiveValueType): number {
  switch (dataType) {
    case 'byte':
      return 1;
    case 'int32':
    case 'uint32':
    case 'float':
      return 4;
    case 'double':
    case 'int64':
      return 8;
  }
}

export function encodeValue(dataType: LiveValueType, value: number): Buffer {
  const buf = Buffer.alloc(valueSize(dataType));
  switch (dataType) {
    case 'byte':
      buf.writeUInt8(value, 0);
      break;
    case 'int32':
      buf.writeInt32LE(value, 0);
      break;
    case 'uint32':
      buf.writeUInt32LE(value, 0);
      break;
    case 'float':
      buf.writeFloatLE(value, 0);
      break;
    case 'double':
      buf.writeDoubleLE(value, 0);
      break;
    case 'int64':
      buf.writeBigInt64LE(BigInt(value), 0);
      break;
  }
  return buf;
}

function decodeValue(dataType: LiveValueType, buf: Buffer, offset: number): number {
  switch (dataType) {
    case 'byte':
      return buf.readUInt8(offset);
    case 'int32':
      return buf.readInt32LE(offset);
    case 'uint32':
      return buf.readUInt32LE(offset);
    case 'float':
      return buf.readFloatLE(offset);
    case 'double':
      return buf.readDoubleLE(offset);
    case 'int64':
      return Number(buf.readBigInt64LE(offset));
  }
}

/**
 * First scan: finds every aligned occurrence of `targetValue` across the
 * attached process's writable, committed memory regions.
 *
 * Read-only regions are skipped — the only reason Solith scans memory
 * at all is to eventually write to a found address (mirrors classic memory-scanner
 * "value scan" step, but scoped from the start to writable candidates so the
 * result set is never full of addresses a later write would just fail on).
 *
 * Bounded by region size, total bytes scanned, and match count so a single
 * scan can't hang the Electron main process against a modern game's full
 * address space. `truncated: true` means the caller is looking at a partial
 * view, not the complete match set — surface that to the user rather than
 * silently returning an incomplete list as if it were exhaustive.
 */
export function scanFirst(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  dataType: LiveValueType,
  targetValue: number,
  bounds?: ScanBounds,
): ScanResult {
  const maxRegionBytes = bounds?.maxRegionBytes ?? DEFAULT_MAX_REGION_BYTES;
  const maxTotalBytes = bounds?.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const maxMatches = bounds?.maxMatches ?? DEFAULT_MAX_MATCHES;

  const needle = encodeValue(dataType, targetValue);
  const step = needle.length;

  const coverage = new ScanCoverageTracker();
  const regions = selectScannableRegions(driver, handle, maxRegionBytes, coverage, bounds?.regionOrder);

  const matches: ScanMatch[] = [];
  let bytesScanned = 0;
  let regionsScanned = 0;

  for (const region of regions) {
    if (bounds?.signal?.aborted) {
      coverage.recordCancelled(bytesScanned);
      break;
    }
    if (bytesScanned + region.size > maxTotalBytes) {
      coverage.recordResourceLimit(bytesScanned);
      break;
    }

    let buf: Buffer;
    try {
      buf = driver.readBuffer(handle, region.baseAddress, region.size);
    } catch (err) {
      // Region became unreadable mid-scan (freed, protection changed) — skip it
      // and keep scanning later regions, but the requested address space is no
      // longer fully covered, so record it rather than claiming completeness.
      // A process that exited is different: every remaining region is moot.
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
        if (matches.length >= maxMatches) {
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

/**
 * First scan for every aligned cell whose decoded value lies in `[min, max]`
 * (inclusive). Use for HUD rounding ambiguity (e.g. displayed 61 may be
 * 60.7–61.3 in memory) without committing to a single exact bit pattern.
 *
 * Same region / byte / match bounds as {@link scanFirst}. Read-only.
 */
export function scanFirstRange(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  dataType: LiveValueType,
  min: number,
  max: number,
  bounds?: ScanBounds,
): ScanResult {
  if (!(min <= max)) {
    throw new Error(`scanFirstRange requires min <= max (got min=${min}, max=${max})`);
  }

  const maxRegionBytes = bounds?.maxRegionBytes ?? DEFAULT_MAX_REGION_BYTES;
  const maxTotalBytes = bounds?.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const maxMatches = bounds?.maxMatches ?? DEFAULT_MAX_MATCHES;
  const step = valueSize(dataType);

  const coverage = new ScanCoverageTracker();
  const regions = selectScannableRegions(driver, handle, maxRegionBytes, coverage);

  const matches: ScanMatch[] = [];
  let bytesScanned = 0;
  let regionsScanned = 0;

  for (const region of regions) {
    if (bounds?.signal?.aborted) {
      coverage.recordCancelled(bytesScanned);
      break;
    }
    if (bytesScanned + region.size > maxTotalBytes) {
      coverage.recordResourceLimit(bytesScanned);
      break;
    }

    let buf: Buffer;
    try {
      buf = driver.readBuffer(handle, region.baseAddress, region.size);
    } catch (err) {
      // Region became unreadable mid-scan (freed, protection changed). Skip it and
      // keep scanning later regions, but the requested address space is no longer
      // fully covered — coverage must reflect that rather than claim completeness.
      if (coverage.recordReadFailure(region.baseAddress, region.size, bytesScanned, err)) break;
      continue;
    }

    bytesScanned += region.size;
    regionsScanned += 1;

    for (let offset = 0; offset + step <= buf.length; offset += step) {
      const value = decodeValue(dataType, buf, offset);
      if (value >= min && value <= max && Number.isFinite(value)) {
        matches.push({ address: region.baseAddress + BigInt(offset), value });
        if (matches.length >= maxMatches) {
          coverage.recordResourceLimit(bytesScanned);
          break;
        }
      }
    }

    // Only a stop (byte budget / match cap) ends the sweep. A skipped region
    // must not: the pre-existing `if (truncated) break` here conflated the two,
    // so a single unreadable region silently aborted the scan one region later
    // while still reporting the regions after it as simply absent.
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

/**
 * Next scan: re-reads each address from a prior scan's candidate set (via
 * driver.readMemory, not a fresh region sweep — this is what makes narrowing
 * cheap) and keeps only the ones matching `comparison` against their own
 * previously observed value.
 *
 * Addresses that fail to read (freed, unmapped since the last scan) are
 * dropped rather than throwing, since that's the expected steady-state case
 * as a game's allocations change between scans — but they are reported as
 * skipped rather than silently conflated with "this candidate did not match".
 * Those are different facts: an unreadable candidate may still hold the value
 * the user is hunting, so narrowing to zero survivors after one or more
 * unreadable candidates is not an authoritative "the value is gone".
 */
export interface NextScanResult extends ScanCoverage {
  matches: ScanMatch[];
  /** How many prior candidates were examined. */
  candidatesConsidered: number;
  /** How many prior candidates could not be re-read and were therefore not evaluated. */
  candidatesUnreadable: number;
  truncated: boolean;
}

export function scanNext(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  dataType: LiveValueType,
  comparison: ScanComparison,
  previous: ScanMatch[],
): NextScanResult {
  const kept: ScanMatch[] = [];
  const coverage = new ScanCoverageTracker();
  let candidatesUnreadable = 0;

  for (const prior of previous) {
    let current: number;
    try {
      current = driver.readMemory(handle, prior.address, dataType);
    } catch (err) {
      candidatesUnreadable += 1;
      if (coverage.recordReadFailure(prior.address, valueSize(dataType), 0, err)) break;
      continue;
    }

    if (matchesComparison(comparison, prior.value, current)) {
      kept.push({ address: prior.address, value: current });
    }
  }

  return {
    matches: kept,
    candidatesConsidered: previous.length,
    candidatesUnreadable,
    truncated: coverage.truncated,
    ...coverage.coverage(kept.length),
  };
}

// Tolerance for the delta-based comparisons (increasedBy/decreasedBy) — a computed
// currentValue - previousValue on floats rarely lands on an exact bit-identical delta
// (e.g. 100.0 - 12.3 may not equal 87.7 exactly), so these need a small epsilon rather
// than strict equality. 'exact' intentionally stays strict equality: it's matched against
// a user-typed target value read straight off a visible HUD number, not a computed delta.
const DELTA_EPSILON = 1e-4;

function matchesComparison(comparison: ScanComparison, previousValue: number, currentValue: number): boolean {
  switch (comparison.kind) {
    case 'exact':
      return currentValue === comparison.value;
    case 'changed':
      return currentValue !== previousValue;
    case 'unchanged':
      return currentValue === previousValue;
    case 'increased':
      return currentValue > previousValue;
    case 'decreased':
      return currentValue < previousValue;
    case 'increasedBy':
      return Math.abs(currentValue - previousValue - comparison.value) < DELTA_EPSILON;
    case 'decreasedBy':
      return Math.abs(previousValue - currentValue - comparison.value) < DELTA_EPSILON;
    case 'greaterThan':
      return currentValue > comparison.value;
    case 'lessThan':
      return currentValue < comparison.value;
    case 'between':
      return currentValue >= comparison.min && currentValue <= comparison.max;
  }
}

/**
 * "Unknown initial value" first scan — standard memory-researcher
 * technique for finding a stat that has no visible on-screen number (a bar,
 * a percentage with no digits, an internal cooldown, etc.). Instead of
 * searching for one target value, this captures the raw bytes of every
 * writable, committed region as a baseline snapshot. Nothing is filtered or
 * interpreted as any particular data type yet — that happens in
 * scanNextFromSnapshot, once the caller has provoked a real change (taken
 * damage, spent stamina) and knows which direction the value moved.
 *
 * Bounded by DEFAULT_UNKNOWN_MAX_TOTAL_BYTES rather than scanFirst's larger
 * 2 GiB default, since this keeps the actual scanned bytes resident (as
 * Buffers) rather than only the addresses of confirmed matches.
 */
export function scanFirstUnknown(driver: MemoryDriver, handle: LiveProcessHandle, bounds?: ScanBounds): UnknownScanSnapshot {
  const maxRegionBytes = bounds?.maxRegionBytes ?? DEFAULT_MAX_REGION_BYTES;
  const maxTotalBytes = bounds?.maxTotalBytes ?? DEFAULT_UNKNOWN_MAX_TOTAL_BYTES;

  const coverage = new ScanCoverageTracker();
  const regions = selectScannableRegions(driver, handle, maxRegionBytes, coverage);

  const snapshot: RegionSnapshot[] = [];
  let bytesScanned = 0;
  let regionsScanned = 0;

  for (const region of regions) {
    if (bounds?.signal?.aborted) {
      coverage.recordCancelled(bytesScanned);
      break;
    }
    if (bytesScanned + region.size > maxTotalBytes) {
      coverage.recordResourceLimit(bytesScanned);
      break;
    }

    let buf: Buffer;
    try {
      buf = driver.readBuffer(handle, region.baseAddress, region.size);
    } catch (err) {
      // A region missing from the baseline is a region every later narrowing
      // round is blind to, so the snapshot must carry that gap forward.
      if (coverage.recordReadFailure(region.baseAddress, region.size, bytesScanned, err)) break;
      continue;
    }

    // Copy the bytes into an immutable baseline. Some drivers/test fakes may
    // return a view into an underlying region buffer; an unknown-value scan is
    // only meaningful if later game changes cannot mutate the saved baseline.
    snapshot.push({ baseAddress: region.baseAddress, data: Buffer.from(buf) });
    bytesScanned += region.size;
    regionsScanned += 1;
  }

  return {
    regions: snapshot,
    regionsScanned,
    bytesScanned,
    truncated: coverage.truncated,
    ...coverage.coverageWithoutAbsenceClaim(),
  };
}

/**
 * Consumes a snapshot from scanFirstUnknown: re-reads the same regions right
 * now and keeps every aligned cell whose value satisfies `comparison`
 * against its baseline value — e.g. `{kind: 'decreased'}` after the player
 * took damage. This is where the real filtering happens; a snapshot with no
 * prior knowledge of the target typically narrows from "every writable byte"
 * to a few thousand candidates in this first real-scan step, then the
 * existing scanNext()/exact-comparison flow takes over from there using the
 * returned matches as its `previous` set — this function is meant to be
 * called exactly once per snapshot.
 */
export function scanNextFromSnapshot(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  dataType: LiveValueType,
  comparison: ScanComparison,
  snapshot: UnknownScanSnapshot,
  bounds?: ScanBounds,
): ScanResult {
  const step = valueSize(dataType);
  const maxMatches = bounds?.maxMatches ?? DEFAULT_MAX_MATCHES;

  const matches: ScanMatch[] = [];
  const coverage = new ScanCoverageTracker();
  // A narrowing pass can never be more complete than the baseline it narrows.
  coverage.inherit(snapshot);

  for (const region of snapshot.regions) {
    if (bounds?.signal?.aborted) {
      coverage.recordCancelled(snapshot.bytesScanned);
      break;
    }
    let current: Buffer;
    try {
      current = driver.readBuffer(handle, region.baseAddress, region.data.length);
    } catch (err) {
      // Region freed/moved since the snapshot was taken — nothing left to
      // compare here, so this slice of the baseline goes unevaluated.
      if (coverage.recordReadFailure(region.baseAddress, region.data.length, snapshot.bytesScanned, err)) break;
      continue;
    }

    const len = Math.min(current.length, region.data.length);
    for (let offset = 0; offset + step <= len; offset += step) {
      const previousValue = decodeValue(dataType, region.data, offset);
      const currentValue = decodeValue(dataType, current, offset);

      if (matchesComparison(comparison, previousValue, currentValue)) {
        matches.push({ address: region.baseAddress + BigInt(offset), value: currentValue });
        if (matches.length >= maxMatches) {
          coverage.recordResourceLimit(snapshot.bytesScanned);
          break;
        }
      }
    }

    if (coverage.stoppedEarly) break;
  }

  return {
    matches,
    regionsScanned: snapshot.regionsScanned,
    bytesScanned: snapshot.bytesScanned,
    truncated: coverage.truncated,
    ...coverage.coverage(matches.length),
  };
}

export interface TypedScanResult extends ScanCoverage {
  matches: TypedScanMatch[];
  regionsScanned: number;
  bytesScanned: number;
  truncated: boolean;
}

export const ALL_SCAN_VALUE_TYPES: LiveValueType[] = ['byte', 'int32', 'uint32', 'float', 'double', 'int64'];

export type AutoFirstScanMode = 'exact' | 'between' | 'greaterThan' | 'lessThan';

export interface AutoFirstScanQuery {
  /** Visible/HUD value used by exact, greaterThan, and lessThan modes. */
  value?: number;
  /** Inclusive lower bound used by between mode. */
  min?: number;
  /** Inclusive upper bound used by between mode. */
  max?: number;
  /** Defaults to every numeric memory type Solith supports. */
  dataTypes?: LiveValueType[];
  /** Defaults to exact, between, greaterThan, and lessThan when inputs permit them. */
  modes?: AutoFirstScanMode[];
  /** Capture one raw unknown-value baseline in the same manual scan action. */
  includeUnknown?: boolean;
  bounds?: ScanBounds;
  unknownBounds?: ScanBounds;
}

export interface AutoFirstScanBucket extends ScanCoverage {
  mode: AutoFirstScanMode;
  dataType: LiveValueType;
  matches: TypedScanMatch[];
  regionsScanned: number;
  bytesScanned: number;
  truncated: boolean;
  skipped?: false;
}

export interface AutoFirstScanSkippedBucket extends ScanCoverage {
  mode: AutoFirstScanMode;
  dataType: LiveValueType;
  matches: [];
  regionsScanned: 0;
  bytesScanned: 0;
  truncated: false;
  skipped: true;
  reason: string;
}

export interface AutoFirstUnknownScanSummary extends ScanCoverage {
  regionsScanned: number;
  bytesScanned: number;
  truncated: boolean;
  snapshot: UnknownScanSnapshot;
}

export interface AutoFirstScanMatrixResult {
  buckets: Array<AutoFirstScanBucket | AutoFirstScanSkippedBucket>;
  unknown?: AutoFirstUnknownScanSummary;
  totals: {
    buckets: number;
    matches: number;
    regionsScanned: number;
    bytesScanned: number;
    truncatedBuckets: number;
    skippedBuckets: number;
    unknownCaptured: boolean;
  };
  readOnly: true;
  executable: false;
}

/**
 * Same idea as scanNextFromSnapshot, but tries every dataType in `dataTypes`
 * at each offset instead of committing to one interpretation upfront — the
 * Multi-type "All" scan equivalent. A bar with no visible number could
 * be stored as int32, float, or double; guessing wrong (as this project
 * initially did for Undisputed, assuming int32 for what turned out to be a
 * float) converges on a false-positive address that happens to match the
 * comparison pattern by coincidence but doesn't hold when written to.
 * Scanning all plausible types at once and letting the caller pick from the
 * survivors (see the Watch Live panel) is far more reliable.
 *
 * NaN/non-finite decodes are dropped — arbitrary bytes frequently produce NaN
 * when read as float/double, which is never a meaningful game stat and would
 * otherwise multiply the candidate count with pure noise.
 */
export function scanNextFromSnapshotMultiType(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  dataTypes: LiveValueType[],
  comparison: ScanComparison,
  snapshot: UnknownScanSnapshot,
  bounds?: ScanBounds,
): TypedScanResult {
  const maxMatches = bounds?.maxMatches ?? DEFAULT_MAX_MATCHES;
  const matches: TypedScanMatch[] = [];
  const coverage = new ScanCoverageTracker();
  // Same rule as scanNextFromSnapshot: inherit the baseline's own coverage.
  coverage.inherit(snapshot);

  regionLoop: for (const region of snapshot.regions) {
    if (bounds?.signal?.aborted) {
      coverage.recordCancelled(snapshot.bytesScanned);
      break;
    }
    let current: Buffer;
    try {
      current = driver.readBuffer(handle, region.baseAddress, region.data.length);
    } catch (err) {
      if (coverage.recordReadFailure(region.baseAddress, region.data.length, snapshot.bytesScanned, err)) {
        break regionLoop;
      }
      continue;
    }
    const len = Math.min(current.length, region.data.length);

    for (const dataType of dataTypes) {
      const step = valueSize(dataType);
      for (let offset = 0; offset + step <= len; offset += step) {
        const previousValue = decodeValue(dataType, region.data, offset);
        const currentValue = decodeValue(dataType, current, offset);

        if (!Number.isFinite(previousValue) || !Number.isFinite(currentValue)) continue;

        if (matchesComparison(comparison, previousValue, currentValue)) {
          matches.push({ address: region.baseAddress + BigInt(offset), value: currentValue, dataType });
          if (matches.length >= maxMatches) {
            coverage.recordResourceLimit(snapshot.bytesScanned);
            break regionLoop;
          }
        }
      }
    }
  }

  return {
    matches,
    regionsScanned: snapshot.regionsScanned,
    bytesScanned: snapshot.bytesScanned,
    truncated: coverage.truncated,
    ...coverage.coverage(matches.length),
  };
}

function firstScanComparisonForMode(mode: AutoFirstScanMode, query: AutoFirstScanQuery): ScanComparison | string {
  switch (mode) {
    case 'exact':
      return typeof query.value === 'number' ? { kind: 'exact', value: query.value } : 'exact mode requires value.';
    case 'greaterThan':
      return typeof query.value === 'number'
        ? { kind: 'greaterThan', value: query.value }
        : 'greaterThan mode requires value.';
    case 'lessThan':
      return typeof query.value === 'number'
        ? { kind: 'lessThan', value: query.value }
        : 'lessThan mode requires value.';
    case 'between':
      return typeof query.min === 'number' && typeof query.max === 'number'
        ? { kind: 'between', min: query.min, max: query.max }
        : 'between mode requires min and max.';
  }
}

function scanFirstByComparison(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  dataType: LiveValueType,
  comparison: ScanComparison,
  bounds?: ScanBounds,
): ScanResult {
  const maxRegionBytes = bounds?.maxRegionBytes ?? DEFAULT_MAX_REGION_BYTES;
  const maxTotalBytes = bounds?.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const maxMatches = bounds?.maxMatches ?? DEFAULT_MAX_MATCHES;
  const step = valueSize(dataType);

  const coverage = new ScanCoverageTracker();
  const regions = selectScannableRegions(driver, handle, maxRegionBytes, coverage);

  const matches: ScanMatch[] = [];
  let bytesScanned = 0;
  let regionsScanned = 0;

  for (const region of regions) {
    if (bounds?.signal?.aborted) {
      coverage.recordCancelled(bytesScanned);
      break;
    }
    if (bytesScanned + region.size > maxTotalBytes) {
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

    for (let offset = 0; offset + step <= buf.length; offset += step) {
      const value = decodeValue(dataType, buf, offset);
      if (!Number.isFinite(value)) continue;
      if (matchesComparison(comparison, value, value)) {
        matches.push({ address: region.baseAddress + BigInt(offset), value });
        if (matches.length >= maxMatches) {
          coverage.recordResourceLimit(bytesScanned);
          break;
        }
      }
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

/**
 * Automatic first-pass manual scan matrix. This is the Solith UX-friendly
 * alternative to a Cheat Engine-style "pick one scan type + one value type"
 * dropdown. A single user scan can fan out across all supported value types
 * and all compatible first-scan modes, while also capturing one unknown-value
 * snapshot for later changed/increased/decreased narrowing.
 *
 * Read-only. It only reads writable committed regions and returns inert
 * candidates tagged with the interpretation that produced them.
 */
export function scanFirstAutoMatrix(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  query: AutoFirstScanQuery = {},
): AutoFirstScanMatrixResult {
  const dataTypes = query.dataTypes ?? ALL_SCAN_VALUE_TYPES;
  const modes = query.modes ?? ['exact', 'between', 'greaterThan', 'lessThan'];
  const buckets: AutoFirstScanMatrixResult['buckets'] = [];

  for (const mode of modes) {
    const comparison = firstScanComparisonForMode(mode, query);
    for (const dataType of dataTypes) {
      if (typeof comparison === 'string') {
        buckets.push({
          mode,
          dataType,
          matches: [],
          regionsScanned: 0,
          bytesScanned: 0,
          truncated: false,
          skipped: true,
          reason: comparison,
          // A skipped bucket never scanned anything, so it claims no coverage
          // at all — reporting `complete` here would let an incompatible
          // mode/type pair read as a proven absence.
          skippedRegions: [],
          completeness: { state: 'failed', reason: comparison },
          isAuthoritativeAbsence: false,
        });
        continue;
      }

      const result = scanFirstByComparison(driver, handle, dataType, comparison, query.bounds);
      buckets.push({
        mode,
        dataType,
        matches: result.matches.map((match) => ({ ...match, dataType })),
        regionsScanned: result.regionsScanned,
        bytesScanned: result.bytesScanned,
        truncated: result.truncated,
        skippedRegions: result.skippedRegions,
        completeness: result.completeness,
        isAuthoritativeAbsence: result.isAuthoritativeAbsence,
      });
    }
  }

  const unknownSnapshot = query.includeUnknown
    ? scanFirstUnknown(driver, handle, query.unknownBounds ?? query.bounds)
    : undefined;

  return {
    buckets,
    ...(unknownSnapshot
      ? {
          unknown: {
            regionsScanned: unknownSnapshot.regionsScanned,
            bytesScanned: unknownSnapshot.bytesScanned,
            truncated: unknownSnapshot.truncated,
            skippedRegions: unknownSnapshot.skippedRegions,
            completeness: unknownSnapshot.completeness,
            isAuthoritativeAbsence: unknownSnapshot.isAuthoritativeAbsence,
            snapshot: unknownSnapshot,
          },
        }
      : {}),
    totals: {
      buckets: buckets.length,
      matches: buckets.reduce((count, bucket) => count + bucket.matches.length, 0),
      regionsScanned: buckets.reduce((count, bucket) => count + bucket.regionsScanned, 0),
      bytesScanned: buckets.reduce((count, bucket) => count + bucket.bytesScanned, 0),
      truncatedBuckets: buckets.filter((bucket) => bucket.truncated).length,
      skippedBuckets: buckets.filter((bucket) => bucket.skipped).length,
      unknownCaptured: Boolean(unknownSnapshot),
    },
    readOnly: true,
    executable: false,
  };
}
