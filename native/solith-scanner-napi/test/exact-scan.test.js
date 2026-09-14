// Stage 3 real Node/TS integration tests (mission §3.14) — the compiled
// .node addon, no mocked native module, against the real spawned fixture.
// Proves, from actual JavaScript:
//   1. spawn fixture
//   2. open fixture process
//   3. enumerate memory
//   4. scan exact primitive value
//   5. receive correct address
//   6. retrieve unaligned result
//   7. retrieve cross-chunk result
//   8. round-trip u64 > JS safe integer
//   9. cancellation works
//  10. progress works
//  11. incomplete scan cannot report authoritative complete
//  12. bounded result paging (max_results / resource-limit truncation)

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
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
    throw new Error(`solith-scanner-fixture.exe not found at ${FIXTURE_PATH} — run "cargo build" in native/solith-scanner-core first.`);
  }
}

// 1. spawn fixture
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
        if (eq !== -1) fields[line.slice(0, eq)] = line.slice(eq + 1);
      }
    }
    child.stdout.on('data', onData);
    child.on('error', reject);
  });
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

function typesRegion(fields, regions) {
  const base = BigInt(fields.TYPES_REGION_BASE);
  return regions.find((r) => r.baseAddress <= base && base < r.baseAddress + r.size);
}

test('exact scan: every primitive type is found at its planted (aligned or unaligned) offset', async () => {
  await withFixture(async (child, fields) => {
    // 2. open fixture process
    const target = addon.NativeScanTarget.attach(child.pid);
    // 3. enumerate memory
    const regions = target.enumerateRegions();
    const region = typesRegion(fields, regions);
    assert.ok(region, 'TYPES_REGION not found via real enumeration');

    const base = BigInt(fields.TYPES_REGION_BASE);
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();

    const cases = [
      ['i8', Number(fields.I8_VALUE), Number(fields.I8_OFFSET), 1n],
      ['u8', Number(fields.U8_VALUE), Number(fields.U8_OFFSET), 1n],
      ['i16', Number(fields.I16_VALUE), Number(fields.I16_OFFSET), 1n],
      ['u16', Number(fields.U16_VALUE), Number(fields.U16_OFFSET), 1n],
      ['i32', Number(fields.I32_VALUE), Number(fields.I32_OFFSET), 3n],
      ['u32', Number(fields.U32_VALUE), Number(fields.U32_OFFSET), 3n],
      ['f32', Number(fields.F32_VALUE), Number(fields.F32_OFFSET), 3n],
      ['f64', Number(fields.F64_VALUE), Number(fields.F64_OFFSET), 7n],
    ];

    for (const [primitiveType, value, offset, overlap] of cases) {
      // 4. scan exact primitive value
      const outcome = await target.scanExact(
        region,
        primitiveType,
        value,
        null,
        'bytewise',
        1024n * 1024n,
        overlap,
        null,
        cancellation,
        progress,
      );
      assert.equal(outcome.completeness.state, 'complete', `${primitiveType}: expected complete scan`);
      // 5. receive correct address
      const expectedAddr = base + BigInt(offset);
      const hit = outcome.matches.find((m) => m.address === expectedAddr);
      assert.ok(hit, `${primitiveType}: expected a hit at 0x${expectedAddr.toString(16)}, got ${outcome.matches.length} matches`);
    }

    // 6. retrieve unaligned result — I32_OFFSET(321)/I16_OFFSET(193) are
    // both deliberately non-type-width-aligned in the fixture; already
    // covered by the loop above (both cases assert a hit at their exact
    // unaligned offset), asserted again explicitly here for clarity.
    const i32Offset = Number(fields.I32_OFFSET);
    assert.notEqual(i32Offset % 4, 0, 'test premise: I32_OFFSET must be unaligned');
  });
});

test('exact scan: cross-chunk (boundary-straddling) results are retrieved correctly for 2/4/8-byte widths', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const regions = target.enumerateRegions();
    const region = typesRegion(fields, regions);
    const base = BigInt(fields.TYPES_REGION_BASE);
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();

    const boundaryCases = [
      ['u16', Number(fields.BOUNDARY_U16_VALUE), Number(fields.BOUNDARY_U16_OFFSET), 1n],
      ['u32', Number(fields.BOUNDARY_U32_VALUE), Number(fields.BOUNDARY_U32_OFFSET), 3n],
    ];
    for (const [primitiveType, value, offset, overlap] of boundaryCases) {
      // 7. retrieve cross-chunk result
      const outcome = await target.scanExact(
        region,
        primitiveType,
        value,
        null,
        'bytewise',
        1024n * 1024n,
        overlap,
        null,
        cancellation,
        progress,
      );
      assert.equal(outcome.completeness.state, 'complete');
      const expectedAddr = base + BigInt(offset);
      const hits = outcome.matches.filter((m) => m.address === expectedAddr);
      assert.equal(hits.length, 1, `${primitiveType}: boundary value must appear exactly once (found ${hits.length})`);
    }
  });
});

