import type { CanonicalCompleteness, CanonicalSkippedRange } from './scanner-backend.js';
import type { LiveProcessHandle, MemoryDriver } from './types.js';

export interface AobPattern {
  /** `null` entries are wildcard bytes (`?`). */
  bytes: Array<number | null>;
}

const TOKEN_RE = /^(\?{1,2}|[0-9a-fA-F]{2})$/;

/**
 * Parse a hex AOB (array-of-bytes) pattern string into a byte pattern.
 * Example: "48 8B 05 ? ? ? ?"
 */
export function parseAobSignature(signature: string): AobPattern {
  const parts = signature.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    throw new Error('AOB signature is empty.');
  }

  const bytes = parts.map((part) => {
    if (!TOKEN_RE.test(part)) {
      throw new Error(`Invalid AOB token: ${part}`);
    }
    if (part.startsWith('?')) return null;
    return parseInt(part, 16);
  });

  return { bytes };
}

/**
 * Find the first occurrence of `pattern` in `haystack` starting at `startOffset`.
 * Returns byte offset or -1.
 */
export function findAobInBuffer(haystack: Buffer, pattern: AobPattern, startOffset = 0): number {
  const { bytes } = pattern;
  if (bytes.length === 0 || haystack.length < bytes.length) return -1;

  const limit = haystack.length - bytes.length;
  outer: for (let i = startOffset; i <= limit; i++) {
    for (let j = 0; j < bytes.length; j++) {
      const expected = bytes[j];
      if (expected !== null && haystack[i + j] !== expected) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}

export interface AobScanOptions {
  moduleName?: string;
}

function regionOverlapsModule(
  regionBase: bigint,
  regionSize: number,
  moduleBase: bigint,
  moduleSize: number,
): boolean {
  const regionEnd = regionBase + BigInt(regionSize);
  const moduleEnd = moduleBase + BigInt(moduleSize);
  return regionBase < moduleEnd && regionEnd > moduleBase;
}

/**
 * The truthful result of a legacy in-process AOB scan.
 *
 * `address === null` on its own has never been enough information: it means
 * "not found in the regions that were actually read", which is only the same
 * thing as "not present in this process" when every eligible region WAS read.
 * Before this was reported, `scanAobInProcess` returned a bare `bigint | null`
 * and swallowed every region read failure, so a signature sitting in a region
 * that exceeded memoryjs's 1 MiB `readBuffer` ceiling came back
 * indistinguishable from a signature that genuinely was not there — the
 * false-not-found half of D03/D04.
 */
export interface AobScanOutcome {
  address: bigint | null;
  /** Eligible regions that could not be read, and why. */
  skippedRegions: CanonicalSkippedRange[];
  /** Canonical completeness, same vocabulary as the scanner-backend contract. */
  completeness: CanonicalCompleteness;
  /** True iff nothing was found AND every eligible region was actually read. */
  isAuthoritativeAbsence: boolean;
  regionsConsidered: number;
  regionsRead: number;
}

/**
 * Scan committed process regions for an AOB pattern.
 * When `moduleName` is set, only regions overlapping that module are searched.
 */
export function scanAobInProcess(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  signature: string,
  options: AobScanOptions = {},
): AobScanOutcome {
  const pattern = parseAobSignature(signature);
  const regions = driver.getRegions(handle);
  const modules = options.moduleName
    ? driver.getModules(handle).filter((m) => m.name.toLowerCase() === options.moduleName!.toLowerCase())
    : [];

  const skippedRegions: CanonicalSkippedRange[] = [];
  let regionsConsidered = 0;
  let regionsRead = 0;

  const outcome = (address: bigint | null): AobScanOutcome => {
    const completeness: CanonicalCompleteness =
      skippedRegions.length > 0
        ? { state: 'complete_with_skipped_regions', skipped: [...skippedRegions] }
        : { state: 'complete' };
    return {
      address,
      skippedRegions: [...skippedRegions],
      completeness,
      isAuthoritativeAbsence: address === null && completeness.state === 'complete',
      regionsConsidered,
      regionsRead,
    };
  };

  for (const region of regions) {
    if (modules.length > 0) {
      const overlaps = modules.some((m) =>
        regionOverlapsModule(region.baseAddress, region.size, m.baseAddress, m.size),
      );
      // A region outside the requested module is not eligible, so passing over
      // it is not a coverage gap — unlike a read failure below.
      if (!overlaps) continue;
    }
    regionsConsidered += 1;

    try {
      const buffer = driver.readBuffer(handle, region.baseAddress, region.size);
      regionsRead += 1;
      const offset = findAobInBuffer(buffer, pattern);
      if (offset >= 0) {
        return outcome(region.baseAddress + BigInt(offset));
      }
    } catch (err) {
      skippedRegions.push({
        baseAddress: region.baseAddress,
        size: BigInt(region.size),
        reason: `region_read_failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
  }

  return outcome(null);
}
