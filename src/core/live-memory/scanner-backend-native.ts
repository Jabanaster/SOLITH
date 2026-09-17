/**
 * `NativeScannerBackend` (Phase 1 / Stage 7 §7.3) — adapts the certified
 * Stage 1-6 native scanner (`native/solith-scanner-napi`, wrapping
 * `native/solith-scanner-core`) to the canonical `ScannerBackend` contract.
 *
 * This is genuinely a second, independent read-only attach to the same
 * target PID (see `NativeScanTarget.attach`'s own doc comment: it performs
 * no policy check itself, so this module never constructs one except when
 * called through `ScannerBackendRouter`, which is only ever invoked from
 * `LiveMemorySession` — i.e. after the existing game-scoped authority
 * boundary, attach authorization, and online-guard checks have already run
 * for the *legacy* handle covering the same PID. This module adds no new
 * authority surface.
 *
 * Addon loading (mission §7.18/§7.26 — "native addon missing" must be a
 * clear error, never a crash): primary path is a normal Node
 * `require('solith-scanner-napi')`, which resolves via the real
 * `node_modules/solith-scanner-napi` entry created by `npm install`'s
 * `file:native/solith-scanner-napi` dependency (works identically in tests,
 * Electron dev, and — since `node_modules/solith-scanner-napi/**` is now an
 * `asarUnpack` entry — the packaged app). If that resolution fails (e.g. a
 * packaging edge case where the symlinked `file:` dependency did not
 * survive), a documented fallback tries the `extraResources` copy shipped
 * alongside the packaged app (`process.resourcesPath` is only ever set when
 * running under the real Electron binary, so this fallback is inert, not
 * merely unreachable, under plain Node/tsx test runs).
 */
import { createRequire as nodeCreateRequire } from 'node:module';
import { join } from 'node:path';
import {
  liveValueTypeToCanonical,
  ScannerBackendError,
  type CanonicalExactScanOutcome,
  type CanonicalMemoryRegion,
  type CanonicalPatternScanOutcome,
  type CanonicalPrimitiveType,
  type CanonicalRegionReadOutcome,
  type CanonicalRegionSlice,
  type CanonicalScanBounds,
  type CanonicalSkippedRange,
  type CanonicalTargetModule,
  type ScanControl,
  type ScannerBackend,
} from './scanner-backend.js';

const nodeRequire = nodeCreateRequire(import.meta.url);

/** Narrow view of the generated napi bindings this adapter actually uses (see `index.d.ts`). */
interface NativeScannerAddon {
  NativeScanTarget: {
    attach(pid: number): NativeScanTargetInstance;
  };
  ScanCancellationHandle: new () => { cancel(): void; isCancelled: boolean };
  ScanProgressHandle: new () => { snapshot(): NativeProgress };
}

interface NativeScanTargetInstance {
  detach(): void;
  isAttached(): boolean;
  enumerateRegions(): NativeRegion[];
  readRegionChunked(
    region: NativeRegion,
    chunkSizeBytes: bigint,
    overlapBytes: bigint,
    cancellation: unknown,
    progress: unknown,
  ): Promise<NativeReadRegionOutcome>;
  scanExact(
    region: NativeRegion,
    primitiveType: string,
    valueNumber: number | undefined,
    valueBigint: bigint | undefined,
    alignment: string,
    chunkSizeBytes: bigint,
    overlapBytes: bigint,
    maxResults: bigint | undefined,
    cancellation: unknown,
    progress: unknown,
  ): Promise<NativeExactOutcome>;
  scanAob(
    region: NativeRegion,
    pattern: string,
    chunkSizeBytes: bigint,
    maxResults: bigint | undefined,
    firstMatchOnly: boolean | undefined,
    cancellation: unknown,
    progress: unknown,
  ): Promise<NativePatternOutcome>;
}

