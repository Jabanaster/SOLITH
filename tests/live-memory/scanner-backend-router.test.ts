// Phase 1 / Stage 7 §7.5-§7.7 — `ScannerBackendRouter` mode selection,
// shadow-compare difference classification, no-hidden-fallback discipline,
// and rollback-without-rebuild, all against deterministic stub backends
// (no real process or native addon needed — that real-process proof lives
// in scanner-backend-real-process.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScannerBackendRouter } from '../../src/core/live-memory/scanner-backend-router.js';
import {
  ScannerBackendError,
  type ScannerBackend,
  type CanonicalExactScanOutcome,
  type ScanControl,
} from '../../src/core/live-memory/scanner-backend.js';

function outcome(overrides: Partial<CanonicalExactScanOutcome> = {}): CanonicalExactScanOutcome {
  return {
    backend: 'legacy',
    matches: [],
    completeness: { state: 'complete' },
    isAuthoritativeAbsence: true,
    metrics: { regionsConsidered: 0, regionsRead: 0, regionsSkipped: 0, bytesRequested: 0n, bytesRead: 0n, elapsedMillis: 0n },
    ...overrides,
  };
}

class StubBackend implements ScannerBackend {
  attachCalls: number[] = [];
  detachCalls = 0;
  exactScanImpl: (() => Promise<CanonicalExactScanOutcome>) | null = null;
  aobScanImpl: (() => ReturnType<ScannerBackend['aobScan']>) | null = null;
  /** Stage 7.2 §9 — records the `control` this backend was actually called with, so a test can prove cancellation was (or was not) forwarded. */
  lastExactScanControl: ScanControl | undefined;
  lastAobScanControl: ScanControl | undefined;

  constructor(public readonly kind: 'legacy' | 'native') {}

