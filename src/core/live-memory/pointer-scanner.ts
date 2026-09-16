import { isProcessGoneError } from './memory-scanner.js';
import type { CanonicalCompleteness, CanonicalSkippedRange } from './scanner-backend.js';
import type { LiveProcessHandle, MemoryDriver } from './types.js';

/**
 * Reverse pointer scanner — the Cheat-Engine-style "what points to this
 * address" workflow, extended recursively so a dynamic (heap, GC-managed)
 * address found via memory-scanner.ts can be turned into a restart-stable
 * "module + offset chain" pointer path (see pointer-resolver.ts).
 *
 * Why this exists: a raw absolute address found by scanFirst is only valid
 * for the current process instance. ASLR randomizes the process's base load
 * address on every launch, and managed-runtime GCs (e.g. .NET, which
 * Stardew Valley uses) can move heap objects even within one running
 * session. A module's base-relative OFFSET to a static pointer slot,
 * however, is stable across launches for a given game binary version —
 * that's the actual unit a real, reusable trainer control needs.
 *
 * Algorithm: breadth-first, working backward from the target address.
 * At each level, scan committed memory for 8-byte values that look like a
 * pointer landing within `maxOffsetPerLevel` bytes before the current
 * frontier address (not an exact match — the pointer typically references
 * an object's start, and the field we care about is some small offset into
 * that object). Any hit whose OWN address falls inside a loaded module's
 * range is a candidate stable path root. Any hit that's itself a heap
 * address becomes a new frontier item for the next level, up to a
 * conservative depth/branching/total-scan budget — this is a genuinely
 * expensive operation (manual byte-by-byte pointer comparison, not a native
 * indexOf-based exact-value scan) and is meant to be triggered deliberately
 * by the user, not run automatically or repeatedly.
 */

export interface PointerScanBounds {
  /** How many dereference levels to search backward. Default 3, hard-capped by MAX_DEPTH_CAP. */
  maxDepth?: number;
  /** Max bytes a candidate pointer may land before the target address. Default 2048. */
  maxOffsetPerLevel?: number;
  /** Max heap candidates carried forward to the next level per frontier item. Default 3. */
  maxCandidatesPerLevel?: number;
  /** Skip any single region larger than this. Default 64 MiB. */
  maxRegionBytes?: number;
  /** Bytes budget for a single findPointersNear() call. Default 128 MiB. */
  maxBytesPerScan?: number;
  /** Max module-rooted paths to return. Default MAX_RESULTS (20). */
  maxResults?: number;
  /** Global cap on findPointersNear() calls for the whole run. Default MAX_TOTAL_SCANS (25). */
  maxTotalScans?: number;
  /** Cooperative cancellation, checked between frontier items and between regions. */
  signal?: { aborted: boolean };
}

export interface PointerPathCandidate {
  moduleName: string;
  moduleOffset: number;
  /** Forward dereference order — ready to pass directly to resolvePointerPath(). */
  offsets: number[];
  /** How many dereference levels this candidate required (1 = directly pointed to by a module). */
  depth: number;
}

/**
 * Why a pointer traversal stopped. This is the distinction D05 turned on: a
 * search that ran out of candidates and a search that was cut off both used to
 * end with `truncated: false`, so a `levelsSearched: 1` against a requested
 * `maxDepth: 3` was unreadable — it could equally mean "there is genuinely
 * nothing deeper to follow" or "we stopped and did not say so".
 *
 * - `frontier_exhausted` — every reachable path was followed to a module root
 *   or to a dead end. The only terminal state that may report complete.
 * - `depth_limit_reached` — the requested depth was searched in full and heap
 *   candidates still remained beyond it. Complete with respect to what was
 *   asked for, but explicitly not an exhaustive answer about the graph.
 * - everything else — the search stopped early.
 */
export type PointerScanTermination =
  | 'frontier_exhausted'
  | 'depth_limit_reached'
  | 'result_limit_reached'
  | 'candidate_limit_reached'
  | 'scan_budget_exhausted'
  | 'cancelled'
  | 'process_exited'
  | 'module_enumeration_failed';

