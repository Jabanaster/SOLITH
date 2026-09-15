/**
 * `ScannerBackendRouter` (Phase 1 / Stage 7 §7.5-§7.7) — the one place a
 * routed scan operation's backend selection is decided, executed, and
 * (in `SHADOW_COMPARE`) diffed and classified. `LiveMemorySession` owns
 * exactly one router instance per attached session.
 *
 * Routing discipline (mission §7.5): the effective backend actually used is
 * always the one recorded in the returned diagnostics — never silently
 * different from the requested mode. A native failure during `NATIVE` mode
 * is surfaced as a thrown `ScannerBackendError` by default (no hidden
 * fallback); `allowFallbackToLegacyOnNativeFailure` exists only for
 * controlled early-canary testing (mission §7.5's explicit carve-out) and
 * always records both the failure and the fact that a fallback occurred.
 */
import {
  ScannerBackendError,
  type CanonicalExactScanOutcome,
  type CanonicalMetrics,
  type CanonicalPatternScanOutcome,
  type CanonicalPrimitiveType,
  type CanonicalScanBounds,
  type ParityDifferenceClassification,
  type ScanControl,
  type ScannerBackend,
  type ScannerBackendKind,
  type ScannerRoutingMode,
} from './scanner-backend.js';

export interface ParityDifference {
  field: string;
  legacyValue: unknown;
  nativeValue: unknown;
  classification: ParityDifferenceClassification;
  note: string;
}

export interface RoutedOperationDiagnostics {
  operation: 'exactScan' | 'aobScan';
  requestedMode: ScannerRoutingMode;
  effectiveBackend: ScannerBackendKind;
  fellBackToLegacy: boolean;
  nativeError?: string;
  shadowDifferences?: ParityDifference[];
  timestamp: string;
}

export interface ScannerBackendDiagnosticsSnapshot {
  mode: ScannerRoutingMode;
  allowFallbackToLegacyOnNativeFailure: boolean;
  lastOperation: RoutedOperationDiagnostics | null;
  operationCount: number;
  fallbackCount: number;
}

export interface ScannerBackendRouterOptions {
  mode?: ScannerRoutingMode;
  /** Canary-testing-only escape hatch (mission §7.5) — defaults to false (no hidden fallback). */
  allowFallbackToLegacyOnNativeFailure?: boolean;
}

function bigintKey(v: bigint): string {
  return v.toString();
}

/**
 * Classifies one exact-scan match-set difference (mission §7.7). Applies
 * the two literal examples the mission itself gives before falling back to
 * "a human must decide": a legacy scan that was not `complete` disagreeing
 * with a `complete` native result is the mission's own ">1 MiB skipped
 * region" example (EXPECTED_NATIVE_CORRECTION); an int64 request where
 * legacy's `valueNumber` came from a lossy `Number(bigint)` narrowing is the
 * mission's own "Number-rounded int64" example (also
 * EXPECTED_NATIVE_CORRECTION). Every other disagreement is reported as
 * `SEMANTIC_DIFFERENCE_REQUIRING_OWNER_DECISION` — this router never
 * invents a justification for a difference it cannot attribute to a named,
 * understood cause.
 */
function classifyExactScanDifference(
  legacy: CanonicalExactScanOutcome,
  native: CanonicalExactScanOutcome,
  primitiveType: CanonicalPrimitiveType,
): ParityDifference[] {
  const differences: ParityDifference[] = [];
  const legacyAddrs = new Set(legacy.matches.map((m) => bigintKey(m.address)));
  const nativeAddrs = new Set(native.matches.map((m) => bigintKey(m.address)));
  const sameAddressSet =
    legacyAddrs.size === nativeAddrs.size && [...legacyAddrs].every((a) => nativeAddrs.has(a));

  if (!sameAddressSet) {
    const legacyIncomplete = legacy.completeness.state !== 'complete';
    // Deliberately NOT `native.completeness.state === 'complete'`: a native
    // scan across a real process's *entire* address space can legitimately
    // hit its own, unrelated incidental region failures (a page that
    // transiently changed protection between enumeration and read) without
    // that invalidating the specific extra match it found. What actually
    // matters for this classification is whether native found something
    // legacy admits it might have missed — legacy's own honesty about being
    // incomplete is the signal, not native's global completeness.
    const nativeFoundMoreThanLegacy = native.matches.length > legacy.matches.length;
    if (legacyIncomplete && nativeFoundMoreThanLegacy) {
      differences.push({
        field: 'matches',
        legacyValue: { count: legacy.matches.length, completeness: legacy.completeness.state },
        nativeValue: { count: native.matches.length, completeness: native.completeness.state },
        classification: 'EXPECTED_NATIVE_CORRECTION',
        note:
          'Legacy scan did not reach full coverage (a region was skipped, e.g. the 1 MiB readBuffer ' +
          'ceiling or the 64 MiB region-size filter) while native found more matches than legacy — ' +
          'mission §7.7\'s own ">1 MiB skipped region" example.',
      });
    } else {
      differences.push({
        field: 'matches',
        legacyValue: { count: legacy.matches.length, addresses: [...legacyAddrs] },
        nativeValue: { count: native.matches.length, addresses: [...nativeAddrs] },
        classification: 'SEMANTIC_DIFFERENCE_REQUIRING_OWNER_DECISION',
        note: 'Match address sets differ for a reason this router does not recognize as a known, expected cause.',
      });
    }
  }

  if (primitiveType === 'i64') {
    const legacyLossy = legacy.matches.some((m) => m.valueNumber !== undefined);
    const nativeExact = native.matches.some((m) => m.valueBigint !== undefined);
    if (legacyLossy && nativeExact) {
      differences.push({
        field: 'value_representation',
        legacyValue: 'Number (lossy above Number.MAX_SAFE_INTEGER)',
        nativeValue: 'BigInt (exact)',
        classification: 'EXPECTED_NATIVE_CORRECTION',
        note:
          'Legacy represents int64 as a possibly-rounded JS Number (D06); native preserves the exact ' +
          'value as BigInt — mission §7.7\'s own "Number-rounded int64" example.',
      });
    }
  }

  return differences;
}