interface NativeRegion {
  baseAddress: bigint;
  size: bigint;
  allocationBase: bigint;
  commitState: string;
  kind: string;
  isReadable: boolean;
  isWritable: boolean;
  isExecutable: boolean;
  isGuard: boolean;
  isNoaccess: boolean;
  rawProtect: number;
  rawType: number;
}

interface NativeCompleteness {
  state: string;
  atByte?: bigint;
  skipped?: Array<{ baseAddress: bigint; size: bigint; reason: string }>;
  failedReason?: string;
}

interface NativeProgress {
  regionsTotal: number;
  regionsConsidered: number;
  regionsRead: number;
  regionsSkipped: number;
  bytesRequested: bigint;
  bytesRead: bigint;
  elapsedMillis: bigint;
}

interface NativeExactOutcome {
  matches: Array<{ address: bigint; primitiveType: string; valueNumber?: number; valueBigint?: bigint }>;
  metrics: NativeProgress;
  completeness: NativeCompleteness;
  isAuthoritativeAbsence: boolean;
}

/** One chunk of a `readRegionChunked` result (mirrors `JsChunkReadResult`). */
interface NativeChunkReadResult {
  chunkBase: bigint;
  requestedSize: bigint;
  /** "success" | "partial_read" | "access_denied" | "target_exited" | "invalid_address" | "os_error" | "resource_limit" | "cancelled". */
  status: string;
  bytesReadIfPartial?: bigint;
  data: Buffer;
}

interface NativeReadRegionOutcome {
  chunks: NativeChunkReadResult[];
  metrics: NativeProgress;
  completeness: NativeCompleteness;
}

interface NativePatternOutcome {
  matches: Array<{ address: bigint; length: number }>;
  metrics: NativeProgress;
  completeness: NativeCompleteness;
  isAuthoritativeAbsence: boolean;
}

let cachedAddon: NativeScannerAddon | null = null;

/**
 * Stage 7.4 §14 — distinguishes "the module specifier could not be found at
 * all" (`err.code === 'MODULE_NOT_FOUND'`, Node's own standard code for a
 * genuinely absent/unresolvable module — e.g. `npm install` was never run)
 * from "the module was found but failed to load" (any other error — e.g. a
 * corrupted `.node` binary, napi-rs's own generated loader throwing
 * "Cannot find native binding" after every platform candidate it tried
 * failed). Real, structured evidence for this split is in
 * `scanner-backend-failure-injection-real.test.ts`. Before this pass every
 * `require('solith-scanner-napi')` failure under plain Node (no
 * `process.resourcesPath`) collapsed into `native_addon_missing` regardless
 * of which of these two genuinely different problems actually occurred.
 */
function isModuleNotFoundError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === 'MODULE_NOT_FOUND';
}

function loadNativeScannerAddon(): NativeScannerAddon {
  if (cachedAddon) return cachedAddon;
  try {
    cachedAddon = nodeRequire('solith-scanner-napi') as NativeScannerAddon;
    return cachedAddon;
  } catch (err) {
    if (typeof process.resourcesPath === 'string') {
      try {
        const packagedPath = join(process.resourcesPath, 'native', 'solith-scanner-napi', 'index.js');
        cachedAddon = nodeRequire(packagedPath) as NativeScannerAddon;
        return cachedAddon;
      } catch (packagedErr) {
        throw new ScannerBackendError(
          'native_addon_load_failed',
          `Native scanner addon failed to load from both node_modules and the packaged ` +
            `resources copy. node_modules error: ${String(err)}; packaged-resources error: ${String(packagedErr)}`,
        );
      }
    }
    if (isModuleNotFoundError(err)) {
      throw new ScannerBackendError(
        'native_addon_missing',
        `Native scanner addon ("solith-scanner-napi") is not installed/built for this Node/Electron ` +
          `ABI. Run "npm install" at the project root, then "npm run build --prefix native/solith-scanner-napi". ` +
          `Underlying error: ${String(err)}`,
      );
    }
    throw new ScannerBackendError(
      'native_addon_load_failed',
      `Native scanner addon ("solith-scanner-napi") was found but failed to load — the installed ` +
        `binary may be corrupted or built for the wrong platform/ABI. Underlying error: ${String(err)}`,
    );
  }
}

