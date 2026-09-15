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
import type { AobResolverFn } from './feature-resolver.js';
import type {
  CanonicalCompleteness,
  CanonicalScanBounds,
  CanonicalSkippedRange,
  ScanControl,
  ScannerBackendKind,
} from './scanner-backend.js';
import type { ParityDifference, ScannerMemorySource } from './scanner-backend-router.js';
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
 * The result of a drift-tolerant signature resolution performed over the
 * canonical scanner backend contract (Stage 7.5).
 *
 * `completeness` is the whole point of this shape. The legacy fuzzy path
 * returned a bare `SignatureMatch | null`, so an uncovered region and a
 * genuinely absent pattern produced the identical answer - `null` - with no
 * way for any caller to tell them apart. That is D03, and on the fuzzy path
 * it was not a theoretical risk: `native-memory-driver.ts`'s `readBuffer`
 * throws for any region over 1 MiB (D01), and `scanFuzzySignature`'s
 * `catch { continue; }` swallowed every one of those throws, so on a real
 * game target the overwhelming majority of the address space was skipped in
 * silence and reported as "not found".
 */
export interface FuzzySignatureOutcome {
  backend: ScannerBackendKind;
  match: SignatureMatch | null;
  completeness: CanonicalCompleteness;
  /** True iff there is no match AND the search actually covered everything it claimed to. */
  isAuthoritativeAbsence: boolean;
}

/**
 * A drift-tolerant signature lookup bound to a real backend (native by
 * default, legacy only under explicit rollback) - the fuzzy counterpart to
 * `feature-resolver.ts`'s `AobResolverFn`.
 * `LiveMemorySession.createFuzzyAobResolver()` is the production
 * implementation, always dispatching through `ScannerBackendRouter`.
 */
export type FuzzyAobResolverFn = (
  signature: string,
  options: FuzzyScanOptions,
) => Promise<FuzzySignatureOutcome>;

/** Intersects one canonical region with the module spans, in canonical (BigInt) units. */
function canonicalRegionSpans(
  region: { baseAddress: bigint; size: bigint },
  modules: Array<{ baseAddress: bigint; size: bigint }>,
): Array<{ baseAddress: bigint; size: bigint }> {
  if (modules.length === 0) {
    return [{ baseAddress: region.baseAddress, size: region.size }];
  }
  const regionEnd = region.baseAddress + region.size;
  const spans: Array<{ baseAddress: bigint; size: bigint }> = [];
  for (const module of modules) {
    const moduleEnd = module.baseAddress + module.size;
    const start = region.baseAddress > module.baseAddress ? region.baseAddress : module.baseAddress;
    const end = regionEnd < moduleEnd ? regionEnd : moduleEnd;
    if (start >= end) continue;
    spans.push({ baseAddress: start, size: end - start });
  }
  return spans;
}

/**
 * Clips the hint window against one concrete slice of read bytes, returning
 * buffer-relative candidate-start bounds (or null when the window misses the
 * slice entirely).
 */
function clipSliceWindow(
  sliceBase: bigint,
  sliceLength: number,
  options: FuzzyScanOptions,
): { start: number; end: number } | null {
  if (options.hintAddress == null) return { start: 0, end: sliceLength };
  const maxShift = Math.max(0, Math.floor(options.maxShiftBytes ?? 512));
  const hint = options.hintAddress;
  const sliceEnd = sliceBase + BigInt(sliceLength);
  const windowStart = hint - BigInt(maxShift);
  // Exclusive candidate-start bound; +1 includes exactly hint + maxShift.
  const windowEnd = hint + BigInt(maxShift) + 1n;
  const clipStart = windowStart > sliceBase ? windowStart : sliceBase;
  const clipEnd = windowEnd < sliceEnd ? windowEnd : sliceEnd;
  if (clipStart >= clipEnd) return null;
  return { start: Number(clipStart - sliceBase), end: Number(clipEnd - sliceBase) };
}