export interface PointerScanResult {
  candidates: PointerPathCandidate[];
  /**
   * The depth actually searched for, after clamping to MAX_DEPTH_CAP. Reported
   * so `levelsSearched` can be read against the real request rather than
   * against what the caller believes it asked for.
   */
  requestedDepth: number;
  /** How many levels the traversal entered. */
  levelsSearched: number;
  /**
   * The deepest level whose entire frontier was examined. Lower than
   * `levelsSearched` when a level was entered but abandoned partway (a cap, a
   * cancellation, a read failure) — exactly the case plain `levelsSearched`
   * could not express.
   */
  deepestLevelCompleted: number;
  scansPerformed: number;
  /** Heap addresses expanded into a next level's frontier. */
  candidatesExplored: number;
  /** Heap addresses dropped because a per-level candidate cap was already full. */
  candidatesDropped: number;
  termination: PointerScanTermination;
  /** Regions that could not be read, so some pointer slots were never examined. */
  skippedRegions: CanonicalSkippedRange[];
  /** Canonical completeness — the same vocabulary the scanner backend uses. */
  completeness: CanonicalCompleteness;
  /** True iff no candidates were found AND the search was genuinely complete. */
  isAuthoritativeAbsence: boolean;
  truncated: boolean;
}

const DEFAULT_MAX_DEPTH = 3;
const MAX_DEPTH_CAP = 6;
const DEFAULT_MAX_OFFSET_PER_LEVEL = 2048;
const DEFAULT_MAX_CANDIDATES_PER_LEVEL = 3;
const DEFAULT_MAX_REGION_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_BYTES_PER_SCAN = 128 * 1024 * 1024;
const MAX_RESULTS = 20;
// Global hard stop on total findPointersNear() calls across the whole run, regardless of
// depth/branching — bounds worst-case wall-clock time even if every level hits its candidate cap.
const MAX_TOTAL_SCANS = 25;

interface FrontierItem {
  address: bigint;
  offsetsSoFar: number[];
}

interface PointerHit {
  /** Where the pointer value itself is stored. */
  address: bigint;
  /** The pointer's value (references somewhere at or before the target, within maxOffsetPerLevel). */
  pointerValue: bigint;
}