function toNativeCompleteness(c: NativeCompleteness): CanonicalExactScanOutcome['completeness'] {
  switch (c.state) {
    case 'complete':
      return { state: 'complete' };
    case 'complete_with_skipped_regions':
      return {
        state: 'complete_with_skipped_regions',
        skipped: (c.skipped ?? []).map(
          (s): CanonicalSkippedRange => ({ baseAddress: s.baseAddress, size: s.size, reason: s.reason }),
        ),
      };
    case 'cancelled':
      return { state: 'cancelled', atByte: c.atByte ?? 0n };
    case 'process_exited':
      return { state: 'process_exited', atByte: c.atByte ?? 0n };
    case 'resource_limit':
      return { state: 'resource_limit', atByte: c.atByte ?? 0n };
    default:
      return { state: 'failed', reason: c.failedReason ?? c.state };
  }
}

/**
 * Accumulates the per-region completeness outcomes of a multi-region scan into
 * one truthful answer.
 *
 * This backend scans one region per native call, so each call returns its own
 * completeness. The previous code kept only the most recent non-complete
 * outcome (`worstCompleteness = outcome.completeness`), which silently threw
 * away every earlier region's skipped ranges. Measuring real-game coverage is
 * what exposed it: a Stardew Valley scan left 375 MiB of eligible memory
 * unread across many policy-excluded regions and reported exactly ONE skipped
 * range of 53 KiB, because only the last one survived.
 *
 * The rules, in order of severity:
 *
 * - A terminal stop (cancelled / process_exited / resource_limit / failed)
 *   outranks everything: the scan stopped, and the first such stop is the one
 *   that ended it.
 * - Otherwise every skipped range from every region is kept, so
 *   `complete_with_skipped_regions` lists all of them rather than the last.
 * - `complete` only survives if no region reported anything else.
 */
class CompletenessAccumulator {
  private readonly skipped: CanonicalSkippedRange[] = [];
  private terminal: CanonicalExactScanOutcome['completeness'] | null = null;

  /** True once a terminal stop has been recorded; the caller should stop scanning. */
  get stopped(): boolean {
    return this.terminal !== null;
  }

  add(outcome: NativeCompleteness): void {
    const canonical = toNativeCompleteness(outcome);
    if (canonical.state === 'complete') return;
    if (canonical.state === 'complete_with_skipped_regions') {
      for (const range of canonical.skipped) this.skipped.push(range);
      return;
    }
    // First terminal stop wins — it is the one that actually ended the scan.
    this.terminal ??= canonical;
  }

  /** Records a stop this backend decided on itself (a bound, not a native outcome). */
  stop(completeness: CanonicalExactScanOutcome['completeness']): void {
    this.terminal ??= completeness;
  }

  result(): CanonicalExactScanOutcome['completeness'] {
    if (this.terminal !== null) return this.terminal;
    if (this.skipped.length > 0) return { state: 'complete_with_skipped_regions', skipped: [...this.skipped] };
    return { state: 'complete' };
  }
}

function toCanonicalMetrics(m: NativeProgress) {
  return {
    regionsConsidered: m.regionsConsidered,
    regionsRead: m.regionsRead,
    regionsSkipped: m.regionsSkipped,
    bytesRequested: m.bytesRequested,
    bytesRead: m.bytesRead,
    elapsedMillis: m.elapsedMillis,
  };
}

