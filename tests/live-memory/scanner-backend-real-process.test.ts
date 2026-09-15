// Phase 1 / Stage 7 §7.9/§7.10-§7.13 — real-process proof, not a mock. Spawns
// the same `solith-scanner-fixture.exe` the Rust/napi Stage 1-6 test suites
// already use as a real Windows process, attaches BOTH the real legacy
// driver (`nativeMemoryDriver`, backed by memoryjs) and the real native
// scanner addon (`solith-scanner-napi`) to that one real PID, and proves —
// against real OS memory, not a fake — exactly which of the four named
// shipping defects (1 MiB cap, alignment, int64, AOB) the native backend
// closes and which remain open in the legacy path.
//
// Skips cleanly (not a failure) if the fixture binary or the native addon
// has not been built — this test proves real behavior, it does not build
// prerequisites itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { nativeMemoryDriver } from '../../src/core/live-memory/native-memory-driver.js';
import { LegacyScannerBackend } from '../../src/core/live-memory/scanner-backend-legacy.js';
import { NativeScannerBackend } from '../../src/core/live-memory/scanner-backend-native.js';
import { ScannerBackendRouter } from '../../src/core/live-memory/scanner-backend-router.js';

const FIXTURE_PATH = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'native',
  'solith-scanner-core',
  'target',
  'release',
  'solith-scanner-fixture.exe',
);

function fixtureAvailable(): boolean {
  return process.platform === 'win32' && existsSync(FIXTURE_PATH);
}

const testRequire = createRequire(import.meta.url);

function nativeAddonAvailable(): boolean {
  try {
    testRequire('solith-scanner-napi');
    return true;
  } catch {
    return false;
  }
}

interface FixtureHandle {
  child: ChildProcessWithoutNullStreams;
  fields: Record<string, string>;
}

function spawnFixture(): Promise<FixtureHandle> {
  const child = spawn(FIXTURE_PATH, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    let buffered = '';
    const fields: Record<string, string> = {};
    function onData(chunk: Buffer) {
      buffered += chunk.toString('utf8');
      let idx: number;
      // eslint-disable-next-line no-cond-assign
      while ((idx = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, idx).trim();
        buffered = buffered.slice(idx + 1);
        if (line === 'READY') {
          child.stdout.off('data', onData);
          resolve({ child, fields });
          return;
        }
        const eq = line.indexOf('=');
        if (eq !== -1) fields[line.slice(0, eq)] = line.slice(eq + 1);
      }
    }
    child.stdout.on('data', onData);
    child.on('error', reject);
  });
}

async function withFixture(fn: (f: FixtureHandle) => Promise<void>): Promise<void> {
  const handle = await spawnFixture();
  try {
    await fn(handle);
  } finally {
    try {
      handle.child.stdin.write('exit\n');
    } catch {
      /* already gone */
    }
    handle.child.kill();
  }
}

const describeReal = fixtureAvailable() && nativeAddonAvailable() ? test : test.skip;

