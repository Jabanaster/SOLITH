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
  type CanonicalPatternScanOutcome,
  type CanonicalPrimitiveType,
  type CanonicalScanBounds,
  type CanonicalSkippedRange,
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

interface NativePatternOutcome {
  matches: Array<{ address: bigint; length: number }>;
  metrics: NativeProgress;
  completeness: NativeCompleteness;
  isAuthoritativeAbsence: boolean;
}

let cachedAddon: NativeScannerAddon | null = null;

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
    throw new ScannerBackendError(
      'native_addon_missing',
      `Native scanner addon ("solith-scanner-napi") is not installed/built for this Node/Electron ` +
        `ABI. Run "npm install" at the project root, then "npm run build --prefix native/solith-scanner-napi". ` +
        `Underlying error: ${String(err)}`,
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

export class NativeScannerBackend implements ScannerBackend {
  readonly kind = 'native' as const;
  private target: NativeScanTargetInstance | null = null;

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
      let worstCompleteness: NativeCompleteness = { state: 'complete' };
      let totalBytesSoFar = 0n;

      for (const region of regions) {
        regionsConsidered += 1;
        if (bounds.maxTotalBytes !== undefined && totalBytesSoFar >= BigInt(bounds.maxTotalBytes)) {
          worstCompleteness = { state: 'resource_limit', atByte: totalBytesSoFar };
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
        regionsRead += 1;
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
        if (outcome.completeness.state !== 'complete') {
          worstCompleteness = outcome.completeness;
          if (outcome.completeness.state === 'cancelled' || outcome.completeness.state === 'process_exited') break;
        }
        if (matches.length >= effectiveMaxMatches) {
          worstCompleteness = { state: 'resource_limit', atByte: totalBytesSoFar };
          break;
        }
      }
      regionsSkipped = regionsConsidered - regionsRead;
      const completeness = toNativeCompleteness(worstCompleteness);
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
      let bytesRequested = 0n;
      let bytesRead = 0n;
      let worstCompleteness: NativeCompleteness = { state: 'complete' };

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
        regionsRead += 1;
        bytesRequested += outcome.metrics.bytesRequested;
        bytesRead += outcome.metrics.bytesRead;
        matches.push(...outcome.matches);
        control?.onProgress?.(toCanonicalMetrics(outcome.metrics));
        if (outcome.completeness.state !== 'complete') {
          worstCompleteness = outcome.completeness;
          if (outcome.completeness.state === 'cancelled' || outcome.completeness.state === 'process_exited') break;
        }
        if (matches.length > 0) break; // firstMatchOnly semantics, matching legacy's scanAobInProcess contract
        if (bounds.maxMatches !== undefined && matches.length >= bounds.maxMatches) break;
      }
      const completeness = toNativeCompleteness(worstCompleteness);
      return {
        backend: 'native',
        matches,
        completeness,
        isAuthoritativeAbsence: matches.length === 0 && completeness.state === 'complete',
        metrics: {
          regionsConsidered,
          regionsRead,
          regionsSkipped: regionsConsidered - regionsRead,
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
