/**
 * `LegacyScannerBackend` (Phase 1 / Stage 7 §7.3) — adapts the existing,
 * unmodified shipping scan functions (`memory-scanner.ts`'s `scanFirst`,
 * `aob-resolver.ts`'s `scanAobInProcess`) to the canonical `ScannerBackend`
 * contract. This is a pure adapter: it changes no legacy behavior. When a
 * routed operation runs in `LEGACY` mode, its output is byte-for-byte
 * equivalent to calling the legacy function directly — the same regions are
 * scanned, the same 1 MiB `readBuffer` ceiling applies, the same silent
 * region-skip-on-throw happens, the same type-width stride is used. Closing
 * any shipping-product defect requires the NATIVE backend to actually be
 * routing-authoritative for that operation, never a change made here.
 */
import type { LiveProcessHandle, LiveValueType, MemoryDriver } from './types.js';
import { scanFirst as scanFirstRegions } from './memory-scanner.js';
import { scanAobInProcess } from './aob-resolver.js';
import {
  liveValueTypeToCanonical,
  ScannerBackendError,
  type CanonicalExactScanOutcome,
  type CanonicalMemoryRegion,
  type CanonicalPatternScanOutcome,
  type CanonicalPrimitiveType,
  type CanonicalRegionReadOutcome,
  type CanonicalScanBounds,
  type CanonicalTargetModule,
  type ScanControl,
  type ScannerBackend,
} from './scanner-backend.js';

function checkNotAborted(control: ScanControl | undefined): void {
  if (control?.signal?.aborted) {
    throw new ScannerBackendError('cancelled', 'Scan cancelled before the legacy backend began (pre-flight check).');
  }
}

const CANONICAL_TO_LIVE_VALUE_TYPE: Record<CanonicalPrimitiveType, string | undefined> = {
  u8: 'byte',
  i32: 'int32',
  u32: 'uint32',
  f32: 'float',
  f64: 'double',
  i64: 'int64',
  i8: undefined,
  i16: undefined,
  u16: undefined,
  u64: undefined,
};

/**
 * Legacy has no bytewise/unaligned scan mode at all (that is exactly D03,
 * the alignment shipping defect this stage tracks but does not close for
 * the legacy path) — every legacy value read steps by the type's own width.
 * `alignment` is accepted here only so the contract's shape stays uniform
 * across backends; legacy silently ignores it, which is the truthful
 * behavior, not a bug this adapter should paper over.
 */
export class LegacyScannerBackend implements ScannerBackend {
  readonly kind = 'legacy' as const;
  private driver: MemoryDriver | null = null;
  private handle: LiveProcessHandle | null = null;

