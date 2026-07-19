/**
 * SignatureEngine — exact AOB scan plus drift-tolerant fuzzy matching.
 *
 * Drift modes:
 * - Hamming: byte substitutions (instruction patch) within maxDistance
 * - Edit: bounded insert/delete/substitute (byte-shifting) within maxEdits
 * - Shift window: optional hintAddress ± maxShiftBytes to limit search after patch moves code
 */

import {
  findAobInBuffer,
  parseAobSignature,
  type AobPattern,
  type AobScanOptions,
} from './aob-resolver.js';
import type { LiveProcessHandle, MemoryDriver } from './types.js';

export interface FuzzyScanOptions extends AobScanOptions {
  /** Maximum differing non-wildcard bytes for Hamming match (default 2). */
  maxDistance?: number;
  /**
   * Maximum insert/delete/substitute edits for byte-shift drift (default 1).
   * Set 0 to disable edit-distance matching (Hamming only).
   */
  maxEdits?: number;
  /** Prior match address — search only within ± maxShiftBytes when set. */
  hintAddress?: bigint;
  /** Half-window around hintAddress in bytes (default 512). */
  maxShiftBytes?: number;
}

export interface SignatureMatch {
  address: bigint;
  mode: 'exact' | 'fuzzy';
  /** Hamming substitutions, or edit cost when driftKind is 'edit'. */
  distance: number;
  driftKind?: 'hamming' | 'edit';
  /** Bytes from hintAddress to match (signed); only when hint was supplied. */
  shiftBytes?: number;
}

interface ScanSpan {
  baseAddress: bigint;
  size: number;
}