export function scanForPointerPath(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  targetAddress: bigint,
  bounds?: PointerScanBounds,
): PointerScanResult {
  const requestedDepth = Math.max(1, Math.min(bounds?.maxDepth ?? DEFAULT_MAX_DEPTH, MAX_DEPTH_CAP));
  const maxOffsetPerLevel = bounds?.maxOffsetPerLevel ?? DEFAULT_MAX_OFFSET_PER_LEVEL;
  const maxCandidatesPerLevel = bounds?.maxCandidatesPerLevel ?? DEFAULT_MAX_CANDIDATES_PER_LEVEL;
  const maxRegionBytes = bounds?.maxRegionBytes ?? DEFAULT_MAX_REGION_BYTES;
  const maxBytesPerScan = bounds?.maxBytesPerScan ?? DEFAULT_MAX_BYTES_PER_SCAN;
  const maxResults = bounds?.maxResults ?? MAX_RESULTS;
  const maxTotalScans = bounds?.maxTotalScans ?? MAX_TOTAL_SCANS;
  const signal = bounds?.signal;

  const candidates: PointerPathCandidate[] = [];
  const skippedRegions: CanonicalSkippedRange[] = [];
  let frontier: FrontierItem[] = [{ address: targetAddress, offsetsSoFar: [] }];
  let levelsSearched = 0;
  let deepestLevelCompleted = 0;
  let scansPerformed = 0;
  let candidatesExplored = 0;
  let candidatesDropped = 0;
  let termination: PointerScanTermination = 'frontier_exhausted';
  let processExited = false;
  let budgetExhausted = false;

  // Cycle safety. A heap object graph routinely contains A -> B -> A and
  // self-references; without this the traversal re-expands the same address at
  // every level, producing duplicate paths and repeating the same work. The
  // target seeds the set so a chain cannot loop back onto the very address
  // being searched for.
  const visited = new Set<bigint>([targetAddress]);

  // Module enumeration is the first thing a pointer scan needs and the first
  // thing that fails when the target has exited. Letting that throw would push
  // a raw driver error up through the IPC boundary, where it becomes a generic
  // `pointer_scan_failed` — the caller would learn that something went wrong
  // but not that the answer is "unknown, the process is gone", which is the
  // distinction D05 exists to preserve.
  let modules: ReturnType<MemoryDriver['getModules']>;
  try {
    modules = driver.getModules(handle);
  } catch (err) {
    // A dead process is reported as such; anything else that stops module
    // enumeration (an access failure, a snapshot the OS would not give us) is
    // reported as a failure rather than guessed at. Neither is an absence.
    const gone = isProcessGoneError(err);
    const reason = err instanceof Error ? err.message : String(err);
    return {
      candidates: [],
      requestedDepth,
      levelsSearched: 0,
      deepestLevelCompleted: 0,
      scansPerformed: 0,
      candidatesExplored: 0,
      candidatesDropped: 0,
      termination: gone ? 'process_exited' : 'module_enumeration_failed',
      skippedRegions: [],
      completeness: gone ? { state: 'process_exited', atByte: 0n } : { state: 'failed', reason },
      isAuthoritativeAbsence: false,
      truncated: true,
    };
  }

  depthLoop: for (let depth = 1; depth <= requestedDepth; depth++) {
    if (frontier.length === 0) {
      // Nothing reachable is left to follow. This is the one genuinely
      // complete way to stop short of the requested depth.
      termination = 'frontier_exhausted';
      break;
    }

    levelsSearched = depth;
    const nextFrontier: FrontierItem[] = [];
    let levelFullyExamined = true;

    for (const item of frontier) {
      if (signal?.aborted) {
        termination = 'cancelled';
        levelFullyExamined = false;
        break depthLoop;
      }
      if (candidates.length >= maxResults) {
        termination = 'result_limit_reached';
        levelFullyExamined = false;
        break depthLoop;
      }
      if (scansPerformed >= maxTotalScans) {
        termination = 'scan_budget_exhausted';
        levelFullyExamined = false;
        break depthLoop;
      }

      scansPerformed += 1;
      const scan = findPointersNear(
        driver,
        handle,
        item.address,
        maxOffsetPerLevel,
        maxRegionBytes,
        maxBytesPerScan,
        signal,
      );
      for (const skipped of scan.skippedRegions) skippedRegions.push(skipped);
      if (scan.skippedRegions.length > 0) levelFullyExamined = false;
      if (scan.budgetExhausted) {
        // The per-scan byte budget cut the sweep short, so regions beyond it
        // were never examined. Without this the run could still finish as
        // `frontier_exhausted` and claim completeness over memory it skipped.
        budgetExhausted = true;
        levelFullyExamined = false;
      }
      if (scan.processExited) {
        processExited = true;
        termination = 'process_exited';
        levelFullyExamined = false;
        break depthLoop;
      }
      if (scan.cancelled) {
        termination = 'cancelled';
        levelFullyExamined = false;
        break depthLoop;
      }

      for (const hit of scan.matches) {
        const offset = Number(item.address - hit.pointerValue);
        const pathOffsets = [offset, ...item.offsetsSoFar];

        const module = modules.find((m) => hit.address >= m.baseAddress && hit.address < m.baseAddress + BigInt(m.size));
        if (module) {
          candidates.push({
            moduleName: module.name,
            moduleOffset: Number(hit.address - module.baseAddress),
            offsets: pathOffsets,
            depth,
          });
          if (candidates.length >= maxResults) {
            termination = 'result_limit_reached';
            levelFullyExamined = false;
            break depthLoop;
          }
          continue;
        }

        // Heap hit. An already-visited address is valid de-duplication, not a
        // coverage gap — the path through it has been (or is being) explored,
        // so suppressing it loses nothing and must NOT count as truncation.
        if (visited.has(hit.address)) continue;

        if (nextFrontier.length >= maxCandidatesPerLevel) {
          // A real coverage gap: this address is never expanded, so any path
          // running through it goes unsearched.
          candidatesDropped += 1;
          levelFullyExamined = false;
          continue;
        }

        visited.add(hit.address);
        nextFrontier.push({ address: hit.address, offsetsSoFar: pathOffsets });
        candidatesExplored += 1;
      }
    }

    if (levelFullyExamined) deepestLevelCompleted = depth;
    frontier = nextFrontier;

    if (depth === requestedDepth) {
      // The requested depth was searched in full. Whether that is the whole
      // answer depends on whether anything was still waiting to be followed.
      termination = frontier.length > 0 ? 'depth_limit_reached' : 'frontier_exhausted';
    }
  }

  if (termination === 'frontier_exhausted' && budgetExhausted) {
    termination = 'scan_budget_exhausted';
  }

  if (termination === 'frontier_exhausted' && candidatesDropped > 0) {
    // The frontier only looks exhausted because candidates were dropped at a
    // per-level cap. That is an early stop, not an exhaustive search.
    termination = 'candidate_limit_reached';
  }

  const completeness = pointerCompleteness(termination, skippedRegions, processExited);
  const complete = completeness.state === 'complete';

  return {
    candidates,
    requestedDepth,
    levelsSearched,
    deepestLevelCompleted,
    scansPerformed,
    candidatesExplored,
    candidatesDropped,
    termination,
    skippedRegions,
    completeness,
    isAuthoritativeAbsence: candidates.length === 0 && complete,
    truncated: !complete,
  };
}