  /** Reuses an already-open legacy `MemoryDriver` + handle — never opens a second legacy attach. */
  constructor(driver: MemoryDriver, handle: LiveProcessHandle) {
    this.driver = driver;
    this.handle = handle;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async attach(_pid: number): Promise<void> {
    // No-op by design: this backend is always constructed already-attached,
    // sharing the session's existing legacy handle (see class doc).
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async detach(): Promise<void> {
    // No-op by design: the shared legacy handle's lifecycle is owned by
    // `LiveMemorySession`, not by this adapter.
  }

  /**
   * Stage 7.5 - legacy's own region model (`MemoryRegion` in `types.ts`) is
   * narrower than the native one: it carries only `writable`, with no
   * readable/executable protection bits at all. `isReadable` is therefore
   * reported as `true` for every enumerated region, which is legacy's real,
   * existing assumption (`aob-resolver.ts` and `memory-scanner.ts` both just
   * attempt the read and treat a throw as "skip"), not a claim this adapter
   * is inventing. The consequence - that legacy discovers unreadability only
   * by failing - is exactly what `readRegion` below reports honestly.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async enumerateRegions(): Promise<CanonicalMemoryRegion[]> {
    if (!this.driver || !this.handle) {
      throw new ScannerBackendError('attach_failed', 'Legacy backend is not attached.');
    }
    return this.driver.getRegions(this.handle).map((r) => ({
      baseAddress: r.baseAddress,
      size: BigInt(r.size),
      isReadable: true,
      isWritable: r.writable,
      isExecutable: false,
    }));
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async enumerateModules(): Promise<CanonicalTargetModule[]> {
    if (!this.driver || !this.handle) {
      throw new ScannerBackendError('attach_failed', 'Legacy backend is not attached.');
    }
    return this.driver.getModules(this.handle).map((m) => ({
      name: m.name,
      baseAddress: m.baseAddress,
      size: BigInt(m.size),
    }));
  }

  /**
   * Stage 7.5 - a pure adapter over `MemoryDriver.readBuffer`, deliberately
   * preserving every legacy limitation rather than repairing it here. The
   * single most important one: `native-memory-driver.ts`'s `readBuffer`
   * **throws** for any `size > 1048576`, so under LEGACY every region larger
   * than 1 MiB yields zero bytes. That is D01, and it must stay true on this
   * path or explicit LEGACY rollback would no longer be a faithful rollback,
   * and SHADOW_COMPARE would have nothing real to compare.
   *
   * What this adapter DOES change is the silence. Legacy's own callers
   * (`aob-resolver.ts`'s and `signature-engine.ts`'s `catch { continue; }`)
   * swallowed that throw and let an uncovered region masquerade as a covered
   * one with no match - D03, a false "not found" that no caller could
   * distinguish from a true absence. Here the same failure is surfaced as a
   * `complete_with_skipped_regions` range carrying the real reason, so a
   * resolver built on this contract can refuse to call the result
   * authoritative. The defect stays; the lie does not.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async readRegion(
    region: CanonicalMemoryRegion,
    bounds: CanonicalScanBounds,
    control?: ScanControl,
  ): Promise<CanonicalRegionReadOutcome> {
    checkNotAborted(control);
    if (!this.driver || !this.handle) {
      throw new ScannerBackendError('attach_failed', 'Legacy backend is not attached.');
    }

    const skippedOutcome = (reason: string): CanonicalRegionReadOutcome => {
      const metrics = {
        regionsConsidered: 1,
        regionsRead: 0,
        regionsSkipped: 1,
        bytesRequested: region.size,
        bytesRead: 0n,
        elapsedMillis: 0n,
      };
      control?.onProgress?.(metrics);
      return {
        backend: 'legacy',
        slices: [],
        completeness: {
          state: 'complete_with_skipped_regions',
          skipped: [{ baseAddress: region.baseAddress, size: region.size, reason }],
        },
        metrics,
      };
    };

    if (bounds.maxRegionBytes !== undefined && region.size > BigInt(bounds.maxRegionBytes)) {
      return skippedOutcome('max_region_bytes');
    }
    if (region.size <= 0n || region.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      return skippedOutcome('legacy_region_size_unrepresentable');
    }

    let buffer: Buffer;
    try {
      buffer = this.driver.readBuffer(this.handle, region.baseAddress, Number(region.size));
    } catch (err) {
      return skippedOutcome(`legacy_read_failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const metrics = {
      regionsConsidered: 1,
      regionsRead: 1,
      regionsSkipped: 0,
      bytesRequested: region.size,
      bytesRead: BigInt(buffer.length),
      elapsedMillis: 0n,
    };
    control?.onProgress?.(metrics);

    // A short read is a partial read: say so rather than treating the missing
    // tail as scanned-and-empty.
    const shortfall = region.size - BigInt(buffer.length);
    return {
      backend: 'legacy',
      slices: buffer.length > 0 ? [{ baseAddress: region.baseAddress, data: buffer }] : [],
      completeness:
        shortfall > 0n
          ? {
              state: 'complete_with_skipped_regions',
              skipped: [
                {
                  baseAddress: region.baseAddress + BigInt(buffer.length),
                  size: shortfall,
                  reason: 'legacy_short_read',
                },
              ],
            }
          : { state: 'complete' },
      metrics,
    };
  }

  async exactScan(
    primitiveType: CanonicalPrimitiveType,
    valueNumber: number | undefined,
    valueBigint: bigint | undefined,
    bounds: CanonicalScanBounds,
    control?: ScanControl,
  ): Promise<CanonicalExactScanOutcome> {
    checkNotAborted(control);
    if (!this.driver || !this.handle) {
      throw new ScannerBackendError('attach_failed', 'Legacy backend is not attached.');
    }
    const liveType = CANONICAL_TO_LIVE_VALUE_TYPE[primitiveType];
    if (!liveType) {
      throw new ScannerBackendError(
        'unsupported_operation',
        `Legacy backend has no equivalent of primitive type "${primitiveType}".`,
      );
    }
    if (liveType === 'int64' && valueBigint === undefined) {
      throw new ScannerBackendError('invalid_input', 'int64 exact scan requires a BigInt value.');
    }
    // Legacy's own `readMemory`/`decodeValue` narrows int64 through `Number`
    // (D06 — see Docs/phase1/71-stage6-defect-accounting-repair.md) — this
    // adapter must not paper over that by silently doing a wider read. It
    // legitimately cannot search for an exact int64 value beyond
    // `Number.MAX_SAFE_INTEGER` precision; scanning here uses the lossy
    // `Number` value on purpose, so the returned outcome's own
    // `isAuthoritativeAbsence`/precision truthfully reflects legacy's real,
    // documented limitation rather than hiding it.
    const targetValue = liveType === 'int64' ? Number(valueBigint) : (valueNumber ?? Number(valueBigint));

    // `scanFirst`'s own `truncated` flag reflects only the `maxTotalBytes`/
    // `maxMatches` budgets — it is NEVER set when a region is silently
    // skipped after `readBuffer` throws (the exact D01 truth-reporting gap
    // this stage tracks; see `memory-scanner.ts`'s `catch { continue; }`).
    // This adapter cannot change that function's behavior, but it CAN
    // detect the gap itself: `driver.getRegions` is called again here,
    // independently, with the same writable/size filter `scanFirst` applies
    // internally, so `regionsScanned` can be compared against the true
    // candidate count — an honest completeness signal legacy's own return
    // value structurally cannot provide.
    const maxRegionBytes = bounds.maxRegionBytes ?? 64 * 1024 * 1024;
    const candidateRegionCount = this.driver
      .getRegions(this.handle)
      .filter((r) => r.writable && r.size > 0 && r.size <= maxRegionBytes).length;

    let result: ReturnType<typeof scanFirstRegions>;
    try {
      result = scanFirstRegions(this.driver, this.handle, liveType as LiveValueType, targetValue, {
        maxRegionBytes: bounds.maxRegionBytes,
        maxTotalBytes: bounds.maxTotalBytes,
        maxMatches: bounds.maxMatches,
      });
    } catch (err) {
      // A real, separately-discovered legacy defect (Stage 7 evidence): an
      // int64 target value that narrows to a Number at or beyond 2^63 when
      // re-widened via `BigInt(Number(value))` throws inside
      // `encodeValue`'s `writeBigInt64LE` — uncaught by `scanFirst` itself,
      // since that call happens before the per-region try/catch. This
      // adapter must not let that crash the caller; it is surfaced as a
      // typed, documented error instead.
      throw new ScannerBackendError(
        'internal_error',
        `Legacy exact scan threw for dataType "${liveType}" and value ${String(targetValue)}: ${String(err)}`,
      );
    }

    const regionsSkipped = Math.max(0, candidateRegionCount - result.regionsScanned);
    const metrics = {
      regionsConsidered: candidateRegionCount,
      regionsRead: result.regionsScanned,
      regionsSkipped,
      bytesRequested: BigInt(result.bytesScanned),
      bytesRead: BigInt(result.bytesScanned),
      elapsedMillis: 0n,
    };
    control?.onProgress?.(metrics);
    const incomplete = result.truncated || regionsSkipped > 0;
    return {
      backend: 'legacy',
      matches: result.matches.map((m) => ({
        address: m.address,
        primitiveType,
        ...(liveType === 'int64' ? { valueBigint: BigInt(Math.trunc(m.value)) } : { valueNumber: m.value }),
      })),
      completeness: incomplete ? { state: 'complete_with_skipped_regions', skipped: [] } : { state: 'complete' },
      isAuthoritativeAbsence: result.matches.length === 0 && !incomplete,
      metrics,
    };
  }

  async aobScan(
    pattern: string,
    moduleName: string | undefined,
    _bounds: CanonicalScanBounds,
    control?: ScanControl,
  ): Promise<CanonicalPatternScanOutcome> {
    checkNotAborted(control);
    if (!this.driver || !this.handle) {
      throw new ScannerBackendError('attach_failed', 'Legacy backend is not attached.');
    }
    // Legacy AOB (`aob-resolver.ts`) now reports which eligible regions it
    // could not read, so this adapter passes the real completeness through
    // instead of the blanket "complete_with_skipped_regions, skip list
    // unknown" it had to assume while the legacy scan swallowed every read
    // failure. A legacy miss over fully-read regions is now allowed to be a
    // genuine authoritative absence; a miss with any unreadable region is
    // still never one.
    const outcome = scanAobInProcess(this.driver, this.handle, pattern, { moduleName });
    const matches = outcome.address !== null ? [{ address: outcome.address, length: 0 }] : [];
    const metrics = {
      regionsConsidered: outcome.regionsConsidered,
      regionsRead: outcome.regionsRead,
      regionsSkipped: outcome.skippedRegions.length,
      bytesRequested: 0n,
      bytesRead: 0n,
      elapsedMillis: 0n,
    };
    control?.onProgress?.(metrics);
    return {
      backend: 'legacy',
      matches,
      completeness: outcome.completeness,
      isAuthoritativeAbsence: outcome.isAuthoritativeAbsence,
      metrics,
    };
  }
}

export { liveValueTypeToCanonical };