/** Default chunk/overlap sizes — same values the Stage 1-6 native test suite already certified. */
const DEFAULT_CHUNK_SIZE_BYTES = 64n * 1024n;
const DEFAULT_OVERLAP_BYTES = 7n;
// Stage 7.1 §2 — real, confirmed defect: unlike `memory-scanner.ts`'s
// `scanFirst` (which has always applied its own `DEFAULT_MAX_MATCHES =
// 10_000` whenever a caller omits `bounds.maxMatches`), this backend had NO
// default at all — `exactScan` accumulated every match from every region
// into one in-memory array with no bound unless the caller explicitly
// supplied `maxMatches`. Proven real via a live NATIVE-mode scan against a
// real game (Godlike Burger, u32 value 100): 151,382 real matches
// accumulated in one JS array with no limit. Matching legacy's own existing
// safe default here closes that gap for every caller of this backend, not
// just the ones that happen to pass an explicit bound.
const DEFAULT_MAX_MATCHES = 10_000;

/**
 * Supplies the target's loaded modules to the native backend. Stage 7.5 - the
 * native addon exposes region enumeration and chunked region reads, but no
 * module enumeration at all (see `native/solith-scanner-napi/index.d.ts`:
 * `NativeScanTarget` has `enumerateRegions`, with no module equivalent).
 * Module identity is target metadata, not scan/read data, and carries none of
 * the defects this migration closes - so rather than let a module-scoped
 * fuzzy request silently widen to the whole address space under NATIVE (a
 * genuine false-positive hazard for a drift-tolerant matcher, unlike for
 * exact AOB), `LiveMemorySession` injects the same OS module list both
 * backends already see. Real module enumeration inside the native core is
 * forward-assigned to Stage 8; until then this is an explicit, disclosed
 * shared-metadata seam, not a hidden legacy scan path.
 */
export type TargetModuleProvider = () => CanonicalTargetModule[];

export class NativeScannerBackend implements ScannerBackend {
  readonly kind = 'native' as const;
  private target: NativeScanTargetInstance | null = null;
  /**
   * Native regions from the most recent `enumerateRegions()`, keyed by base
   * address, so `readRegion` can hand the addon back the exact `JsRegion` it
   * produced - protection flags and all - instead of a lossy reconstruction.
   */
  private readonly nativeRegionsByBase = new Map<string, NativeRegion>();

  constructor(private readonly moduleProvider?: TargetModuleProvider) {}

