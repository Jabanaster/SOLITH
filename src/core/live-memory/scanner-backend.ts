/**
 * Production scanner backend contract (Phase 1 / Stage 7 §7.3-§7.4).
 *
 * This is the ONE seam production callers depend on when a scan operation
 * has been migrated to dual-backend routing. It does not replace
 * `MemoryDriver` (the low-level per-value/per-region primitive seam that
 * `memory-scanner.ts`/`aob-resolver.ts`/`pointer-scanner.ts` already use) —
 * it sits above it, at the same level as `LiveMemorySession`'s own scan
 * methods, because that is the one place in the shipping call graph
 * (confirmed by the Stage 7 §7.2 scanner map, `Docs/phase1/72-*.md`) that
 * already knows how to invoke every scan variant. `aob-resolver.ts` and
 * `signature-engine.ts` call `MemoryDriver` directly and bypass
 * `memory-scanner.ts`, so a contract drawn at the `MemoryDriver` level would
 * still miss nothing — but would also force the native backend (which does
 * not implement synchronous `readBuffer`/`getRegions` primitives at all, only
 * whole-operation async scans) into a shape it does not natively have. This
 * contract instead represents the operation SOLITH actually needs (mission
 * §7.3's explicit instruction: "must represent the behavior SOLITH actually
 * needs, not merely mirror the legacy implementation").
 *
 * Migration boundary (this stage): only the two operations directly behind
 * three of the four named shipping defects are routed through this contract
 * this stage — exact-value scan (1 MiB / alignment / int64, all inside
 * `native-memory-driver.ts`'s `readBuffer` + `memory-scanner.ts`'s
 * type-width stride) and AOB scan (the AOB defect). Range/comparison
 * next-scan, unknown-initial-value scan, and pointer scanning remain
 * legacy-only this stage — see `Docs/phase1/83-stage7-legacy-caller-inventory.md`
 * for the explicit, non-silent accounting of why each one is not yet
 * migrated (pointer scanning in particular must stay legacy per mission
 * §7.14 — its defect, D05, is explicitly out of this stage's scope).
 */

/** The 10 canonical primitive types the native scanner core supports. */
export type CanonicalPrimitiveType = 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'i64' | 'u64' | 'f32' | 'f64';

/** Which concrete implementation actually produced a given outcome. */
export type ScannerBackendKind = 'legacy' | 'native';

/**
 * Backend routing mode (mission §7.5). Selects which backend(s) a routed
 * operation actually runs against. Never silently substituted — the
 * effective mode used for a given call is always the one requested, and is
 * always recorded in the returned outcome's `routing` field so a caller (or
 * a test) can prove no hidden fallback occurred.
 */
export type ScannerRoutingMode = 'LEGACY' | 'NATIVE' | 'SHADOW_COMPARE';

/**
 * Every difference between a legacy and native shadow result must be
 * classified as exactly one of these (mission §7.7) — a difference is never
 * left unclassified, and a difference is never assumed to be a native
 * defect just because it disagrees with legacy.
 */
export type ParityDifferenceClassification =
  | 'NATIVE_BUG'
  | 'LEGACY_BUG'
  | 'EXPECTED_NATIVE_CORRECTION'
  | 'SEMANTIC_DIFFERENCE_REQUIRING_OWNER_DECISION'
  | 'TEST_FIXTURE_ERROR'
  | 'UNSUPPORTED_OPERATION';

/** Canonical, BigInt-safe scan completeness (mirrors the native core's `ScanCompleteness`). */
export type CanonicalCompleteness =
  | { state: 'complete' }
  | { state: 'complete_with_skipped_regions'; skipped: CanonicalSkippedRange[] }
  | { state: 'cancelled'; atByte: bigint }
  | { state: 'process_exited'; atByte: bigint }
  | { state: 'resource_limit'; atByte: bigint }
  | { state: 'failed'; reason: string };

export interface CanonicalSkippedRange {
  baseAddress: bigint;
  size: bigint;
  reason: string;
}

/**
 * A single canonical match. `valueBigint` is populated (and `valueNumber`
 * left unset) for i64/u64 — mission §7.4/§7.12's "do not truncate BigInt to
 * Number" — every other type populates `valueNumber`. Address is always
 * BigInt, never down-converted.
 */
export interface CanonicalScanMatch {
  address: bigint;
  primitiveType: CanonicalPrimitiveType;
  valueNumber?: number;
  valueBigint?: bigint;
}