  async attach(pid: number): Promise<void> {
    this.attachCalls.push(pid);
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async detach(): Promise<void> {
    this.detachCalls += 1;
  }
  async exactScan(
    _primitiveType: unknown,
    _valueNumber: unknown,
    _valueBigint: unknown,
    _bounds: unknown,
    control?: ScanControl,
  ): Promise<CanonicalExactScanOutcome> {
    this.lastExactScanControl = control;
    if (!this.exactScanImpl) throw new Error('exactScanImpl not set');
    return this.exactScanImpl();
  }
  async aobScan(
    _pattern: unknown,
    _moduleName: unknown,
    _bounds: unknown,
    control?: ScanControl,
  ): ReturnType<ScannerBackend['aobScan']> {
    this.lastAobScanControl = control;
    if (!this.aobScanImpl) throw new Error('aobScanImpl not set');
    return this.aobScanImpl();
  }
}

test('a router constructed with no explicit mode defaults to NATIVE (Stage 7.3 §2 — owner-authorized production migration)', async () => {
  const legacy = new StubBackend('legacy');
  legacy.exactScanImpl = async () => outcome({ backend: 'legacy' });
  const native = new StubBackend('native');
  native.exactScanImpl = async () => outcome({ backend: 'native' });
  const router = new ScannerBackendRouter(legacy, native);

  assert.equal(router.getMode(), 'NATIVE', 'no mode specified must mean NATIVE, not LEGACY — no config/env trick required');
  const result = await router.routedExactScan(1, 'i32', 1, undefined, {});
  assert.equal(result.backend, 'native');
});

test('SHADOW_COMPARE forwards the cancellation control to the shadow native exact-scan call too (mission §7.2-9)', async () => {
  const legacy = new StubBackend('legacy');
  legacy.exactScanImpl = async () => outcome({ backend: 'legacy' });
  const native = new StubBackend('native');
  native.exactScanImpl = async () => outcome({ backend: 'native' });
  const router = new ScannerBackendRouter(legacy, native, { mode: 'SHADOW_COMPARE' });
  const controller = new AbortController();
  controller.abort();

  await router.routedExactScan(1, 'i32', 1, undefined, {}, { signal: controller.signal });

  assert.ok(native.lastExactScanControl, 'the shadow native exact-scan call must receive a control object, not be silently called without one');
  assert.equal(
    native.lastExactScanControl?.signal?.aborted,
    true,
    'an aborted signal on the authoritative legacy call must reach the shadow native call unchanged — a cancellation cannot leave the shadow backend running indefinitely',
  );
});

test('SHADOW_COMPARE forwards the cancellation control to the shadow native AOB-scan call too (mission §7.2-9)', async () => {
  const legacy = new StubBackend('legacy');
  legacy.aobScanImpl = async () => ({
    backend: 'legacy',
    matches: [],
    completeness: { state: 'complete' },
    isAuthoritativeAbsence: true,
    metrics: { regionsConsidered: 0, regionsRead: 0, regionsSkipped: 0, bytesRequested: 0n, bytesRead: 0n, elapsedMillis: 0n },
  });
  const native = new StubBackend('native');
  native.aobScanImpl = async () => ({
    backend: 'native',
    matches: [],
    completeness: { state: 'complete' },
    isAuthoritativeAbsence: true,
    metrics: { regionsConsidered: 0, regionsRead: 0, regionsSkipped: 0, bytesRequested: 0n, bytesRead: 0n, elapsedMillis: 0n },
  });
  const router = new ScannerBackendRouter(legacy, native, { mode: 'SHADOW_COMPARE' });
  const controller = new AbortController();
  controller.abort();

  await router.routedAobScan(1, 'DE AD', undefined, {}, { signal: controller.signal });

  assert.ok(native.lastAobScanControl, 'the shadow native AOB-scan call must receive a control object');
  assert.equal(native.lastAobScanControl?.signal?.aborted, true);
});

test('LEGACY mode never touches the native backend at all', async () => {
  const legacy = new StubBackend('legacy');
  legacy.exactScanImpl = async () => outcome({ backend: 'legacy' });
  const native = new StubBackend('native');
  const router = new ScannerBackendRouter(legacy, native, { mode: 'LEGACY' });

  const result = await router.routedExactScan(999, 'i32', 1, undefined, {});

  assert.equal(result.backend, 'legacy');
  assert.equal(native.attachCalls.length, 0, 'native backend must never be attached in LEGACY mode');
  const diag = router.diagnostics();
  assert.equal(diag.lastOperation?.effectiveBackend, 'legacy');
  assert.equal(diag.lastOperation?.fellBackToLegacy, false);
});

test('NATIVE mode with a native failure and no fallback allowed rethrows — no hidden fallback', async () => {
  const legacy = new StubBackend('legacy');
  legacy.exactScanImpl = async () => outcome({ backend: 'legacy' });
  const native = new StubBackend('native');
  native.exactScanImpl = async () => {
    throw new ScannerBackendError('native_addon_missing', 'boom');
  };
  const router = new ScannerBackendRouter(legacy, native, { mode: 'NATIVE' });

  await assert.rejects(() => router.routedExactScan(1, 'i32', 1, undefined, {}), ScannerBackendError);
  const diag = router.diagnostics();
  assert.equal(diag.lastOperation?.fellBackToLegacy, false);
  assert.ok(diag.lastOperation?.nativeError?.includes('boom'));
});

test('NATIVE mode with allowFallbackToLegacyOnNativeFailure records the failure AND the fallback, never silently', async () => {
  const legacy = new StubBackend('legacy');
  legacy.exactScanImpl = async () => outcome({ backend: 'legacy', matches: [] });
  const native = new StubBackend('native');
  native.exactScanImpl = async () => {
    throw new ScannerBackendError('attach_failed', 'native down for canary test');
  };
  const router = new ScannerBackendRouter(legacy, native, { mode: 'NATIVE', allowFallbackToLegacyOnNativeFailure: true });

  const result = await router.routedExactScan(1, 'i32', 1, undefined, {});

  assert.equal(result.backend, 'legacy');
  const diag = router.diagnostics();
  assert.equal(diag.lastOperation?.effectiveBackend, 'legacy');
  assert.equal(diag.lastOperation?.fellBackToLegacy, true);
  assert.equal(diag.fallbackCount, 1);
  assert.ok(diag.lastOperation?.nativeError?.includes('native down for canary test'));
});

test('SHADOW_COMPARE always returns the legacy result unchanged, even when native disagrees', async () => {
  const legacyOutcome = outcome({ backend: 'legacy', matches: [{ address: 0x1000n, primitiveType: 'i32', valueNumber: 7 }], isAuthoritativeAbsence: false });
  const nativeOutcome = outcome({ backend: 'native', matches: [{ address: 0x2000n, primitiveType: 'i32', valueNumber: 7 }], isAuthoritativeAbsence: false });
  const legacy = new StubBackend('legacy');
  legacy.exactScanImpl = async () => legacyOutcome;
  const native = new StubBackend('native');
  native.exactScanImpl = async () => nativeOutcome;
  const router = new ScannerBackendRouter(legacy, native, { mode: 'SHADOW_COMPARE' });

  const result = await router.routedExactScan(1, 'i32', 7, undefined, {});

  assert.deepEqual(result, legacyOutcome, 'legacy must remain authoritative during shadow comparison (mission §7.6)');
  assert.equal(native.attachCalls.length, 1, 'native still runs, for comparison only');
});

test('SHADOW_COMPARE classifies a legacy-incomplete/native-complete disagreement as EXPECTED_NATIVE_CORRECTION (mission §7.7\'s own >1 MiB example)', async () => {
  const legacyOutcome = outcome({ backend: 'legacy', matches: [], completeness: { state: 'complete_with_skipped_regions', skipped: [] }, isAuthoritativeAbsence: false });
  const nativeOutcome = outcome({ backend: 'native', matches: [{ address: 0x9000n, primitiveType: 'u32', valueNumber: 0xcafebabe }], completeness: { state: 'complete' }, isAuthoritativeAbsence: false });
  const legacy = new StubBackend('legacy');
  legacy.exactScanImpl = async () => legacyOutcome;
  const native = new StubBackend('native');
  native.exactScanImpl = async () => nativeOutcome;
  const router = new ScannerBackendRouter(legacy, native, { mode: 'SHADOW_COMPARE' });

  await router.routedExactScan(1, 'u32', 0xcafebabe, undefined, {});

  const diffs = router.diagnostics().lastOperation?.shadowDifferences ?? [];
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].classification, 'EXPECTED_NATIVE_CORRECTION');
});

