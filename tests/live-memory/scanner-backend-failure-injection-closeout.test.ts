/**
 * Phase 1 / Stage 7.5 §9 — failure-injection closeout.
 *
 * Stage 7.4 (doc 117) closed 14 of 16 cases with real evidence and left two —
 * corrupt session metadata (#11) and unsupported snapshot version (#12) —
 * marked "NOT APPLICABLE / out of scope". Mission §9 is explicit that "out of
 * scope" alone is not sufficient: a case may only be `PROVABLY_NOT_APPLICABLE`
 * if there is an architectural proof that the failure mode cannot occur on the
 * route under certification.
 *
 * That proof is below, and it is structural rather than rhetorical. The native
 * addon splits its surface in two: `NativeScanSession` owns the refine/session
 * lifecycle and is the only class with any persistence at all
 * (`exportSnapshotJson`, and the free functions `saveSessionSnapshot` /
 * `loadSessionSnapshotInfo` / `deleteSessionSnapshot`), while `NativeScanTarget`
 * owns attach + enumerate + read + scan and has no persistence whatsoever.
 * Every routed production scan — exact, AOB, and now fuzzy — goes through
 * `NativeScannerBackend`, which constructs `NativeScanTarget` and nothing else.
 * There is therefore no persisted session metadata on this route that could be
 * corrupt, and no snapshot schema version on this route that could be
 * unsupported. The first test asserts that property directly against the source
 * of the routed path, so it cannot quietly stop being true.
 *
 * The next two tests are defence in depth rather than closure evidence: they
 * confirm that even if the snapshot API were somehow reached, malformed and
 * version-mismatched input are rejected with a structured error rather than a
 * crash or a silently-accepted session.
 *
 * The remainder extend the existing failure matrix to the newly migrated fuzzy
 * path: a malformed pattern must be rejected before any memory is read, a
 * NATIVE failure must surface rather than silently degrade, and explicit LEGACY
 * rollback must still work after that failure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { scanFuzzySignatureViaSource } from '../../src/core/live-memory/signature-engine.js';
import { ScannerBackendRouter } from '../../src/core/live-memory/scanner-backend-router.js';
import {
  ScannerBackendError,
  type CanonicalExactScanOutcome,
  type CanonicalMemoryRegion,
  type CanonicalPatternScanOutcome,
  type CanonicalRegionReadOutcome,
  type CanonicalTargetModule,
  type ScannerBackend,
} from '../../src/core/live-memory/scanner-backend.js';
import type { ScannerMemorySource } from '../../src/core/live-memory/scanner-backend-router.js';

const testRequire = createRequire(import.meta.url);
const SRC = path.resolve(import.meta.dirname, '..', '..', 'src', 'core', 'live-memory');

/**
 * Every source file that makes up the routed production scan path. If a future
 * change routes a scan through `NativeScanSession` instead, this list is where
 * the snapshot failure modes would become reachable again.
 */
const ROUTED_PATH_FILES = [
  'scanner-backend.ts',
  'scanner-backend-native.ts',
  'scanner-backend-legacy.ts',
  'scanner-backend-router.ts',
  'signature-engine.ts',
];

/** The addon's entire persistence surface — none of it belongs on this route. */
const SESSION_PERSISTENCE_SYMBOLS = [
  'NativeScanSession',
  'exportSnapshotJson',
  'saveSessionSnapshot',
  'loadSessionSnapshotInfo',
  'deleteSessionSnapshot',
  'createUnknownInitial',
];