function regionScanSpans(
  region: { baseAddress: bigint; size: number },
  modules: Array<{ baseAddress: bigint; size: number }>,
): ScanSpan[] {
  if (modules.length === 0) {
    return [{ baseAddress: region.baseAddress, size: region.size }];
  }

  const regionEnd = region.baseAddress + BigInt(region.size);
  const spans: ScanSpan[] = [];
  for (const module of modules) {
    const moduleEnd = module.baseAddress + BigInt(module.size);
    const start = region.baseAddress > module.baseAddress
      ? region.baseAddress
      : module.baseAddress;
    const end = regionEnd < moduleEnd ? regionEnd : moduleEnd;
    if (start >= end) continue;
    spans.push({
      baseAddress: start,
      size: Number(end - start),
    });
  }
  return spans;
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
 * Bounded Levenshtein against haystack starting at `startOffset`.
 * Wildcards match any byte at cost 0. Returns null when edits exceed maxEdits
 * or the remaining buffer cannot absorb the pattern.
 */
export function aobBoundedEditDistance(
  haystack: Buffer,
  pattern: AobPattern,
  startOffset: number,
  maxEdits: number,
): { edits: number; consumed: number } | null {
  const pat = pattern.bytes;
  const m = pat.length;
  if (m === 0 || startOffset < 0 || startOffset >= haystack.length || maxEdits < 0) return null;

  const maxConsume = Math.min(haystack.length - startOffset, m + maxEdits);
  if (maxConsume < Math.max(0, m - maxEdits)) return null;

  // DP: prev/curr rows over consumed length 0..maxConsume
  let prev = new Array<number>(maxConsume + 1);
  let curr = new Array<number>(maxConsume + 1);
  for (let j = 0; j <= maxConsume; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const expected = pat[i - 1];
    let rowMin = curr[0];
    for (let j = 1; j <= maxConsume; j++) {
      const hayByte = haystack[startOffset + j - 1];
      const matchCost = expected === null || expected === hayByte ? 0 : 1;
      const sub = prev[j - 1] + matchCost;
      const del = prev[j] + 1; // delete from pattern (skip pattern byte)
      const ins = curr[j - 1] + 1; // insert into pattern (skip haystack byte)
      curr[j] = Math.min(sub, del, ins);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > maxEdits) return null;
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  let bestEdits = Number.POSITIVE_INFINITY;
  let bestConsumed = -1;
  const minConsume = Math.max(0, m - maxEdits);
  for (let j = minConsume; j <= maxConsume; j++) {
    if (prev[j] <= maxEdits && prev[j] < bestEdits) {
      bestEdits = prev[j];
      bestConsumed = j;
    }
  }
  if (bestConsumed < 0) return null;
  return { edits: bestEdits, consumed: bestConsumed };
}

export interface DriftHit {
  offset: number;
  distance: number;
  driftKind: 'hamming' | 'edit';
  consumed: number;
}

/**
 * Find the best drift-tolerant match in a buffer (Hamming, then edit if needed).
 */
export function findBestDriftAobInBuffer(
  haystack: Buffer,
  pattern: AobPattern,
  options: { maxDistance?: number; maxEdits?: number; searchStart?: number; searchEnd?: number } = {},
): DriftHit | null {
  const maxDistance = options.maxDistance ?? 2;
  const maxEdits = options.maxEdits ?? 1;
  const { bytes } = pattern;
  if (
    bytes.length === 0 ||
    maxDistance < 0 ||
    maxEdits < 0 ||
    haystack.length < Math.max(1, bytes.length - maxEdits)
  ) {
    return null;
  }

  const searchStart = Math.max(0, options.searchStart ?? 0);
  // searchEnd is the exclusive upper bound for candidate start offsets.
  const searchEnd = Math.min(haystack.length, options.searchEnd ?? haystack.length);
  if (searchStart >= searchEnd) return null;

  let best: DriftHit | null = null;

  const hammingLimit = Math.min(searchEnd - 1, haystack.length - bytes.length);
  for (let i = searchStart; i <= hammingLimit; i++) {
    const distance = aobHammingDistance(haystack, pattern, i);
    if (distance === null || distance > maxDistance) continue;
    if (!best || distance < best.distance || (distance === best.distance && best.driftKind === 'edit')) {
      best = { offset: i, distance, driftKind: 'hamming', consumed: bytes.length };
      if (distance === 0) return best;
    }
  }

  if (maxEdits <= 0) return best;

  const editLimit = Math.min(
    searchEnd - 1,
    haystack.length - Math.max(1, bytes.length - maxEdits),
  );
  for (let i = searchStart; i <= editLimit; i++) {
    const edit = aobBoundedEditDistance(haystack, pattern, i, maxEdits);
    if (!edit) continue;
    // Prefer Hamming when equal cost; skip pure Hamming-equivalent already found
    if (best && best.driftKind === 'hamming' && edit.edits >= best.distance) continue;
    if (!best || edit.edits < best.distance) {
      best = { offset: i, distance: edit.edits, driftKind: 'edit', consumed: edit.consumed };
    }
  }

  return best;
}

/**
 * Find the best (lowest distance) fuzzy Hamming match in a buffer.
 * Prefers lower offsets when distances tie.
 */
export function findBestFuzzyAobInBuffer(
  haystack: Buffer,
  pattern: AobPattern,
  maxDistance: number,
): { offset: number; distance: number } | null {
  const hit = findBestDriftAobInBuffer(haystack, pattern, { maxDistance, maxEdits: 0 });
  if (!hit) return null;
  return { offset: hit.offset, distance: hit.distance };
}

function clipSearchWindow(
  regionBase: bigint,
  regionSize: number,
  options: FuzzyScanOptions,
): { start: number; end: number } | null {
  if (options.hintAddress == null) {
    return { start: 0, end: regionSize };
  }
  const maxShift = Math.max(0, Math.floor(options.maxShiftBytes ?? 512));
  const hint = options.hintAddress;
  const regionEnd = regionBase + BigInt(regionSize);
  const windowStart = hint - BigInt(maxShift);
  // Exclusive candidate-start bound; +1 includes exactly hint + maxShift.
  const windowEnd = hint + BigInt(maxShift) + 1n;
  const clipStart = windowStart > regionBase ? windowStart : regionBase;
  const clipEnd = windowEnd < regionEnd ? windowEnd : regionEnd;
  if (clipStart >= clipEnd) return null;
  return {
    start: Number(clipStart - regionBase),
    end: Number(clipEnd - regionBase),
  };
}

/** Exact AOB scan (delegates to aob-resolver). */
export function scanExactSignature(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  signature: string,
  options: AobScanOptions = {},
): SignatureMatch | null {
  const pattern = parseAobSignature(signature);
  const modules = options.moduleName
    ? driver.getModules(handle).filter(
      (module) => module.name.toLowerCase() === options.moduleName!.toLowerCase(),
    )
    : [];
  if (options.moduleName && modules.length === 0) return null;

  for (const region of driver.getRegions(handle)) {
    for (const span of regionScanSpans(region, modules)) {
      if (span.size < pattern.bytes.length) continue;
      try {
        const buffer = driver.readBuffer(handle, span.baseAddress, span.size);
        const offset = findAobInBuffer(buffer, pattern);
        if (offset >= 0) {
          return {
            address: span.baseAddress + BigInt(offset),
            mode: 'exact',
            distance: 0,
            driftKind: 'hamming',
          };
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}

/**
 * Fuzzy AOB scan across committed regions (optionally module-scoped + hint window).
 */
export function scanFuzzySignature(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  signature: string,
  options: FuzzyScanOptions = {},
): SignatureMatch | null {
  const maxDistance = options.maxDistance ?? 2;
  const maxEdits = options.maxEdits ?? 1;
  const pattern = parseAobSignature(signature);
  const regions = driver.getRegions(handle);
  const modules = options.moduleName
    ? driver.getModules(handle).filter((m) => m.name.toLowerCase() === options.moduleName!.toLowerCase())
    : [];
  // Module-scoped definitions must fail closed when the requested module is absent.
  if (options.moduleName && modules.length === 0) return null;

  let best: SignatureMatch | null = null;

  for (const region of regions) {
    for (const span of regionScanSpans(region, modules)) {
      if (span.size < Math.max(1, pattern.bytes.length - maxEdits)) continue;
      const window = clipSearchWindow(span.baseAddress, span.size, options);
      if (!window) continue;

      try {
        const buffer = driver.readBuffer(handle, span.baseAddress, span.size);
        const hit = findBestDriftAobInBuffer(buffer, pattern, {
          maxDistance,
          maxEdits,
          searchStart: window.start,
          searchEnd: window.end,
        });
        if (!hit) continue;
        const address = span.baseAddress + BigInt(hit.offset);
        const candidate: SignatureMatch = {
          address,
          mode: hit.distance === 0 && hit.driftKind === 'hamming' ? 'exact' : 'fuzzy',
          distance: hit.distance,
          driftKind: hit.driftKind,
          shiftBytes:
            options.hintAddress != null ? Number(address - options.hintAddress) : undefined,
        };
        if (
          !best ||
          candidate.distance < best.distance ||
          (candidate.distance === best.distance &&
            candidate.driftKind === 'hamming' &&
            best.driftKind === 'edit')
        ) {
          best = candidate;
          if (best.distance === 0 && best.driftKind === 'hamming') return best;
        }
      } catch {
        continue;
      }
    }
  }

  return best;
}

/**
 * Prefer exact match; fall back to fuzzy Hamming + edit drift within policy.
 */
export function resolveSignature(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  signature: string,
  options: FuzzyScanOptions = {},
): SignatureMatch | null {
  if (options.hintAddress == null) {
    const exact = scanExactSignature(driver, handle, signature, options);
    if (exact) return exact;
  }
  return scanFuzzySignature(driver, handle, signature, options);
}

/** Buffer helper used by tests — exact first, then drift-tolerant fuzzy. */
export function resolveSignatureInBuffer(
  haystack: Buffer,
  signature: string,
  maxDistance = 2,
  maxEdits = 1,
): { offset: number; mode: 'exact' | 'fuzzy'; distance: number; driftKind: 'hamming' | 'edit' } | null {
  const pattern = parseAobSignature(signature);
  const exactOffset = findAobInBuffer(haystack, pattern);
  if (exactOffset >= 0) {
    return { offset: exactOffset, mode: 'exact', distance: 0, driftKind: 'hamming' };
  }
  const fuzzy = findBestDriftAobInBuffer(haystack, pattern, { maxDistance, maxEdits });
  if (!fuzzy) return null;
  return {
    offset: fuzzy.offset,
    mode: 'fuzzy',
    distance: fuzzy.distance,
    driftKind: fuzzy.driftKind,
  };
}