test('SHADOW_COMPARE classifies an unexplained match-set disagreement as SEMANTIC_DIFFERENCE_REQUIRING_OWNER_DECISION, never guessed', async () => {
  const legacyOutcome = outcome({ backend: 'legacy', matches: [{ address: 0x1000n, primitiveType: 'i32', valueNumber: 7 }], completeness: { state: 'complete' }, isAuthoritativeAbsence: false });
  const nativeOutcome = outcome({ backend: 'native', matches: [{ address: 0x2000n, primitiveType: 'i32', valueNumber: 7 }], completeness: { state: 'complete' }, isAuthoritativeAbsence: false });
  const legacy = new StubBackend('legacy');
  legacy.exactScanImpl = async () => legacyOutcome;
  const native = new StubBackend('native');
  native.exactScanImpl = async () => nativeOutcome;
  const router = new ScannerBackendRouter(legacy, native, { mode: 'SHADOW_COMPARE' });

  await router.routedExactScan(1, 'i32', 7, undefined, {});

  const diffs = router.diagnostics().lastOperation?.shadowDifferences ?? [];
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].classification, 'SEMANTIC_DIFFERENCE_REQUIRING_OWNER_DECISION');
});

test('SHADOW_COMPARE with identical match sets records zero differences', async () => {
  const same = outcome({ matches: [{ address: 0x1000n, primitiveType: 'i32', valueNumber: 7 }], isAuthoritativeAbsence: false });
  const legacy = new StubBackend('legacy');
  legacy.exactScanImpl = async () => same;
  const native = new StubBackend('native');
  native.exactScanImpl = async () => ({ ...same, backend: 'native' });
  const router = new ScannerBackendRouter(legacy, native, { mode: 'SHADOW_COMPARE' });

  await router.routedExactScan(1, 'i32', 7, undefined, {});

  assert.deepEqual(router.diagnostics().lastOperation?.shadowDifferences, []);
});

test('rollback: setMode switches routing on the SAME router instance, no rebuild or recreation (mission §7.16)', async () => {
  const legacy = new StubBackend('legacy');
  legacy.exactScanImpl = async () => outcome({ backend: 'legacy' });
  const native = new StubBackend('native');
  native.exactScanImpl = async () => outcome({ backend: 'native' });
  const router = new ScannerBackendRouter(legacy, native, { mode: 'NATIVE' });

  const first = await router.routedExactScan(1, 'i32', 1, undefined, {});
  assert.equal(first.backend, 'native');

  router.setMode('LEGACY');
  const second = await router.routedExactScan(1, 'i32', 1, undefined, {});
  assert.equal(second.backend, 'legacy');
  assert.equal(router.getMode(), 'LEGACY');
});

test('rollback after a native error: switching to LEGACY immediately stops native from being called again', async () => {
  const legacy = new StubBackend('legacy');
  legacy.exactScanImpl = async () => outcome({ backend: 'legacy' });
  const native = new StubBackend('native');
  let nativeCalls = 0;
  native.exactScanImpl = async () => {
    nativeCalls += 1;
    throw new ScannerBackendError('internal_error', 'native crashed');
  };
  const router = new ScannerBackendRouter(legacy, native, { mode: 'NATIVE' });

  await assert.rejects(() => router.routedExactScan(1, 'i32', 1, undefined, {}));
  assert.equal(nativeCalls, 1);

  router.setMode('LEGACY');
  const result = await router.routedExactScan(1, 'i32', 1, undefined, {});
  assert.equal(result.backend, 'legacy');
  assert.equal(nativeCalls, 1, 'native must not be called again after rollback to LEGACY');
});

test('native backend is attached at most once per pid across repeated routed calls', async () => {
  const legacy = new StubBackend('legacy');
  legacy.exactScanImpl = async () => outcome({ backend: 'legacy' });
  const native = new StubBackend('native');
  native.exactScanImpl = async () => outcome({ backend: 'native' });
  const router = new ScannerBackendRouter(legacy, native, { mode: 'NATIVE' });

  await router.routedExactScan(42, 'i32', 1, undefined, {});
  await router.routedExactScan(42, 'i32', 2, undefined, {});
  await router.routedExactScan(42, 'i32', 3, undefined, {});

  assert.equal(native.attachCalls.length, 1);
});