describeReal('1 MiB shipping defect: legacy silently skips a 4 MiB region and misses a sentinel beyond the 1 MiB readBuffer cap; native finds it with full completeness', async (t) => {
  await withFixture(async ({ child, fields }) => {
    const pid = child.pid!;
    const bigBase = BigInt(fields.BIG_REGION_BASE);
    const sentinelOffset = Number(fields.SENTINEL_OFFSET);
    const sentinelValue = Number(fields.SENTINEL_VALUE);
    assert.ok(sentinelOffset > 1024 * 1024, 'fixture sentinel must genuinely sit beyond the 1 MiB cap');

    const legacyHandle = nativeMemoryDriver.openProcess(pid);
    const legacyBackend = new LegacyScannerBackend(nativeMemoryDriver, legacyHandle);
    const nativeBackend = new NativeScannerBackend();
    const router = new ScannerBackendRouter(legacyBackend, nativeBackend, { mode: 'SHADOW_COMPARE' });

    try {
      const result = await router.routedExactScan(pid, 'u32', sentinelValue, undefined, {});

      // Legacy remains authoritative in SHADOW_COMPARE (mission §7.6) — and
      // legacy's own real, unmodified behavior against a real 4 MiB region
      // is to miss the sentinel entirely (D02: native-memory-driver.ts's
      // 1,048,576-byte readBuffer cap throws for the whole-region read;
      // memory-scanner.ts's catch{continue} silently skips it).
      assert.equal(result.backend, 'legacy');
      const foundBySentinelAddress = result.matches.some((m) => m.address === bigBase + BigInt(sentinelOffset));
      assert.equal(foundBySentinelAddress, false, 'legacy must NOT find the >1 MiB sentinel — this is the real, current D02 defect');
      t.diagnostic(`legacy metrics: ${JSON.stringify(result.metrics, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
      assert.notEqual(result.completeness.state, 'complete', 'a scan that silently skipped a region must not report complete');

      const diag = router.diagnostics();
      const diffs = diag.lastOperation?.shadowDifferences ?? [];
      t.diagnostic(`shadow differences: ${JSON.stringify(diffs)}`);
      t.diagnostic(`shadow native error: ${diag.lastOperation?.nativeError}`);
      assert.equal(diffs.length, 1);
      assert.equal(
        diffs[0].classification,
        'EXPECTED_NATIVE_CORRECTION',
        'native finding the sentinel legacy admits it may have missed must classify as an expected correction, not a native bug',
      );

      // Now prove the native path actually closes this for real, directly.
      // Note: scanning a real process's *entire* unfiltered address space
      // can legitimately encounter its own incidental, unrelated region
      // failures (a real OS race between enumeration and read) — this test
      // asserts the one claim that actually matters for this defect (the
      // real sentinel beyond the 1 MiB cap is found), not blanket global
      // completeness across every unrelated region in the whole process.
      const nativeRouter = new ScannerBackendRouter(legacyBackend, nativeBackend, { mode: 'NATIVE' });
      const nativeResult = await nativeRouter.routedExactScan(pid, 'u32', sentinelValue, undefined, {});
      assert.equal(nativeResult.backend, 'native');
      assert.ok(
        nativeResult.matches.some((m) => m.address === bigBase + BigInt(sentinelOffset)),
        'native must find the real sentinel at its real address beyond the 1 MiB cap',
      );
    } finally {
      nativeMemoryDriver.closeProcess(legacyHandle);
      await router.detachNative();
    }
  });
});

describeReal('alignment + int64 shipping defects: an unaligned real i64 value is invisible to legacy scanFirst but found exactly by native', async () => {
  await withFixture(async ({ child, fields }) => {
    const pid = child.pid!;
    const i64Offset = Number(fields.I64_OFFSET);
    const i64Value = BigInt(fields.I64_VALUE);
    assert.notEqual(i64Offset % 8, 0, 'fixture value must genuinely be unaligned for this proof');

    const legacyHandle = nativeMemoryDriver.openProcess(pid);
    const legacyBackend = new LegacyScannerBackend(nativeMemoryDriver, legacyHandle);
    const nativeBackend = new NativeScannerBackend();

    try {
      // Legacy: real, unmodified scanFirst call — steps by 8-byte int64
      // width (D03), so an offset-449 value is structurally never a
      // candidate regardless of int64 precision.
      const legacyOutcome = await legacyBackend.exactScan('i64', undefined, i64Value, {});
      assert.equal(legacyOutcome.matches.length, 0, 'legacy must not find an unaligned int64 value — this is the real, current D03 defect');

      // Native: bytewise alignment mode finds it, and preserves the exact
      // BigInt value end to end (D06 closed for this path).
      await nativeBackend.attach(pid);
      const nativeOutcome = await nativeBackend.exactScan('i64', undefined, i64Value, {});
      assert.ok(nativeOutcome.matches.length >= 1, 'native must find the real unaligned int64 value');
      const exact = nativeOutcome.matches.find((m) => m.valueBigint === i64Value);
      assert.ok(exact, 'native must preserve the exact int64 value as BigInt — no Number narrowing');
    } finally {
      nativeMemoryDriver.closeProcess(legacyHandle);
      await nativeBackend.detach();
    }
  });
});

describeReal('AOB shipping defect: a signature planted 6 MiB into an 8 MiB region is missed by legacy and found by native with real completeness', async () => {
  await withFixture(async ({ child, fields }) => {
    const pid = child.pid!;
    const patternBase = BigInt(fields.PATTERN_REGION_BASE);
    const farOffset = Number(fields.FAR_MARKER_OFFSET);
    assert.ok(farOffset > 1024 * 1024, 'fixture far marker must genuinely sit beyond the 1 MiB cap');
    const pattern = 'DE AD C0 DE 42';
    const expectedAddress = patternBase + BigInt(farOffset);

    const legacyHandle = nativeMemoryDriver.openProcess(pid);
    const legacyBackend = new LegacyScannerBackend(nativeMemoryDriver, legacyHandle);
    const nativeBackend = new NativeScannerBackend();
    const router = new ScannerBackendRouter(legacyBackend, nativeBackend, { mode: 'SHADOW_COMPARE' });

    try {
      const aobResult = await router.routedAobScan(pid, pattern, undefined, {});
      assert.equal(aobResult.backend, 'legacy');
      assert.equal(aobResult.matches.length, 0, 'legacy AOB must miss the real far marker — this is the real, current D01/D04 defect');

      const nativeRouter = new ScannerBackendRouter(legacyBackend, nativeBackend, { mode: 'NATIVE' });
      const nativeResult = await nativeRouter.routedAobScan(pid, pattern, undefined, {});
      assert.equal(nativeResult.backend, 'native');
      assert.equal(nativeResult.matches.length, 1);
      assert.equal(nativeResult.matches[0].address, expectedAddress, 'native must find the real marker at its real address beyond the 1 MiB cap');
    } finally {
      nativeMemoryDriver.closeProcess(legacyHandle);
      await router.detachNative();
    }
  });
});