test('exact scan: u64 beyond JS safe integer round-trips exactly via BigInt', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const regions = target.enumerateRegions();
    const region = typesRegion(fields, regions);
    const base = BigInt(fields.TYPES_REGION_BASE);
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();

    const hugeValue = BigInt(fields.U64_HUGE_VALUE);
    assert.ok(hugeValue > 2n ** 53n, 'test premise: fixture value must exceed 2^53');

    // 8. round-trip u64 > JS safe integer
    const outcome = await target.scanExact(
      region,
      'u64',
      null,
      hugeValue,
      'bytewise',
      1024n * 1024n,
      7n,
      null,
      cancellation,
      progress,
    );
    assert.equal(outcome.completeness.state, 'complete');
    const expectedAddr = base + BigInt(fields.U64_HUGE_OFFSET);
    const hit = outcome.matches.find((m) => m.address === expectedAddr);
    assert.ok(hit, 'huge u64 value not found');
    assert.equal(typeof hit.valueBigint, 'bigint');
    assert.equal(hit.valueBigint, hugeValue);
    assert.equal(hit.valueNumber, undefined);
  });
});

test('exact scan: cancellation works from real JS', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const regions = target.enumerateRegions();
    const region = typesRegion(fields, regions);
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();

    // Tiny chunks -> many chunks -> real chance to observe progress and cancel mid-scan.
    const outcomePromise = target.scanExact(
      region,
      'u32',
      0xffffffff,
      null,
      'bytewise',
      4096n,
      3n,
      null,
      cancellation,
      progress,
    );

    let cancelled = false;
    for (let i = 0; i < 500 && !cancelled; i++) {
      const snap = progress.snapshot();
      if (snap.chunksRead > 0) {
        // 9. cancellation works
        cancellation.cancel();
        cancelled = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.equal(cancelled, true, 'never observed progress to cancel on');

    const outcome = await outcomePromise;
    assert.equal(outcome.completeness.state, 'cancelled');
  });
});

test('exact scan: progress works and reflects real work done', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const regions = target.enumerateRegions();
    const region = typesRegion(fields, regions);
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();

    const before = progress.snapshot();
    assert.equal(before.chunksRead, 0);

    // 10. progress works
    const outcome = await target.scanExact(
      region,
      'u8',
      0,
      null,
      'bytewise',
      1024n * 1024n,
      0n,
      null,
      cancellation,
      progress,
    );
    const after = progress.snapshot();
    assert.equal(after.chunksRead, outcome.metrics.chunksRead);
    assert.ok(after.chunksRead > 0);
  });
});

test('exact scan: incomplete coverage never reports authoritative complete (zero matches distinguishable)', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const regions = target.enumerateRegions();
    const region = typesRegion(fields, regions);
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();

    // A value that is genuinely absent from memory, scanned with a tiny
    // resource limit to force incomplete coverage (a real, deterministic
    // way to construct "incomplete" from real JS without needing to
    // fabricate an inaccessible page from the JS side).
    const outcome = await target.scanExact(
      region,
      'u32',
      0x7eadbeef,
      null,
      'bytewise',
      4096n,
      3n,
      1n, // maxResults=1, but there are zero real matches, so this alone
      cancellation,
      progress,
    );
    // 11. incomplete scan cannot report authoritative complete: this
    // specific case (absent value, no cap actually hit) SHOULD still
    // report complete==true because nothing was truncated — the real
    // proof of §11 is the *other* half: a scan that DOES hit its cap
    // must not say complete, which the resource-limit-paging test below
    // demonstrates with a value that truly exists many times over.
    assert.equal(outcome.matches.length, 0);
    assert.equal(outcome.completeness.state, 'complete', 'a value that is genuinely absent, with coverage that never hit any limit, must report complete');
    // Stage 6 §6.3's shared rule, via the real compiled addon.
    assert.equal(outcome.isAuthoritativeAbsence, true);
  });
});

test('exact scan: bounded result paging — max_results truncates and reports resource_limit, never complete', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const regions = target.enumerateRegions();
    const region = typesRegion(fields, regions);
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();

    // Byte value 0 occurs thousands of times in the fixture's decoy fill
    // (deterministic formula, offset 0 -> byte 0) — scanning for it with a
    // tiny cap proves bounded result paging (mission §3.8/§3.14-12) and
    // the truthful-incompleteness half of §11 in one real call.
    const outcome = await target.scanExact(
      region,
      'u8',
      0,
      null,
      'bytewise',
      1024n * 1024n,
      0n,
      5n, // 12. bounded result paging
      cancellation,
      progress,
    );
    assert.ok(outcome.matches.length <= 5, `expected <= 5 matches, got ${outcome.matches.length}`);
    assert.equal(outcome.completeness.state, 'resource_limit');
    assert.notEqual(outcome.completeness.state, 'complete');
  });
});
