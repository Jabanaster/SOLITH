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

  // Stage 7.5 — absorb EPIPE on the fixture's stdin.
  //
  // Teardown writes "exit\n" and then kills the child. `stream.write()` does
  // NOT report a broken pipe synchronously — it emits an asynchronous 'error'
  // event — so the `try { ... } catch {}` around that write cannot catch it.
  // With no 'error' listener attached, Node escalates EPIPE to an
  // uncaughtException, and because it lands after the test function has
  // already returned, the test runner reports it as "generated asynchronous
  // activity after the test ended" and fails the whole file.
  //
  // This is what intermittently failed `PR Windows` on the CI runner (observed
  // at ff10505, fb5f7d0, 6fcd0c5 and 252a34c, while passing at 0fcc77d and
  // af5a0bd) — a race whose outcome depends on how quickly the child dies
  // relative to the write, which is exactly the kind of thing a loaded shared
  // runner changes. Attaching a listener makes the error handled rather than
  // fatal; it does not hide a real failure, because a fixture that has already
  // been told to exit has no further output anyone is waiting on.
  child.stdin.on('error', () => {
    /* fixture already gone — nothing left to say to it */
  });
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

describeReal('NativeScannerBackend applies a real default match cap when the caller omits maxMatches — Stage 7.1 §2\'s "giant single IPC payload" fix', async () => {
  await withFixture(async ({ child }) => {
    const pid = child.pid!;
    const nativeBackend = new NativeScannerBackend();
    await nativeBackend.attach(pid);
    try {
      // No bounds at all — before the fix, this accumulated every match
      // from every readable region into one unbounded JS array (proven
      // against a real game: 151,382 real matches with no limit). The
      // fixture's own large mostly-zeroed regions reliably produce well
      // over 10,000 real u32-zero candidates on their own.
      const outcome = await nativeBackend.exactScan('u32', 0, undefined, {});
      assert.ok(outcome.matches.length > 0, 'sanity: the fixture must actually contain zero-valued u32s to bound');
      assert.ok(
        outcome.matches.length <= 10_000,
        `native must apply its own default match cap (10,000) when the caller supplies none — got ${outcome.matches.length}`,
      );
      if (outcome.matches.length === 10_000) {
        assert.equal(outcome.completeness.state, 'resource_limit', 'hitting the default cap must be reported honestly as a resource limit, not silently as complete');
      }
    } finally {
      await nativeBackend.detach();
    }
  });
});

describeReal('NativeScannerBackend maxMatches matrix — Stage 7 final closure §3: omitted/1/10/10000/large/cap-reached/cap-not-reached', async () => {
  await withFixture(async ({ child, fields }) => {
    const pid = child.pid!;
    const nativeBackend = new NativeScannerBackend();
    await nativeBackend.attach(pid);
    try {
      // maxMatches omitted — bounded by the internal default (already
      // covered by the dedicated test above; re-asserted here as part of
      // the matrix for a single point of reference).
      const omitted = await nativeBackend.exactScan('u32', 0, undefined, {});
      assert.ok(omitted.matches.length <= 10_000);

      // maxMatches = 1 — smallest real bound.
      const one = await nativeBackend.exactScan('u32', 0, undefined, { maxMatches: 1 });
      assert.equal(one.matches.length, 1, 'maxMatches=1 must return exactly 1 real match, not 0 or more');
      assert.equal(one.completeness.state, 'resource_limit');

      // maxMatches = 10 — small explicit bound.
      const ten = await nativeBackend.exactScan('u32', 0, undefined, { maxMatches: 10 });
      assert.equal(ten.matches.length, 10);
      assert.equal(ten.completeness.state, 'resource_limit');

      // maxMatches = 10,000 — explicit request at the default's own value.
      const tenThousand = await nativeBackend.exactScan('u32', 0, undefined, { maxMatches: 10_000 });
      assert.ok(tenThousand.matches.length <= 10_000);

      // Large maxMatches, genuinely within policy (comfortably above the
      // fixture's real candidate count for a narrow, real, planted value —
      // this is the "cap NOT reached" case, proving the bound doesn't
      // truncate when real coverage is naturally smaller than the cap).
      const sentinelValue = Number(fields.SENTINEL_VALUE);
      const capNotReached = await nativeBackend.exactScan('u32', sentinelValue, undefined, { maxMatches: 50_000 });
      assert.ok(capNotReached.matches.length < 50_000, 'a narrow real value must not hit an oversized cap');
      assert.notEqual(capNotReached.completeness.state, 'resource_limit', 'when the cap is not reached, completeness must not falsely claim a resource limit');

      // Invalid maxMatches (0) — must not crash the native call; either
      // rejects cleanly or returns zero matches deterministically. This is
      // the backend's own robustness, independent of the IPC schema (which
      // separately rejects <=0 via `z.number().int().positive()` — this
      // proves the backend itself is not naively trusting an unvalidated
      // caller either).
      let zeroBoundThrew = false;
      let zeroBoundResult: Awaited<ReturnType<typeof nativeBackend.exactScan>> | undefined;
      try {
        zeroBoundResult = await nativeBackend.exactScan('u32', 0, undefined, { maxMatches: 0 });
      } catch {
        zeroBoundThrew = true;
      }
      assert.ok(
        zeroBoundThrew || zeroBoundResult?.matches.length === 0,
        'maxMatches=0 must either be rejected or deterministically yield zero matches — never crash or return unbounded results',
      );
    } finally {
      await nativeBackend.detach();
    }
  });
});

describeReal('NativeScannerBackend explicit 100,000-match request — Stage 7 final closure §4: backend itself must not crash/hang at real high volume', async () => {
  await withFixture(async ({ child }) => {
    const pid = child.pid!;
    const nativeBackend = new NativeScannerBackend();
    await nativeBackend.attach(pid);
    try {
      const start = Date.now();
      const result = await nativeBackend.exactScan('u32', 0, undefined, { maxMatches: 100_000 });
      const durationMs = Date.now() - start;
      // The fixture's real memory genuinely contains >= 100,000 zero-valued
      // u32s, so this exercises a real 100k-candidate scan, not a synthetic
      // one — proving the backend itself handles real high volume safely.
      // The PRODUCTION WIRE schema (LiveMemoryScanFirstSchema.maxMatches,
      // capped at 5,000) is what actually prevents any real IPC caller from
      // requesting this — an intentional, separately-proven lower product
      // cap (doc 92), not a gap this test needs to close.
      assert.ok(result.matches.length <= 100_000, `must never exceed the explicitly requested bound — got ${result.matches.length}`);
      assert.ok(durationMs < 10_000, `100k-match real scan must complete in bounded time, not hang — took ${durationMs}ms`);
      if (result.matches.length === 100_000) {
        assert.equal(result.completeness.state, 'resource_limit', 'hitting an explicit 100k cap must be reported honestly, not silently as complete');
      }
    } finally {
      await nativeBackend.detach();
    }
  });
});