/**
 * Drift-tolerant AOB resolution performed entirely over the canonical
 * scanner backend contract (Stage 7.5 - SHARED_BACKEND_RESOLVER).
 *
 * This is the whole architectural claim of the fuzzy migration, made
 * concrete: the drift algorithm itself (`findBestDriftAobInBuffer` and the
 * Hamming/bounded-Levenshtein kernels above it) is a *pure function over a
 * Buffer* - it performs no memory access of any kind and therefore is not,
 * and never was, a scan primitive. The only primitives the fuzzy path
 * genuinely needs are region enumeration, module enumeration, and a region
 * read, and the certified native scanner already provides all three
 * (`NativeScanTarget.enumerateRegions` / `readRegionChunked`). So migrating
 * fuzzy required no new native capability at all - only routing the reads it
 * was already doing through the seam every other production scan already
 * uses. Nothing is ported to Rust that does not belong there.
 *
 * Two behaviors are preserved exactly from the legacy implementation because
 * changing them would be a correctness regression, not an improvement:
 * module-scoped requests still fail closed when the module is absent, and
 * hint windows still clip the searched range. Module scoping in particular
 * matters far more here than it does for exact AOB: a drift-tolerant matcher
 * turned loose on an entire address space with a substitution budget will
 * find something, and it will be wrong.
 */
export async function scanFuzzySignatureViaSource(
  source: ScannerMemorySource,
  signature: string,
  options: FuzzyScanOptions = {},
  bounds: CanonicalScanBounds = {},
  control?: ScanControl,
): Promise<Omit<FuzzySignatureOutcome, 'backend'>> {
  const maxDistance = options.maxDistance ?? 2;
  const maxEdits = options.maxEdits ?? 1;
  const pattern = parseAobSignature(signature);
  const minimumSpan = BigInt(Math.max(1, pattern.bytes.length - maxEdits));

  let modules: Array<{ baseAddress: bigint; size: bigint }> = [];
  if (options.moduleName) {
    const wanted = options.moduleName.toLowerCase();
    const all = await source.enumerateModules();
    modules = all.filter((m) => m.name.toLowerCase() === wanted);
    if (modules.length === 0) {
      // Fail closed, exactly as the legacy path did - and authoritatively:
      // the module genuinely is not loaded, which is a complete answer, not
      // an uncovered one.
      return { match: null, completeness: { state: 'complete' }, isAuthoritativeAbsence: true };
    }
  }

  const regions = (await source.enumerateRegions()).filter((r) => r.isReadable && r.size > 0n);

  const skipped: CanonicalSkippedRange[] = [];
  let terminal: CanonicalCompleteness | null = null;
  let best: SignatureMatch | null = null;

  // Pure: returns whichever of `current` and the new hit is the better match.
  // Deliberately not a closure that assigns `best` directly - TypeScript's
  // control-flow analysis cannot see through that, and the resulting
  // never-narrowing hid the early-exit check below behind a false positive.
  const betterOf = (
    current: SignatureMatch | null,
    sliceBase: bigint,
    hit: DriftHit,
  ): SignatureMatch => {
    const address = sliceBase + BigInt(hit.offset);
    const candidate: SignatureMatch = {
      address,
      mode: hit.distance === 0 && hit.driftKind === 'hamming' ? 'exact' : 'fuzzy',
      distance: hit.distance,
      driftKind: hit.driftKind,
      shiftBytes: options.hintAddress != null ? Number(address - options.hintAddress) : undefined,
    };
    if (!current) return candidate;
    if (candidate.distance < current.distance) return candidate;
    if (
      candidate.distance === current.distance &&
      candidate.driftKind === 'hamming' &&
      current.driftKind === 'edit'
    ) {
      return candidate;
    }
    return current;
  };

  outer: for (const region of regions) {
    for (const span of canonicalRegionSpans(region, modules)) {
      if (span.size < minimumSpan) continue;
      if (control?.signal?.aborted) {
        terminal = { state: 'cancelled', atByte: 0n };
        break outer;
      }

      const read = await source.readRegion(
        { ...region, baseAddress: span.baseAddress, size: span.size },
        bounds,
        control,
      );

      switch (read.completeness.state) {
        case 'complete':
          break;
        case 'complete_with_skipped_regions':
          skipped.push(...read.completeness.skipped);
          break;
        default:
          // cancelled / process_exited / resource_limit / failed are terminal
          // for the whole resolution - there is no honest way to keep going
          // and still call the eventual absence authoritative.
          terminal = read.completeness;
          break outer;
      }

      for (const slice of read.slices) {
        if (slice.data.length < Number(minimumSpan)) continue;
        const window = clipSliceWindow(slice.baseAddress, slice.data.length, options);
        if (!window) continue;
        const hit = findBestDriftAobInBuffer(slice.data, pattern, {
          maxDistance,
          maxEdits,
          searchStart: window.start,
          searchEnd: window.end,
        });
        if (!hit) continue;
        best = betterOf(best, slice.baseAddress, hit);
        if (best.distance === 0 && best.driftKind === 'hamming') break outer;
      }
    }
  }

  const completeness: CanonicalCompleteness =
    terminal ?? (skipped.length > 0 ? { state: 'complete_with_skipped_regions', skipped } : { state: 'complete' });

  return {
    match: best,
    completeness,
    isAuthoritativeAbsence: best === null && completeness.state === 'complete',
  };
}