  async attach(pid: number): Promise<void> {
    const addon = loadNativeScannerAddon();
    try {
      this.target = addon.NativeScanTarget.attach(pid);
    } catch (err) {
      throw new ScannerBackendError('attach_failed', `Native backend failed to attach to pid ${pid}: ${String(err)}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async detach(): Promise<void> {
    this.target?.detach();
    this.target = null;
    this.nativeRegionsByBase.clear();
  }

  private wireCancellation(control: ScanControl | undefined): {
    cancellation: { cancel(): void; isCancelled: boolean };
    progress: { snapshot(): NativeProgress };
    cleanup: () => void;
  } {
    const addon = loadNativeScannerAddon();
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();
    const onAbort = () => cancellation.cancel();
    control?.signal?.addEventListener('abort', onAbort);
    if (control?.signal?.aborted) cancellation.cancel();
    return {
      cancellation,
      progress,
      cleanup: () => control?.signal?.removeEventListener('abort', onAbort),
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async enumerateRegions(): Promise<CanonicalMemoryRegion[]> {
    if (!this.target) {
      throw new ScannerBackendError('attach_failed', 'Native backend is not attached.');
    }
    const native = this.target.enumerateRegions();
    this.nativeRegionsByBase.clear();
    const canonical: CanonicalMemoryRegion[] = [];
    for (const r of native) {
      this.nativeRegionsByBase.set(r.baseAddress.toString(), r);
      canonical.push({
        baseAddress: r.baseAddress,
        size: r.size,
        isReadable: r.isReadable && !r.isGuard && !r.isNoaccess,
        isWritable: r.isWritable,
        isExecutable: r.isExecutable,
      });
    }
    return canonical;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async enumerateModules(): Promise<CanonicalTargetModule[]> {
    if (!this.moduleProvider) {
      throw new ScannerBackendError(
        'unsupported_operation',
        'Native backend has no module provider bound - the native scanner core does not enumerate ' +
          'modules itself (forward-assigned to Stage 8). A module-scoped request must not silently ' +
          'widen to the whole address space, so this fails closed rather than returning an empty list.',
      );
    }
    return this.moduleProvider();
  }

  async readRegion(
    region: CanonicalMemoryRegion,
    bounds: CanonicalScanBounds,
    control?: ScanControl,
  ): Promise<CanonicalRegionReadOutcome> {
    if (!this.target) {
      throw new ScannerBackendError('attach_failed', 'Native backend is not attached.');
    }

    if (bounds.maxRegionBytes !== undefined && region.size > BigInt(bounds.maxRegionBytes)) {
      // Refused on purpose, and said out loud: an over-budget region is a
      // region this read did NOT cover, so it is reported as a skipped range
      // rather than as a clean, empty, authoritative read.
      return {
        backend: 'native',
        slices: [],
        completeness: {
          state: 'complete_with_skipped_regions',
          skipped: [{ baseAddress: region.baseAddress, size: region.size, reason: 'max_region_bytes' }],
        },
        metrics: {
          regionsConsidered: 1,
          regionsRead: 0,
          regionsSkipped: 1,
          bytesRequested: 0n,
          bytesRead: 0n,
          elapsedMillis: 0n,
        },
      };
    }

    const nativeRegion: NativeRegion = this.nativeRegionsByBase.get(region.baseAddress.toString()) ?? {
      baseAddress: region.baseAddress,
      size: region.size,
      allocationBase: region.baseAddress,
      commitState: 'commit',
      kind: 'private',
      isReadable: region.isReadable,
      isWritable: region.isWritable,
      isExecutable: region.isExecutable,
      isGuard: false,
      isNoaccess: false,
      rawProtect: 0,
      rawType: 0,
    };

    const { cancellation, progress, cleanup } = this.wireCancellation(control);
    try {
      const outcome = await this.target.readRegionChunked(
        nativeRegion,
        DEFAULT_CHUNK_SIZE_BYTES,
        DEFAULT_OVERLAP_BYTES,
        cancellation,
        progress,
      );

      const slices: CanonicalRegionSlice[] = [];
      const skipped: CanonicalSkippedRange[] = [];
      let runBase: bigint | null = null;
      let runParts: Buffer[] = [];
      let runEnd = 0n;

      const flushRun = (): void => {
        if (runBase !== null && runParts.length > 0) {
          slices.push({ baseAddress: runBase, data: Buffer.concat(runParts) });
        }
        runBase = null;
        runParts = [];
        runEnd = 0n;
      };

      const appendChunk = (chunkBase: bigint, data: Buffer): void => {
        if (runBase === null) {
          runBase = chunkBase;
          runParts = [data];
          runEnd = chunkBase + BigInt(data.length);
          return;
        }
        if (chunkBase > runEnd) {
          // A genuine hole between two successful chunks - never stitch over it.
          flushRun();
          runBase = chunkBase;
          runParts = [data];
          runEnd = chunkBase + BigInt(data.length);
          return;
        }
        // Chunks are requested with `DEFAULT_OVERLAP_BYTES` of deliberate
        // overlap so a pattern straddling a chunk boundary is still matchable;
        // drop the already-held prefix so the reassembled slice stays a true
        // 1:1 image of target memory rather than a duplicated one.
        const alreadyHeld = Number(runEnd - chunkBase);
        if (alreadyHeld < data.length) {
          runParts.push(data.subarray(alreadyHeld));
          runEnd = chunkBase + BigInt(data.length);
        }
      };

      for (const chunk of outcome.chunks) {
        const data = chunk.data;
        if (chunk.status === 'success' && data && data.length > 0) {
          appendChunk(chunk.chunkBase, data);
          continue;
        }
        if (chunk.status === 'partial_read' && data && data.length > 0) {
          appendChunk(chunk.chunkBase, data);
          // The unread tail of a partial chunk is a real gap: close the run
          // and record exactly how much was not covered.
          flushRun();
          const unread = chunk.requestedSize - BigInt(data.length);
          if (unread > 0n) {
            skipped.push({
              baseAddress: chunk.chunkBase + BigInt(data.length),
              size: unread,
              reason: 'partial_read',
            });
          }
          continue;
        }
        flushRun();
        skipped.push({ baseAddress: chunk.chunkBase, size: chunk.requestedSize, reason: chunk.status });
      }
      flushRun();

      let completeness = toNativeCompleteness(outcome.completeness);
      if (skipped.length > 0) {
        if (completeness.state === 'complete') {
          completeness = { state: 'complete_with_skipped_regions', skipped };
        } else if (completeness.state === 'complete_with_skipped_regions') {
          completeness = {
            state: 'complete_with_skipped_regions',
            skipped: [...completeness.skipped, ...skipped],
          };
        }
      }

      const metrics = toCanonicalMetrics(outcome.metrics);
      control?.onProgress?.(metrics);
      return { backend: 'native', slices, completeness, metrics };
    } finally {
      cleanup();
    }
  }

  async exactScan(
    primitiveType: CanonicalPrimitiveType,
    valueNumber: number | undefined,
    valueBigint: bigint | undefined,
    bounds: CanonicalScanBounds,
    control?: ScanControl,
  ): Promise<CanonicalExactScanOutcome> {
    if (!this.target) {
      throw new ScannerBackendError('attach_failed', 'Native backend is not attached.');
    }
    const regions = this.target
      .enumerateRegions()
      .filter((r) => r.isReadable && !r.isGuard && !r.isNoaccess)
      .filter((r) => bounds.maxRegionBytes === undefined || r.size <= BigInt(bounds.maxRegionBytes));

    // Stage 7.1 §2 fix — always apply a real bound, whether or not the
    // caller supplied one (see DEFAULT_MAX_MATCHES's doc comment above).
    const effectiveMaxMatches = bounds.maxMatches ?? DEFAULT_MAX_MATCHES;

    const { cancellation, progress, cleanup } = this.wireCancellation(control);
    try {
      const matches: CanonicalExactScanOutcome['matches'] = [];
      let regionsConsidered = 0;
      let regionsRead = 0;
      let regionsSkipped = 0;
      let bytesRequested = 0n;
      let bytesRead = 0n;
      const completenessOf = new CompletenessAccumulator();
      let totalBytesSoFar = 0n;

      for (const region of regions) {
        regionsConsidered += 1;
        if (bounds.maxTotalBytes !== undefined && totalBytesSoFar >= BigInt(bounds.maxTotalBytes)) {
          completenessOf.stop({ state: 'resource_limit', atByte: totalBytesSoFar });
          break;
        }
        const outcome = await this.target.scanExact(
          region,
          primitiveType,
          valueNumber,
          valueBigint,
          'bytewise',
          DEFAULT_CHUNK_SIZE_BYTES,
          DEFAULT_OVERLAP_BYTES,
          BigInt(effectiveMaxMatches - matches.length),
          cancellation,
          progress,
        );
        // Taken from the native metrics rather than incremented blindly: this
        // backend scans one region per call, and the native core may exclude
        // that region by policy, in which case it was iterated but never read.
        // Counting it as read is what made a scan that skipped 375 MiB report
        // `regionsSkipped: 0`.
        regionsRead += outcome.metrics.regionsRead;
        regionsSkipped += outcome.metrics.regionsSkipped;
        bytesRequested += outcome.metrics.bytesRequested;
        bytesRead += outcome.metrics.bytesRead;
        totalBytesSoFar += outcome.metrics.bytesRead;
        matches.push(
          ...outcome.matches.map((m) => ({
            address: m.address,
            primitiveType,
            valueNumber: m.valueNumber,
            valueBigint: m.valueBigint,
          })),
        );
        control?.onProgress?.(toCanonicalMetrics(outcome.metrics));
        completenessOf.add(outcome.completeness);
        if (outcome.completeness.state === 'cancelled' || outcome.completeness.state === 'process_exited') break;
        if (matches.length >= effectiveMaxMatches) {
          completenessOf.stop({ state: 'resource_limit', atByte: totalBytesSoFar });
          break;
        }
      }
      const completeness = completenessOf.result();
      return {
        backend: 'native',
        matches,
        completeness,
        isAuthoritativeAbsence: matches.length === 0 && completeness.state === 'complete',
        metrics: { regionsConsidered, regionsRead, regionsSkipped, bytesRequested, bytesRead, elapsedMillis: 0n },
      };
    } finally {
      cleanup();
    }
  }

  async aobScan(
    pattern: string,
    _moduleName: string | undefined,
    bounds: CanonicalScanBounds,
    control?: ScanControl,
  ): Promise<CanonicalPatternScanOutcome> {
    if (!this.target) {
      throw new ScannerBackendError('attach_failed', 'Native backend is not attached.');
    }
    // Module-scoping (`_moduleName`) is a legacy-only convenience filter
    // applied via `MemoryDriver.getModules` intersection — the native
    // backend does not yet expose module enumeration through this
    // contract, so a module-scoped AOB request always searches every
    // readable region instead. This is a real, current limitation
    // (documented, not silently narrowed): see
    // `Docs/phase1/83-stage7-legacy-caller-inventory.md`.
    const regions = this.target.enumerateRegions().filter((r) => r.isReadable && !r.isGuard && !r.isNoaccess);
    const { cancellation, progress, cleanup } = this.wireCancellation(control);
    try {
      const matches: CanonicalPatternScanOutcome['matches'] = [];
      let regionsConsidered = 0;
      let regionsRead = 0;
      let regionsSkipped = 0;
      let bytesRequested = 0n;
      let bytesRead = 0n;
      const completenessOf = new CompletenessAccumulator();

      for (const region of regions) {
        regionsConsidered += 1;
        const outcome = await this.target.scanAob(
          region,
          pattern,
          DEFAULT_CHUNK_SIZE_BYTES,
          bounds.maxMatches !== undefined ? BigInt(bounds.maxMatches - matches.length) : undefined,
          true,
          cancellation,
          progress,
        );
        regionsRead += outcome.metrics.regionsRead;
        regionsSkipped += outcome.metrics.regionsSkipped;
        bytesRequested += outcome.metrics.bytesRequested;
        bytesRead += outcome.metrics.bytesRead;
        matches.push(...outcome.matches);
        control?.onProgress?.(toCanonicalMetrics(outcome.metrics));
        completenessOf.add(outcome.completeness);
        if (outcome.completeness.state === 'cancelled' || outcome.completeness.state === 'process_exited') break;
        if (matches.length > 0) break; // firstMatchOnly semantics, matching legacy's scanAobInProcess contract
        if (bounds.maxMatches !== undefined && matches.length >= bounds.maxMatches) break;
      }
      const completeness = completenessOf.result();
      return {
        backend: 'native',
        matches,
        completeness,
        isAuthoritativeAbsence: matches.length === 0 && completeness.state === 'complete',
        metrics: {
          regionsConsidered,
          regionsRead,
          regionsSkipped,
          bytesRequested,
          bytesRead,
          elapsedMillis: 0n,
        },
      };
    } finally {
      cleanup();
    }
  }
}

export { liveValueTypeToCanonical };
