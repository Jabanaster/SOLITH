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
}

export interface PointerPathCandidate {
  moduleName: string;
  moduleOffset: number;
  /** Forward dereference order — ready to pass directly to resolvePointerPath(). */
  offsets: number[];
  /** How many dereference levels this candidate required (1 = directly pointed to by a module). */
  depth: number;
}

export interface PointerScanResult {
  candidates: PointerPathCandidate[];
  levelsSearched: number;
  scansPerformed: number;
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
  const maxDepth = Math.min(bounds?.maxDepth ?? DEFAULT_MAX_DEPTH, MAX_DEPTH_CAP);
  const maxOffsetPerLevel = bounds?.maxOffsetPerLevel ?? DEFAULT_MAX_OFFSET_PER_LEVEL;
  const maxCandidatesPerLevel = bounds?.maxCandidatesPerLevel ?? DEFAULT_MAX_CANDIDATES_PER_LEVEL;
  const maxRegionBytes = bounds?.maxRegionBytes ?? DEFAULT_MAX_REGION_BYTES;
  const maxBytesPerScan = bounds?.maxBytesPerScan ?? DEFAULT_MAX_BYTES_PER_SCAN;

  const modules = driver.getModules(handle);
  const candidates: PointerPathCandidate[] = [];
  let frontier: FrontierItem[] = [{ address: targetAddress, offsetsSoFar: [] }];
  let levelsSearched = 0;
  let scansPerformed = 0;
  let truncated = false;

  for (let depth = 1; depth <= maxDepth && frontier.length > 0 && candidates.length < MAX_RESULTS; depth++) {
    levelsSearched = depth;
    const nextFrontier: FrontierItem[] = [];

    for (const item of frontier) {
      if (candidates.length >= MAX_RESULTS) break;
      if (scansPerformed >= MAX_TOTAL_SCANS) {
        truncated = true;
        break;
      }

      scansPerformed += 1;
      const scan = findPointersNear(driver, handle, item.address, maxOffsetPerLevel, maxRegionBytes, maxBytesPerScan);
      if (scan.truncated) truncated = true;

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
          if (candidates.length >= MAX_RESULTS) break;
        } else if (nextFrontier.length < maxCandidatesPerLevel) {
          nextFrontier.push({ address: hit.address, offsetsSoFar: pathOffsets });
        }
      }
    }

    frontier = nextFrontier;
  }

  return { candidates, levelsSearched, scansPerformed, truncated };
}

function findPointersNear(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  targetAddress: bigint,
  maxOffset: number,
  maxRegionBytes: number,
  maxTotalBytes: number,
): { matches: PointerHit[]; truncated: boolean } {
  const regions = driver.getRegions(handle).filter((r) => r.size > 0 && r.size <= maxRegionBytes);
  const matches: PointerHit[] = [];
  const maxOffsetBig = BigInt(maxOffset);
  let bytesScanned = 0;
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
    bytesScanned += region.size;

    const alignedLength = region.size - (region.size % 8);
    for (let offset = 0; offset < alignedLength; offset += 8) {
      const pointerValue = buf.readBigUInt64LE(offset);
      const diff = targetAddress - pointerValue;
      if (diff >= 0n && diff <= maxOffsetBig) {
        matches.push({ address: region.baseAddress + BigInt(offset), pointerValue });
      }
    }
  }

  return { matches, truncated };
}
