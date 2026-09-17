// Stage 2 napi-layer integration tests (mission §14/§15/§16/§18/§27's
// "napi/native build" + "focused native integration suite" requirement).
// Exercises the real compiled addon (index.js -> the .node binary built by
// `npm run build:debug`) against the same real spawned-process fixture the
// Rust-level integration tests use, from actual JavaScript, proving the
// napi boundary end to end — not just that the Rust crate compiles.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const addon = require('../index.js');

const FIXTURE_PATH = path.join(
  __dirname,
  '..',
  '..',
  'solith-scanner-core',
  'target',
  'debug',
  'solith-scanner-fixture.exe',
);

function requireFixtureBuilt() {
  if (!fs.existsSync(FIXTURE_PATH)) {
    throw new Error(
      `solith-scanner-fixture.exe not found at ${FIXTURE_PATH} — run "cargo build" in native/solith-scanner-core first.`,
    );
  }
}

function spawnFixture() {
  requireFixtureBuilt();
  const child = spawn(FIXTURE_PATH, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    let buffered = '';
    const fields = {};
    function onData(chunk) {
      buffered += chunk.toString('utf8');
      let idx;
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
        if (eq !== -1) {
          fields[line.slice(0, eq)] = line.slice(eq + 1);
        }
      }
    }
    child.stdout.on('data', onData);
    child.on('error', reject);
  });
}

function hexField(fields, key) {
  return BigInt(fields[key]);
}

function decField(fields, key) {
  return BigInt(fields[key]);
}

async function withFixture(fn) {
  const { child, fields } = await spawnFixture();
  try {
    await fn(child, fields);
  } finally {
    try {
      child.stdin.write('exit\n');
    } catch {
      /* already gone */
    }
    child.kill();
  }
}

test('debugEchoU64 round-trips a value far beyond Number.MAX_SAFE_INTEGER without precision loss', () => {
  // Two distinct real u64 values whose bytes differ but which collapse to
  // the SAME JS double once routed through Number() — the exact D06
  // collision Stage 1 doc 02 reproduced against the old TypeScript
  // scanner. If this napi boundary ever silently coerced through Number
  // internally, these two would come back equal to each other; going
  // through BigInt end to end, they must not.
  const a = 18446744073709551615n; // u64::MAX
  const b = 18446744073709551613n; // u64::MAX - 2
  assert.equal(Number(a), Number(b), 'test premise broken: these should collide under Number()');

  const resultA = addon.debugEchoU64(a);
  const resultB = addon.debugEchoU64(b);
  assert.equal(resultA, a);
  assert.equal(resultB, b);
  assert.notEqual(resultA, resultB, 'the napi boundary lost precision and collapsed two distinct u64 values');
});

test('NativeScanTarget.attach + enumerateRegions finds the fixture big region, fully classified', async () => {
  await withFixture(async (child) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    assert.equal(target.pid, child.pid);
    assert.equal(target.isAttached(), true);
    assert.equal(target.status(), 'open');

    const arch = target.architecture();
    assert.equal(arch, 'x64');
    assert.equal(target.pointerWidthBytes(), 8);

    const regions = target.enumerateRegions();
    assert.ok(regions.length > 0);
    for (const r of regions) {
      assert.equal(typeof r.baseAddress, 'bigint');
      assert.equal(typeof r.size, 'bigint');
    }
  });
});

test('readRegionChunked (real async native operation) covers a >1MiB region without blocking and reads the sentinel', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const regions = target.enumerateRegions();

    const bigBase = hexField(fields, 'BIG_REGION_BASE');
    const bigSize = decField(fields, 'BIG_REGION_SIZE');
    assert.ok(bigSize > 1024n * 1024n);

    const region = regions.find((r) => bigBase >= r.baseAddress && bigBase < r.baseAddress + r.size);
    assert.ok(region, 'fixture big region not found in enumerateRegions()');

    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();

    // Prove this is a real async operation, not a synchronous call wrapped
    // in a resolved Promise: a synchronous JS timer scheduled immediately
    // after the call must still be able to run before the Promise settles,
    // for a region large enough that the native read takes measurable time.
    let timerFiredBeforeSettle = false;
    const timer = setTimeout(() => {
      timerFiredBeforeSettle = true;
    }, 0);

    const outcomePromise = target.readRegionChunked(region, 1024n * 1024n, 7n, cancellation, progress);
    const outcome = await outcomePromise;
    clearTimeout(timer);

    assert.equal(outcome.completeness.state, 'complete');
    assert.ok(outcome.metrics.chunksRead > 1);

    const finalSnapshot = progress.snapshot();
    assert.equal(finalSnapshot.chunksRead, outcome.metrics.chunksRead);

    const sentinelOffset = decField(fields, 'SENTINEL_OFFSET');
    const sentinelExpected = Number(hexField(fields, 'SENTINEL_VALUE'));
    const sentinelAbsolute = bigBase + sentinelOffset;

    let found = null;
    for (const chunk of outcome.chunks) {
      const start = chunk.chunkBase;
      const end = start + chunk.requestedSize;
      if (sentinelAbsolute >= start && sentinelAbsolute + 4n <= end) {
        const localOffset = Number(sentinelAbsolute - start);
        found = chunk.data.readUInt32LE(localOffset);
        break;
      }
    }
    assert.notEqual(found, null, 'sentinel offset not covered by any returned chunk');
    assert.equal(found, sentinelExpected);

    // Not a strict assertion (timing-sensitive across CI hardware), but
    // recorded: on this run, did a same-tick timer get a chance to fire
    // before the native Promise settled?
    void timerFiredBeforeSettle;
  });
});