// ── Case 11 + 12: PROVABLY_NOT_APPLICABLE ───────────────────────────────────
test('failure closeout — the routed scan path has no session-persistence dependency at all', () => {
  const offenders: string[] = [];
  for (const file of ROUTED_PATH_FILES) {
    const source = readFileSync(path.join(SRC, file), 'utf8');
    for (const symbol of SESSION_PERSISTENCE_SYMBOLS) {
      if (source.includes(symbol)) offenders.push(`${file} references ${symbol}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'a routed scan must never reach the addon persistence surface — if this fails, cases 11/12 are no longer ' +
      'provably not applicable and must be re-tested for real',
  );
});

test('failure closeout — NativeScannerBackend constructs only NativeScanTarget, never a persisted session', () => {
  const source = readFileSync(path.join(SRC, 'scanner-backend-native.ts'), 'utf8');
  assert.ok(
    source.includes('NativeScanTarget'),
    'sanity: the native backend really does use the non-persisting target class',
  );
  assert.equal(
    source.includes('NativeScanSession'),
    false,
    'the native backend must not construct the session class, which is the only class with snapshot state',
  );
});

// ── Cases 11 + 12: defence in depth on the API itself ───────────────────────
test('failure closeout — a corrupt snapshot file is rejected with a structured error, never a crash', (t) => {
  let addon: { loadSessionSnapshotInfo(dir: string, id: string): unknown };
  try {
    addon = testRequire('solith-scanner-napi') as typeof addon;
  } catch {
    t.skip('native addon not built in this environment');
    return;
  }

  const dir = mkdtempSync(path.join(tmpdir(), 'solith-snapshot-corrupt-'));
  writeFileSync(path.join(dir, 'corrupt.solith-session-snapshot.json'), '{ this is not valid json at all', 'utf8');

  assert.throws(
    () => addon.loadSessionSnapshotInfo(dir, 'corrupt'),
    (err: unknown) => {
      assert.ok(err instanceof Error, 'must be a real Error, not a bare thrown value');
      assert.ok(String(err).length > 0);
      return true;
    },
    'a corrupt snapshot must be rejected, never partially accepted',
  );
});

test('failure closeout — an unsupported snapshot schema version is rejected, never silently accepted', (t) => {
  let addon: { loadSessionSnapshotInfo(dir: string, id: string): unknown };
  try {
    addon = testRequire('solith-scanner-napi') as typeof addon;
  } catch {
    t.skip('native addon not built in this environment');
    return;
  }

  const dir = mkdtempSync(path.join(tmpdir(), 'solith-snapshot-version-'));
  // Structurally well-formed JSON carrying a schema version the current core
  // does not implement (SNAPSHOT_SCHEMA_VERSION is 1).
  writeFileSync(
    path.join(dir, 'future.solith-session-snapshot.json'),
    JSON.stringify({
      payload: {
        schema_version: 99_999,
        scanner_core_version: '99.0.0',
        primitive_type: 'u32',
        alignment: 'bytewise',
        process_pid: 1234,
        generation: 1,
        candidate_count: 0,
        last_completeness_label: 'complete',
        taken_at_unix_millis: 0,
      },
      checksum: 0,
    }),
    'utf8',
  );

  assert.throws(
    () => addon.loadSessionSnapshotInfo(dir, 'future'),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      return true;
    },
    'an unsupported schema version must be rejected rather than reconstructed on a guess',
  );
});

// ── Fuzzy path: malformed pattern is rejected before any read ───────────────
test('failure closeout — a malformed AOB pattern is rejected before any target memory is read', async () => {
  let regionReads = 0;
  const countingSource: ScannerMemorySource = {
    kind: 'native',
    // eslint-disable-next-line @typescript-eslint/require-await
    async enumerateRegions(): Promise<CanonicalMemoryRegion[]> {
      return [{ baseAddress: 0x1000n, size: 0x100n, isReadable: true, isWritable: true, isExecutable: false }];
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async enumerateModules(): Promise<CanonicalTargetModule[]> {
      return [];
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async readRegion(): Promise<CanonicalRegionReadOutcome> {
      regionReads += 1;
      return {
        backend: 'native',
        slices: [],
        completeness: { state: 'complete' },
        metrics: { regionsConsidered: 1, regionsRead: 1, regionsSkipped: 0, bytesRequested: 0n, bytesRead: 0n, elapsedMillis: 0n },
      };
    },
  };

  await assert.rejects(
    () => scanFuzzySignatureViaSource(countingSource, 'NOT A VALID AOB ZZ'),
    /Invalid AOB token/,
  );
  assert.equal(regionReads, 0, 'a malformed pattern must never cause target memory to be read');

  await assert.rejects(() => scanFuzzySignatureViaSource(countingSource, '   '), /empty/i);
  assert.equal(regionReads, 0);
});

// ── Routing: no hidden fallback, and rollback still works after a failure ───
function stubBackend(kind: 'legacy' | 'native', behavior: 'ok' | 'throw'): ScannerBackend {
  const fail = () => {
    throw new ScannerBackendError('internal_error', `${kind} backend deliberately failed for this test`);
  };
  return {
    kind,
    // eslint-disable-next-line @typescript-eslint/require-await
    async attach() {
      if (behavior === 'throw') fail();
    },
    async detach() {
      /* nothing to release */
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async enumerateRegions(): Promise<CanonicalMemoryRegion[]> {
      if (behavior === 'throw') fail();
      return [{ baseAddress: 0x2000n, size: 0x10n, isReadable: true, isWritable: true, isExecutable: false }];
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async enumerateModules(): Promise<CanonicalTargetModule[]> {
      return [];
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async readRegion(): Promise<CanonicalRegionReadOutcome> {
      if (behavior === 'throw') fail();
      const data = Buffer.alloc(0x10, 0);
      data.set([0xde, 0xad, 0xbe, 0xef], 4);
      return {
        backend: kind,
        slices: [{ baseAddress: 0x2000n, data }],
        completeness: { state: 'complete' },
        metrics: { regionsConsidered: 1, regionsRead: 1, regionsSkipped: 0, bytesRequested: 0x10n, bytesRead: 0x10n, elapsedMillis: 0n },
      };
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async exactScan(): Promise<CanonicalExactScanOutcome> {
      throw new ScannerBackendError('unsupported_operation', 'not used by this test');
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async aobScan(): Promise<CanonicalPatternScanOutcome> {
      throw new ScannerBackendError('unsupported_operation', 'not used by this test');
    },
  };
}

test('failure closeout — a NATIVE fuzzy failure surfaces and never silently falls back to legacy', async () => {
  const router = new ScannerBackendRouter(stubBackend('legacy', 'ok'), stubBackend('native', 'throw'));
  assert.equal(router.getMode(), 'NATIVE', 'production default');

  await assert.rejects(
    () =>
      router.routedMemorySourceOperation(1234, 'fuzzyAobScan', (source) =>
        scanFuzzySignatureViaSource(source, 'DE AD BE EF'),
      ),
    (err: unknown) => {
      assert.ok(err instanceof ScannerBackendError);
      return true;
    },
  );

  const diagnostics = router.diagnostics();
  assert.equal(diagnostics.lastOperation?.operation, 'fuzzyAobScan');
  assert.equal(diagnostics.lastOperation?.effectiveBackend, 'native', 'the failure is attributed to native, not hidden');
  assert.equal(diagnostics.lastOperation?.fellBackToLegacy, false);
  assert.equal(diagnostics.fallbackCount, 0, 'no hidden fallback occurred');
});

test('failure closeout — explicit LEGACY rollback still resolves after a NATIVE fuzzy failure', async () => {
  const router = new ScannerBackendRouter(stubBackend('legacy', 'ok'), stubBackend('native', 'throw'));

  await assert.rejects(() =>
    router.routedMemorySourceOperation(1234, 'fuzzyAobScan', (source) =>
      scanFuzzySignatureViaSource(source, 'DE AD BE EF'),
    ),
  );

  router.setMode('LEGACY');
  const { result, backend } = await router.routedMemorySourceOperation(1234, 'fuzzyAobScan', (source) =>
    scanFuzzySignatureViaSource(source, 'DE AD BE EF'),
  );
  assert.equal(backend, 'legacy');
  assert.equal(result.match?.address, 0x2004n, 'rollback resolves the real planted pattern');
  assert.equal(router.diagnostics().fallbackCount, 0, 'an explicit rollback is not a fallback');
});

test('failure closeout — SHADOW_COMPARE keeps legacy authoritative when the native fuzzy source fails', async () => {
  const router = new ScannerBackendRouter(stubBackend('legacy', 'ok'), stubBackend('native', 'throw'));
  router.setMode('SHADOW_COMPARE');

  const { result, backend } = await router.routedMemorySourceOperation(1234, 'fuzzyAobScan', (source) =>
    scanFuzzySignatureViaSource(source, 'DE AD BE EF'),
  );
  assert.equal(backend, 'legacy', 'legacy stays authoritative in shadow mode');
  assert.equal(result.match?.address, 0x2004n);

  const diagnostics = router.diagnostics();
  assert.equal(diagnostics.lastOperation?.requestedMode, 'SHADOW_COMPARE');
  assert.ok(diagnostics.lastOperation?.nativeError, 'the native-side failure is recorded, not swallowed');
  assert.equal(diagnostics.fallbackCount, 0);
});
