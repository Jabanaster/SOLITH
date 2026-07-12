import type {
  LiveProcessHandle,
  LiveValueType,
  MemoryDriver,
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

export interface ScanResult {
  matches: ScanMatch[];
  regionsScanned: number;
  bytesScanned: number;
  /** True if the scan stopped early due to maxTotalBytes or maxMatches — results are a partial view. */
  truncated: boolean;
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
export interface UnknownScanSnapshot {
  regions: RegionSnapshot[];
  regionsScanned: number;
  bytesScanned: number;
  truncated: boolean;
}

function valueSize(dataType: LiveValueType): number {
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

function encodeValue(dataType: LiveValueType, value: number): Buffer {
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
 * Read-only regions are skipped — the only reason ResourceForge scans memory
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

  const regions = driver
    .getRegions(handle)
    .filter((r) => r.writable && r.size > 0 && r.size <= maxRegionBytes);

  const matches: ScanMatch[] = [];
  let bytesScanned = 0;
  let regionsScanned = 0;
  let truncated = false;

  for (const region of regions) {
    if (bytesScanned + region.size > maxTotalBytes) {
      truncated = true;
      break;
    }

    let buf: Buffer;
    try {
      buf = driver.readBuffer(handle, region.baseAddress, region.size);
    } catch {
      // Region became unreadable mid-scan (freed, protection changed) — skip it, don't abort the whole scan.
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
          truncated = true;
          break;
        }
      }
      searchOffset = found + 1;
    }

    if (truncated) break;
  }

  return { matches, regionsScanned, bytesScanned, truncated };
}

/**
 * Next scan: re-reads each address from a prior scan's candidate set (via
 * driver.readMemory, not a fresh region sweep — this is what makes narrowing
 * cheap) and keeps only the ones matching `comparison` against their own
 * previously observed value.
 *
 * Addresses that fail to read (freed, unmapped since the last scan) are
 * dropped rather than throwing, since that's the expected steady-state case
 * as a game's allocations change between scans.
 */
export function scanNext(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  dataType: LiveValueType,
  comparison: ScanComparison,
  previous: ScanMatch[],
): ScanMatch[] {
  const kept: ScanMatch[] = [];

  for (const prior of previous) {
    let current: number;
    try {
      current = driver.readMemory(handle, prior.address, dataType);
    } catch {
      continue;
    }

    if (matchesComparison(comparison, prior.value, current)) {
      kept.push({ address: prior.address, value: current });
    }
  }

  return kept;
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

  const regions = driver
    .getRegions(handle)
    .filter((r) => r.writable && r.size > 0 && r.size <= maxRegionBytes);

  const snapshot: RegionSnapshot[] = [];
  let bytesScanned = 0;
  let regionsScanned = 0;
  let truncated = false;

  for (const region of regions) {
    if (bytesScanned + region.size > maxTotalBytes) {
      truncated = true;
      break;
    }

    let buf: Buffer;
    try {
      buf = driver.readBuffer(handle, region.baseAddress, region.size);
    } catch {
      continue;
    }

    snapshot.push({ baseAddress: region.baseAddress, data: buf });
    bytesScanned += region.size;
    regionsScanned += 1;
  }

  return { regions: snapshot, regionsScanned, bytesScanned, truncated };
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
  let truncated = false;

  for (const region of snapshot.regions) {
    let current: Buffer;
    try {
      current = driver.readBuffer(handle, region.baseAddress, region.data.length);
    } catch {
      // Region freed/moved since the snapshot was taken — nothing left to compare here.
      continue;
    }

    const len = Math.min(current.length, region.data.length);
    for (let offset = 0; offset + step <= len; offset += step) {
      const previousValue = decodeValue(dataType, region.data, offset);
      const currentValue = decodeValue(dataType, current, offset);

      if (matchesComparison(comparison, previousValue, currentValue)) {
        matches.push({ address: region.baseAddress + BigInt(offset), value: currentValue });
        if (matches.length >= maxMatches) {
          truncated = true;
          break;
        }
      }
    }

    if (truncated) break;
  }

  return { matches, regionsScanned: snapshot.regionsScanned, bytesScanned: snapshot.bytesScanned, truncated };
}

export interface TypedScanResult {
  matches: TypedScanMatch[];
  regionsScanned: number;
  bytesScanned: number;
  truncated: boolean;
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
  let truncated = false;

  regionLoop: for (const region of snapshot.regions) {
    let current: Buffer;
    try {
      current = driver.readBuffer(handle, region.baseAddress, region.data.length);
    } catch {
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
            truncated = true;
            break regionLoop;
          }
        }
      }
    }
  }

  return { matches, regionsScanned: snapshot.regionsScanned, bytesScanned: snapshot.bytesScanned, truncated };
}