function classifyAobDifference(
  legacy: CanonicalPatternScanOutcome,
  native: CanonicalPatternScanOutcome,
): ParityDifference[] {
  const legacyFound = legacy.matches.length > 0;
  const nativeFound = native.matches.length > 0;
  if (legacyFound === nativeFound) {
    if (!legacyFound) return [];
    if (bigintKey(legacy.matches[0].address) === bigintKey(native.matches[0].address)) return [];
  }
  const legacyIncomplete = legacy.completeness.state !== 'complete';
  if (!legacyFound && nativeFound && legacyIncomplete) {
    return [
      {
        field: 'matches',
        legacyValue: { found: false, completeness: legacy.completeness.state },
        nativeValue: { found: true, address: native.matches[0]?.address.toString() },
        classification: 'EXPECTED_NATIVE_CORRECTION',
        note:
          'Legacy AOB scan silently skipped an unreadable/over-cap region (aob-resolver.ts\'s ' +
          'try/catch/continue) and reported "not found"; native completed the scan and found a real ' +
          'match — mission §7.7\'s own ">1 MiB skipped region" example applied to AOB.',
      },
    ];
  }
  return [
    {
      field: 'matches',
      legacyValue: legacyFound ? legacy.matches[0].address.toString() : null,
      nativeValue: nativeFound ? native.matches[0].address.toString() : null,
      classification: 'SEMANTIC_DIFFERENCE_REQUIRING_OWNER_DECISION',
      note: 'AOB match result differs for a reason this router does not recognize as a known, expected cause.',
    },
  ];
}

export class ScannerBackendRouter {
  private mode: ScannerRoutingMode;
  private readonly allowFallback: boolean;
  private lastOperation: RoutedOperationDiagnostics | null = null;
  private operationCount = 0;
  private fallbackCount = 0;
  private nativeAttachedPid: number | null = null;

  constructor(
    private readonly legacy: ScannerBackend,
    private readonly native: ScannerBackend,
    options: ScannerBackendRouterOptions = {},
  ) {
    this.mode = options.mode ?? 'LEGACY';
    this.allowFallback = options.allowFallbackToLegacyOnNativeFailure ?? false;
  }

  getMode(): ScannerRoutingMode {
    return this.mode;
  }

  /** Mode is switchable without recreating the router or the session (mission §7.16 — rollback without a rebuild). */
  setMode(mode: ScannerRoutingMode): void {
    this.mode = mode;
  }

  diagnostics(): ScannerBackendDiagnosticsSnapshot {
    return {
      mode: this.mode,
      allowFallbackToLegacyOnNativeFailure: this.allowFallback,
      lastOperation: this.lastOperation,
      operationCount: this.operationCount,
      fallbackCount: this.fallbackCount,
    };
  }

  private async ensureNativeAttached(pid: number): Promise<void> {
    if (this.nativeAttachedPid === pid) return;
    await this.native.attach(pid);
    this.nativeAttachedPid = pid;
  }

  async detachNative(): Promise<void> {
    if (this.nativeAttachedPid !== null) {
      await this.native.detach();
      this.nativeAttachedPid = null;
    }
  }

  private record(diag: RoutedOperationDiagnostics): void {
    this.lastOperation = diag;
    this.operationCount += 1;
    if (diag.fellBackToLegacy) this.fallbackCount += 1;
  }