/**
 * Classifies a SHADOW_COMPARE disagreement between the legacy-sourced and
 * native-sourced fuzzy resolutions (mission 7.7's rule, applied to the fuzzy
 * path). The one difference this stage expects to see constantly on a real
 * target is legacy finding nothing while native finds a real match, because
 * legacy could not read any region over 1 MiB - that is D01/D03 showing
 * itself, and it is attributed to the named, understood cause rather than
 * blamed on native. Anything else is reported as needing an owner decision;
 * this never invents a justification for a difference it cannot explain.
 */
export function classifyFuzzySignatureDifference(
  legacy: Pick<FuzzySignatureOutcome, 'match' | 'completeness'>,
  native: Pick<FuzzySignatureOutcome, 'match' | 'completeness'>,
): ParityDifference[] {
  const legacyAddress = legacy.match?.address ?? null;
  const nativeAddress = native.match?.address ?? null;
  if (legacyAddress === nativeAddress && legacy.match?.distance === native.match?.distance) return [];

  const legacyIncomplete = legacy.completeness.state !== 'complete';
  if (legacyAddress === null && nativeAddress !== null && legacyIncomplete) {
    return [
      {
        field: 'match',
        legacyValue: { found: false, completeness: legacy.completeness.state },
        nativeValue: { found: true, address: nativeAddress.toString(), distance: native.match?.distance },
        classification: 'EXPECTED_NATIVE_CORRECTION',
        note:
          'Legacy fuzzy resolution could not cover the region containing the match - every region over ' +
          '1 MiB fails outright in native-memory-driver.ts readBuffer (D01) - and reported no match; the ' +
          'native-sourced resolution read the region in chunks and found a real one.',
      },
    ];
  }

  return [
    {
      field: 'match',
      legacyValue: legacyAddress !== null ? legacyAddress.toString() : null,
      nativeValue: nativeAddress !== null ? nativeAddress.toString() : null,
      classification: 'SEMANTIC_DIFFERENCE_REQUIRING_OWNER_DECISION',
      note: 'Fuzzy match result differs for a reason this classifier does not recognize as a known, expected cause.',
    },
  ];
}

