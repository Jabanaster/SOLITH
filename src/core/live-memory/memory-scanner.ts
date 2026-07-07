import type {
  LiveProcessHandle,
  LiveValueType,
  MemoryDriver,
  ScanBounds,
  ScanComparison,
  ScanMatch,
} from './types.js';

const DEFAULT_MAX_REGION_BYTES = 64 * 1024 * 1024; // 64 MiB — skip pathologically large single mappings
// 2 GiB — bounds total scan time/memory per pass. Raised from an initial 512 MiB after real-machine
// testing against Stardew Valley.exe (a modest 2016 MonoGame/.NET title) showed its actual committed
// writable footprint is ~957 MiB, which a 512 MiB cap truncated before reaching the target value at
// all (0 matches instead of the correct 1). 2 GiB gives real headroom for larger/AAA titles; a scan of
// close to 1 GiB took ~2.2s in that test, so this remains bounded rather than unbounded.
const DEFAULT_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_MAX_MATCHES = 10_000; // keeps the result set usable; a real narrowing workflow needs far fewer

export interface ScanResult {
  matches: ScanMatch[];
  regionsScanned: number;
  bytesScanned: number;
  /** True if the scan stopped early due to maxTotalBytes or maxMatches — results are a partial view. */
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

/**
 * First scan: finds every aligned occurrence of `targetValue` across the
 * attached process's writable, committed memory regions.
 *
 * Read-only regions are skipped — the only reason ResourceForge scans memory
 * at all is to eventually write to a found address (mirrors Cheat Engine's
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
  }
}