  async routedExactScan(
    pid: number,
    primitiveType: CanonicalPrimitiveType,
    valueNumber: number | undefined,
    valueBigint: bigint | undefined,
    bounds: CanonicalScanBounds,
    control?: ScanControl,
  ): Promise<CanonicalExactScanOutcome> {
    const timestamp = new Date().toISOString();

    if (this.mode === 'LEGACY') {
      const result = await this.legacy.exactScan(primitiveType, valueNumber, valueBigint, bounds, control);
      this.record({ operation: 'exactScan', requestedMode: 'LEGACY', effectiveBackend: 'legacy', fellBackToLegacy: false, timestamp });
      return result;
    }

    if (this.mode === 'NATIVE') {
      try {
        await this.ensureNativeAttached(pid);
        const result = await this.native.exactScan(primitiveType, valueNumber, valueBigint, bounds, control);
        this.record({ operation: 'exactScan', requestedMode: 'NATIVE', effectiveBackend: 'native', fellBackToLegacy: false, timestamp });
        return result;
      } catch (err) {
        const message = err instanceof ScannerBackendError ? err.message : String(err);
        if (!this.allowFallback) {
          this.record({ operation: 'exactScan', requestedMode: 'NATIVE', effectiveBackend: 'native', fellBackToLegacy: false, nativeError: message, timestamp });
          throw err;
        }
        const result = await this.legacy.exactScan(primitiveType, valueNumber, valueBigint, bounds, control);
        this.record({ operation: 'exactScan', requestedMode: 'NATIVE', effectiveBackend: 'legacy', fellBackToLegacy: true, nativeError: message, timestamp });
        return result;
      }
    }

    // SHADOW_COMPARE — legacy remains authoritative (mission §7.6); native runs alongside for comparison only.
    const legacyResult = await this.legacy.exactScan(primitiveType, valueNumber, valueBigint, bounds, control);
    let shadowDifferences: ParityDifference[] | undefined;
    let nativeError: string | undefined;
    try {
      await this.ensureNativeAttached(pid);
      const nativeResult = await this.native.exactScan(primitiveType, valueNumber, valueBigint, bounds);
      shadowDifferences = classifyExactScanDifference(legacyResult, nativeResult, primitiveType);
    } catch (err) {
      nativeError = err instanceof ScannerBackendError ? err.message : String(err);
    }
    this.record({
      operation: 'exactScan',
      requestedMode: 'SHADOW_COMPARE',
      effectiveBackend: 'legacy',
      fellBackToLegacy: false,
      nativeError,
      shadowDifferences,
      timestamp,
    });
    return legacyResult;
  }

  async routedAobScan(
    pid: number,
    pattern: string,
    moduleName: string | undefined,
    bounds: CanonicalScanBounds,
    control?: ScanControl,
  ): Promise<CanonicalPatternScanOutcome> {
    const timestamp = new Date().toISOString();

    if (this.mode === 'LEGACY') {
      const result = await this.legacy.aobScan(pattern, moduleName, bounds, control);
      this.record({ operation: 'aobScan', requestedMode: 'LEGACY', effectiveBackend: 'legacy', fellBackToLegacy: false, timestamp });
      return result;
    }

    if (this.mode === 'NATIVE') {
      try {
        await this.ensureNativeAttached(pid);
        const result = await this.native.aobScan(pattern, moduleName, bounds, control);
        this.record({ operation: 'aobScan', requestedMode: 'NATIVE', effectiveBackend: 'native', fellBackToLegacy: false, timestamp });
        return result;
      } catch (err) {
        const message = err instanceof ScannerBackendError ? err.message : String(err);
        if (!this.allowFallback) {
          this.record({ operation: 'aobScan', requestedMode: 'NATIVE', effectiveBackend: 'native', fellBackToLegacy: false, nativeError: message, timestamp });
          throw err;
        }
        const result = await this.legacy.aobScan(pattern, moduleName, bounds, control);
        this.record({ operation: 'aobScan', requestedMode: 'NATIVE', effectiveBackend: 'legacy', fellBackToLegacy: true, nativeError: message, timestamp });
        return result;
      }
    }

    const legacyResult = await this.legacy.aobScan(pattern, moduleName, bounds, control);
    let shadowDifferences: ParityDifference[] | undefined;
    let nativeError: string | undefined;
    try {
      await this.ensureNativeAttached(pid);
      const nativeResult = await this.native.aobScan(pattern, moduleName, bounds);
      shadowDifferences = classifyAobDifference(legacyResult, nativeResult);
    } catch (err) {
      nativeError = err instanceof ScannerBackendError ? err.message : String(err);
    }
    this.record({
      operation: 'aobScan',
      requestedMode: 'SHADOW_COMPARE',
      effectiveBackend: 'legacy',
      fellBackToLegacy: false,
      nativeError,
      shadowDifferences,
      timestamp,
    });
    return legacyResult;
  }
}

export type { CanonicalMetrics };