/**
 * Prefer exact match; fall back to fuzzy Hamming + edit drift within policy.
 *
 * Stage 7.5 - BOTH sub-paths are now backend-routed. The exact sub-path goes
 * through `exactAobResolver` (Stage 7.4); the fuzzy/drift sub-path goes
 * through `fuzzyAobResolver` (this stage). `LiveMemorySession` binds both, so
 * in the real production call graph neither sub-path touches `MemoryDriver`.
 *
 * The direct `scanExactSignature`/`scanFuzzySignature` calls below survive
 * only as the unbound fallback for a caller that genuinely has no session or
 * router to bind to - a unit test driving this function against a
 * `FakeMemoryDriver`. They are not a production shortcut, and they are not
 * reachable from the shipping IPC path, which always binds both resolvers.
 *
 * On why the fuzzy migration needed no new Rust, correcting what this comment
 * previously claimed: Stage 7.4 recorded that fuzzy matching had "no native
 * equivalent at all" and must therefore remain legacy-only. The underlying
 * observation was accurate - the native pattern engine
 * (`native/solith-scanner-core/src/pattern.rs`) compiles a mask/value AOB
 * grammar and matches it exactly, with no notion of a substitution or edit
 * budget - but it drew the boundary in the wrong place. Drift tolerance is
 * not a scan primitive; it is a pure computation over bytes that a scan
 * primitive returns (`findBestDriftAobInBuffer` takes a `Buffer` and performs
 * no memory access whatsoever). The primitives fuzzy actually needs - region
 * enumeration and a chunked, completeness-reporting region read - already
 * exist natively and are already certified. See
 * `scanFuzzySignatureViaSource`.
 */
export async function resolveSignature(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  signature: string,
  options: FuzzyScanOptions = {},
  exactAobResolver?: AobResolverFn,
  fuzzyAobResolver?: FuzzyAobResolverFn,
): Promise<SignatureMatch | null> {
  const outcome = await resolveSignatureWithCoverage(
    driver,
    handle,
    signature,
    options,
    exactAobResolver,
    fuzzyAobResolver,
  );
  return outcome.match;
}

/**
 * `resolveSignature`, plus the coverage truth behind a `null` result.
 *
 * `completeness` is `null` only on the unbound legacy fallback path, where
 * there genuinely is no coverage signal to report - legacy's own fuzzy scan
 * never had one. That `null` means "unknown", and `isAuthoritativeAbsence` is
 * correspondingly `false`: an unbound miss is never promoted to a confident
 * not-found.
 */
export async function resolveSignatureWithCoverage(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  signature: string,
  options: FuzzyScanOptions = {},
  exactAobResolver?: AobResolverFn,
  fuzzyAobResolver?: FuzzyAobResolverFn,
): Promise<{
  match: SignatureMatch | null;
  completeness: CanonicalCompleteness | null;
  isAuthoritativeAbsence: boolean;
  fuzzyBackend: ScannerBackendKind | null;
}> {
  if (options.hintAddress == null) {
    const exact = exactAobResolver
      ? await resolveExactSignatureViaBackend(exactAobResolver, signature, options.moduleName)
      : scanExactSignature(driver, handle, signature, options);
    if (exact) {
      return { match: exact, completeness: { state: 'complete' }, isAuthoritativeAbsence: false, fuzzyBackend: null };
    }
  }

  if (fuzzyAobResolver) {
    const outcome = await fuzzyAobResolver(signature, options);
    return {
      match: outcome.match,
      completeness: outcome.completeness,
      isAuthoritativeAbsence: outcome.isAuthoritativeAbsence,
      fuzzyBackend: outcome.backend,
    };
  }

  return {
    match: scanFuzzySignature(driver, handle, signature, options),
    completeness: null,
    isAuthoritativeAbsence: false,
    fuzzyBackend: null,
  };
}

/** Wraps a bound `AobResolverFn` in `scanExactSignature`'s own `SignatureMatch` result shape. */
async function resolveExactSignatureViaBackend(
  resolver: AobResolverFn,
  signature: string,
  moduleName: string | undefined,
): Promise<SignatureMatch | null> {
  const { address } = await resolver(signature, moduleName);
  if (address === null) return null;
  return { address, mode: 'exact', distance: 0, driftKind: 'hamming' };
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