export interface CanonicalPatternMatch {
  address: bigint;
  length: number;
}

export interface CanonicalMetrics {
  regionsConsidered: number;
  regionsRead: number;
  regionsSkipped: number;
  bytesRequested: bigint;
  bytesRead: bigint;
  elapsedMillis: bigint;
}

export interface CanonicalExactScanOutcome {
  backend: ScannerBackendKind;
  matches: CanonicalScanMatch[];
  completeness: CanonicalCompleteness;
  /** True iff `matches` is empty AND `completeness.state === 'complete'` (Stage 6 §6.3's rule, generalized to the canonical model). */
  isAuthoritativeAbsence: boolean;
  metrics: CanonicalMetrics;
}

export interface CanonicalPatternScanOutcome {
  backend: ScannerBackendKind;
  matches: CanonicalPatternMatch[];
  completeness: CanonicalCompleteness;
  isAuthoritativeAbsence: boolean;
  metrics: CanonicalMetrics;
}

/** A structured, typed scanner-backend error — never a bare thrown string. */
export class ScannerBackendError extends Error {
  constructor(
    public readonly kind:
      | 'native_addon_missing'
      | 'native_addon_load_failed'
      | 'attach_failed'
      | 'access_denied'
      | 'target_exited'
      | 'invalid_input'
      | 'unsupported_operation'
      | 'cancelled'
      | 'internal_error',
    message: string,
  ) {
    super(message);
    this.name = 'ScannerBackendError';
  }
}

/** Bounds shared by exact and AOB scan (mirrors `ScanBounds`, canonicalized). */
export interface CanonicalScanBounds {
  maxRegionBytes?: number;
  maxTotalBytes?: number;
  maxMatches?: number;
}

/**
 * Cancellation + progress for a routed scan (mission §7.3). Standard
 * `AbortSignal` rather than a bespoke handle type — every backend adapts it
 * to its own native shape (native: a real `ScanCancellationHandle` wired to
 * the signal's `abort` event, proven deterministic in Stage 6; legacy: a
 * best-effort pre-flight check only, since the legacy scan loop has no
 * chunk-level interruption point to honor mid-flight — this asymmetry is
 * real and documented, not hidden).
 */
export interface ScanControl {
  signal?: AbortSignal;
  onProgress?: (metrics: CanonicalMetrics) => void;
}

/**
 * A single production scanner backend. Both `LegacyScannerBackend` and
 * `NativeScannerBackend` implement this. Every method is async — the native
 * backend's operations are inherently async (napi worker-thread pool), and
 * the legacy backend's synchronous work is wrapped in `Promise.resolve` so
 * callers never need to know which backend they hold.
 */
export interface ScannerBackend {
  readonly kind: ScannerBackendKind;
  /**
   * Attaches this backend to `pid` for the duration of the routed
   * operations that follow. Legacy reuses the session's existing
   * `MemoryDriver` handle (no second OS attach); native opens its own
   * independent read-only handle to the same PID. Throws
   * `ScannerBackendError` (never a bare Error) on failure.
   */
  attach(pid: number): Promise<void>;
  /** Releases this backend's resources for the current target, if any were acquired. Idempotent. */
  detach(): Promise<void>;
  exactScan(
    primitiveType: CanonicalPrimitiveType,
    valueNumber: number | undefined,
    valueBigint: bigint | undefined,
    bounds: CanonicalScanBounds,
    control?: ScanControl,
  ): Promise<CanonicalExactScanOutcome>;
  aobScan(
    pattern: string,
    moduleName: string | undefined,
    bounds: CanonicalScanBounds,
    control?: ScanControl,
  ): Promise<CanonicalPatternScanOutcome>;
}

/** Maps the legacy `LiveValueType` union onto the canonical 10-type native primitive set. */
export const LIVE_VALUE_TYPE_TO_CANONICAL: Record<string, CanonicalPrimitiveType> = {
  byte: 'u8',
  int32: 'i32',
  uint32: 'u32',
  float: 'f32',
  double: 'f64',
  int64: 'i64',
};

export function liveValueTypeToCanonical(dataType: string): CanonicalPrimitiveType {
  const mapped = LIVE_VALUE_TYPE_TO_CANONICAL[dataType];
  if (!mapped) {
    throw new ScannerBackendError('invalid_input', `Unsupported data type "${dataType}" for backend-routed scan.`);
  }
  return mapped;
}