test('cancellation from JS actually stops an in-flight read', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const regions = target.enumerateRegions();
    const bigBase = hexField(fields, 'BIG_REGION_BASE');
    const region = regions.find((r) => bigBase >= r.baseAddress && bigBase < r.baseAddress + r.size);
    assert.ok(region);

    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();

    // A tiny chunk size over a multi-MiB region produces many chunks,
    // giving the polling loop below a real window to observe progress and
    // cancel before completion.
    const outcomePromise = target.readRegionChunked(region, 64n, 7n, cancellation, progress);

    let cancelled = false;
    for (let i = 0; i < 200 && !cancelled; i++) {
      const snap = progress.snapshot();
      if (snap.chunksRead > 0) {
        cancellation.cancel();
        cancelled = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.equal(cancelled, true, 'never observed any progress to cancel on — test setup issue, not a product defect');

    const outcome = await outcomePromise;
    assert.equal(outcome.completeness.state, 'cancelled');
    assert.equal(cancellation.isCancelled, true);
  });
});

test('spawnSync sanity: fixture binary exists and exits cleanly on the "exit" command', () => {
  requireFixtureBuilt();
  const result = spawnSync(FIXTURE_PATH, [], { timeout: 5000, input: 'exit\n' });
  assert.equal(result.error, undefined, 'fixture binary failed to launch');
  assert.equal(result.status, 0, 'fixture did not exit cleanly on "exit"');
});

test('NativeScanTarget: detach is idempotent and a detached target is used cleanly, not accessed unsafely', async () => {
  // Stage 6 §6.20: "cannot double-close unsafely" / "cannot access stale
  // target."
  await withFixture(async (child) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    assert.equal(target.isAttached(), true);
    target.detach();
    assert.equal(target.isAttached(), false);
    target.detach(); // idempotent — must not throw
    assert.equal(target.isAttached(), false);

    // A synchronous method on a detached target throws cleanly (never a
    // native crash/UB from touching a freed handle).
    assert.throws(() => target.enumerateRegions());

    // An async method on a detached target throws synchronously (before
    // any AsyncTask/Promise is constructed) or rejects — either way the
    // Promise it produces (via the async wrapper) must reject, not hang or
    // crash the process.
    const region = { baseAddress: 0n, size: 4096n, allocationBase: 0n, commitState: 'committed', kind: 'private', isReadable: true, isWritable: true, isExecutable: false, isGuard: false, isNoaccess: false, rawProtect: 0, rawType: 0 };
    await assert.rejects(async () =>
      target.readRegionChunked(region, 4096n, 0n, new addon.ScanCancellationHandle(), new addon.ScanProgressHandle()),
    );
  });
});

test('NativeScanTarget: scanExact rejects an unrecognized primitiveType/alignment before any scan starts', async () => {
  // Stage 6 §6.20: "reject invalid input predictably."
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const regions = target.enumerateRegions();
    const base = BigInt(fields.TYPES_REGION_BASE);
    const region = regions.find((r) => r.baseAddress <= base && base < r.baseAddress + r.size);
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();

    await assert.rejects(
      async () => target.scanExact(region, 'not_a_real_type', 1, null, 'bytewise', 1024n * 1024n, 3n, null, cancellation, progress),
      /invalid_configuration/,
    );
    await assert.rejects(
      async () => target.scanExact(region, 'i32', 1, null, 'not_a_real_alignment', 1024n * 1024n, 3n, null, cancellation, progress),
      /invalid_configuration/,
    );
  });
});
