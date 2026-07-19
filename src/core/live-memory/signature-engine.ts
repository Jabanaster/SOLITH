/**
 * SignatureEngine — exact AOB scan plus bounded fuzzy match after patch drift.
 *
 * Fuzzy mode finds the closest Hamming match within maxDistance, searching
 * only within module-overlapping regions (same containment as exact scan).
 */

import {
  findAobInBuffer,
  parseAobSignature,
  scanAobInProcess,
  type AobPattern,
  type AobScanOptions,
} from './aob-resolver.js';
import type { LiveProcessHandle, MemoryDriver } from './types.js';

export interface FuzzyScanOptions extends AobScanOptions {
  /** Maximum differing non-wildcard bytes (default 2). */
  maxDistance?: number;
}

export interface SignatureMatch {
  address: bigint;
  mode: 'exact' | 'fuzzy';
  distance: number;
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
 * Hamming distance for a pattern at `startOffset`. Wildcards (`null`) cost 0.
 * Returns null when the pattern does not fit in the buffer.
 */
export function aobHammingDistance(
  haystack: Buffer,
  pattern: AobPattern,
  startOffset: number,
): number | null {
  const { bytes } = pattern;
  if (startOffset < 0 || startOffset + bytes.length > haystack.length) return null;
  let distance = 0;
  for (let j = 0; j < bytes.length; j++) {
    const expected = bytes[j];
    if (expected === null) continue;
    if (haystack[startOffset + j] !== expected) distance += 1;
  }
  return distance;
}

/**
 * Find the best (lowest distance) fuzzy match in a buffer.
 * Prefers lower offsets when distances tie.
 */
export function findBestFuzzyAobInBuffer(
  haystack: Buffer,
  pattern: AobPattern,
  maxDistance: number,
): { offset: number; distance: number } | null {
  const { bytes } = pattern;
  if (bytes.length === 0 || haystack.length < bytes.length || maxDistance < 0) return null;

  let bestOffset = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  const limit = haystack.length - bytes.length;

  for (let i = 0; i <= limit; i++) {
    const distance = aobHammingDistance(haystack, pattern, i);
    if (distance === null) continue;
    if (distance > maxDistance) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestOffset = i;
      if (distance === 0) break;
    }
  }

  if (bestOffset < 0) return null;
  return { offset: bestOffset, distance: bestDistance };
}

/** Exact AOB scan (delegates to aob-resolver). */
export function scanExactSignature(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  signature: string,
  options: AobScanOptions = {},
): SignatureMatch | null {
  const address = scanAobInProcess(driver, handle, signature, options);
  if (address == null) return null;
  return { address, mode: 'exact', distance: 0 };
}

/**
 * Fuzzy AOB scan across committed regions (optionally module-scoped).
 * Skips exact-zero candidates already found by callers when desired —
 * this function alone returns the best fuzzy/exact hit within maxDistance.
 */
export function scanFuzzySignature(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  signature: string,
  options: FuzzyScanOptions = {},
): SignatureMatch | null {
  const maxDistance = options.maxDistance ?? 2;
  const pattern = parseAobSignature(signature);
  const regions = driver.getRegions(handle);
  const modules = options.moduleName
    ? driver.getModules(handle).filter((m) => m.name.toLowerCase() === options.moduleName!.toLowerCase())
    : [];

  let best: SignatureMatch | null = null;

  for (const region of regions) {
    if (modules.length > 0) {
      const overlaps = modules.some((m) =>
        regionOverlapsModule(region.baseAddress, region.size, m.baseAddress, m.size),
      );
      if (!overlaps) continue;
    }

    try {
      const buffer = driver.readBuffer(handle, region.baseAddress, region.size);
      const hit = findBestFuzzyAobInBuffer(buffer, pattern, maxDistance);
      if (!hit) continue;
      const candidate: SignatureMatch = {
        address: region.baseAddress + BigInt(hit.offset),
        mode: hit.distance === 0 ? 'exact' : 'fuzzy',
        distance: hit.distance,
      };
      if (!best || candidate.distance < best.distance) {
        best = candidate;
        if (best.distance === 0) return best;
      }
    } catch {
      continue;
    }
  }

  return best;
}

/**
 * Prefer exact match; fall back to fuzzy within maxDistance.
 */
export function resolveSignature(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  signature: string,
  options: FuzzyScanOptions = {},
): SignatureMatch | null {
  const exact = scanExactSignature(driver, handle, signature, options);
  if (exact) return exact;
  return scanFuzzySignature(driver, handle, signature, options);
}

/** Buffer helper used by tests — exact first, then fuzzy. */
export function resolveSignatureInBuffer(
  haystack: Buffer,
  signature: string,
  maxDistance = 2,
): { offset: number; mode: 'exact' | 'fuzzy'; distance: number } | null {
  const pattern = parseAobSignature(signature);
  const exactOffset = findAobInBuffer(haystack, pattern);
  if (exactOffset >= 0) {
    return { offset: exactOffset, mode: 'exact', distance: 0 };
  }
  const fuzzy = findBestFuzzyAobInBuffer(haystack, pattern, maxDistance);
  if (!fuzzy) return null;
  return { offset: fuzzy.offset, mode: 'fuzzy', distance: fuzzy.distance };
}
