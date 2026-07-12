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
 * Scan committed process regions for an AOB pattern.
 * When `moduleName` is set, only regions overlapping that module are searched.
 */
export function scanAobInProcess(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  signature: string,
  options: AobScanOptions = {},
): bigint | null {
  const pattern = parseAobSignature(signature);
  const regions = driver.getRegions(handle);
  const modules = options.moduleName
    ? driver.getModules(handle).filter((m) => m.name.toLowerCase() === options.moduleName!.toLowerCase())
    : [];

  for (const region of regions) {
    if (modules.length > 0) {
      const overlaps = modules.some((m) =>
        regionOverlapsModule(region.baseAddress, region.size, m.baseAddress, m.size),
      );
      if (!overlaps) continue;
    }

    try {
      const buffer = driver.readBuffer(handle, region.baseAddress, region.size);
      const offset = findAobInBuffer(buffer, pattern);
      if (offset >= 0) {
        return region.baseAddress + BigInt(offset);
      }
    } catch {
      continue;
    }
  }

  return null;
}