/**
 * Maps a termination reason plus any skipped regions onto the canonical
 * completeness states. `depth_limit_reached` is deliberately NOT complete: the
 * caller asked to search N levels and got N levels, but heap candidates were
 * still waiting, so reporting zero results as an authoritative absence would be
 * the same claim D05 was filed against.
 */
function pointerCompleteness(
  termination: PointerScanTermination,
  skippedRegions: CanonicalSkippedRange[],
  processExited: boolean,
): CanonicalCompleteness {
  if (processExited) return { state: 'process_exited', atByte: 0n };
  switch (termination) {
    case 'process_exited':
      return { state: 'process_exited', atByte: 0n };
    case 'cancelled':
      return { state: 'cancelled', atByte: 0n };
    case 'result_limit_reached':
    case 'candidate_limit_reached':
    case 'scan_budget_exhausted':
      return { state: 'resource_limit', atByte: 0n };
    case 'depth_limit_reached':
      return {
        state: 'complete_with_skipped_regions',
        skipped: [
          ...skippedRegions,
          {
            baseAddress: 0n,
            size: 0n,
            reason: 'depth_limit_reached: heap candidates remained beyond the requested depth',
          },
        ],
      };
    case 'module_enumeration_failed':
      return { state: 'failed', reason: 'module_enumeration_failed' };
    case 'frontier_exhausted':
      return skippedRegions.length > 0
        ? { state: 'complete_with_skipped_regions', skipped: [...skippedRegions] }
        : { state: 'complete' };
  }
}

function findPointersNear(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  targetAddress: bigint,
  maxOffset: number,
  maxRegionBytes: number,
  maxTotalBytes: number,
  signal?: { aborted: boolean },
): {
  matches: PointerHit[];
  skippedRegions: CanonicalSkippedRange[];
  budgetExhausted: boolean;
  cancelled: boolean;
  processExited: boolean;
} {
  const skippedRegions: CanonicalSkippedRange[] = [];
  let regions: ReturnType<MemoryDriver['getRegions']>;
  try {
    regions = [];
    for (const region of driver.getRegions(handle)) {
      if (region.size <= 0) continue;
      if (region.size > maxRegionBytes) {
        // An eligible region excluded purely for size is still a region whose
        // pointer slots were never examined — a cost control, not evidence
        // that nothing points into the target from there.
        skippedRegions.push({
          baseAddress: region.baseAddress,
          size: BigInt(region.size),
          reason: `region_exceeds_max_region_bytes: ${region.size} > ${maxRegionBytes}`,
        });
        continue;
      }
      regions.push(region);
    }
  } catch (err) {
    // Region enumeration itself failing is the signature of a process that went
    // away mid-traversal — a different fact from one region becoming
    // unreadable, and one the caller must not read as "no pointers here".
    return {
      matches: [],
      skippedRegions,
      budgetExhausted: false,
      cancelled: false,
      processExited: isProcessGoneError(err),
    };
  }

  const matches: PointerHit[] = [];
  const maxOffsetBig = BigInt(maxOffset);
  let bytesScanned = 0;
  let budgetExhausted = false;
  let processExited = false;

  for (const region of regions) {
    if (signal?.aborted) {
      return { matches, skippedRegions, budgetExhausted, cancelled: true, processExited };
    }
    if (bytesScanned + region.size > maxTotalBytes) {
      budgetExhausted = true;
      break;
    }

    let buf: Buffer;
    try {
      buf = driver.readBuffer(handle, region.baseAddress, region.size);
    } catch (err) {
      // A region that could not be read is a region whose pointer slots were
      // never examined — the pointer-scan instance of the same silent-skip
      // defect D01 covers for value scans.
      if (isProcessGoneError(err)) {
        processExited = true;
        break;
      }
      skippedRegions.push({
        baseAddress: region.baseAddress,
        size: BigInt(region.size),
        reason: `region_read_failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    bytesScanned += region.size;

    // Bound by what was actually returned, not by what was requested — a driver
    // may legitimately return a short read.
    const usable = Math.min(buf.length, region.size);
    const alignedLength = usable - (usable % 8);
    for (let offset = 0; offset < alignedLength; offset += 8) {
      const pointerValue = buf.readBigUInt64LE(offset);
      const diff = targetAddress - pointerValue;
      if (diff >= 0n && diff <= maxOffsetBig) {
        matches.push({ address: region.baseAddress + BigInt(offset), pointerValue });
      }
    }
  }

  return { matches, skippedRegions, budgetExhausted, cancelled: false, processExited };
}
