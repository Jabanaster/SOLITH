// Stage 5 real Node/TS integration tests (mission §5.16) — the compiled
// .node addon, no mocked native module, against the real spawned fixture.
// Proves, from actual JavaScript:
//   1. UTF-8 string found
//   2. UTF-16 string found
//   3. Unicode (non-BMP) string found
//   4. raw byte pattern found
//   5. exact AOB found
//   6. wildcard AOB found
//   7. nibble wildcard found
//   8. cross-chunk pattern found once (string, per boundary offset)
//   9. pattern beyond 1 MiB found
//  10. all duplicate instances returned
//  11. first-match mode returns deterministic first address
//  12. cancellation
//  13. progress
//  14. skipped-region incompleteness (real PAGE_NOACCESS page)
//  15. authoritative not-found only under complete coverage
//  16. bounded result retrieval (maxResults)
//  17. malformed pattern rejected

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

function patternRegion(fields, regions) {
  const base = BigInt(fields.PATTERN_REGION_BASE);
  return regions.find((r) => r.baseAddress <= base && base < r.baseAddress + r.size);
}

// Deliberately NOT derived from a real enumerateRegions() call: the
// PAGE_NOACCESS middle page causes VirtualQueryEx to report 3 separate
// regions, and this test wants to prove the *reader's* per-chunk failure
// classification (mirroring the Rust fixture_integration.rs test of the
// same name/rationale) — a synthetic region spanning the whole 3-page
// allocation isolates that.
function guardRegion(fields) {
  const base = BigInt(fields.GUARD_REGION_BASE);
  const size = BigInt(fields.GUARD_REGION_SIZE);
  return {
    baseAddress: base,
    size,
    allocationBase: base,
    commitState: 'committed',
    kind: 'private',
    isReadable: true,
    isWritable: true,
    isExecutable: false,
    isGuard: false,
    isNoaccess: false,
    rawProtect: 0,
    rawType: 0,
  };
}

test('pattern: UTF-8 ASCII string is found at its planted offset', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const region = patternRegion(fields, target.enumerateRegions());
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();
    const outcome = await target.scanString(
      region,
      fields.UTF8_ASCII_TEXT,
      'utf8',
      true,
      'none',
      1024n * 1024n,
      null,
      null,
      cancellation,
      progress,
    );
    assert.equal(outcome.kind, 'utf8');
    assert.equal(outcome.completeness.state, 'complete');
    const expected = region.baseAddress + BigInt(fields.UTF8_ASCII_OFFSET);
    assert.ok(outcome.matches.some((m) => m.address === expected));
  });
});

test('pattern: UTF-16LE string is found at its planted offset', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const region = patternRegion(fields, target.enumerateRegions());
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();
    const outcome = await target.scanString(
      region,
      fields.UTF16LE_TEXT,
      'utf16le',
      true,
      'none',
      1024n * 1024n,
      null,
      null,
      cancellation,
      progress,
    );
    assert.equal(outcome.kind, 'utf16le');
    const expected = region.baseAddress + BigInt(fields.UTF16LE_OFFSET);
    assert.ok(outcome.matches.some((m) => m.address === expected));
  });
});

test('pattern: non-BMP Unicode (surrogate pair) UTF-16LE string is found', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const region = patternRegion(fields, target.enumerateRegions());
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();
    const text = 'Win\u{1F600}!';
    const outcome = await target.scanString(
      region,
      text,
      'utf16le',
      true,
      'none',
      1024n * 1024n,
      null,
      null,
      cancellation,
      progress,
    );
    const expected = region.baseAddress + BigInt(fields.UTF16LE_NONBMP_OFFSET);
    assert.ok(outcome.matches.some((m) => m.address === expected));
  });
});

test('pattern: raw byte pattern is found, and both duplicate instances are returned', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const region = patternRegion(fields, target.enumerateRegions());
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();
    const bytes = Buffer.from([0x13, 0x37, 0xc0, 0xde, 0x99, 0x88]);
    const outcome = await target.scanBytes(region, bytes, 1024n * 1024n, null, null, cancellation, progress);
    assert.equal(outcome.kind, 'raw_bytes');
    const addrA = region.baseAddress + BigInt(fields.RAW_BYTES_OFFSET);
    const addrB = region.baseAddress + BigInt(fields.RAW_BYTES_DUPLICATE_OFFSET);
    const addrs = outcome.matches.map((m) => m.address);
    assert.ok(addrs.includes(addrA));
    assert.ok(addrs.includes(addrB));
    // Deterministic address-ascending order.
    for (let i = 1; i < addrs.length; i += 1) {
      assert.ok(addrs[i - 1] < addrs[i]);
    }
  });
});

test('pattern: exact AOB signature is found', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const region = patternRegion(fields, target.enumerateRegions());
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();
    const outcome = await target.scanAob(
      region,
      '48 8B 05 11 22 33 44 89',
      1024n * 1024n,
      null,
      null,
      cancellation,
      progress,
    );
    assert.equal(outcome.kind, 'aob');
    const expected = region.baseAddress + BigInt(fields.AOB_EXACT_OFFSET);
    assert.ok(outcome.matches.some((m) => m.address === expected));
  });
});

test('pattern: full-byte wildcard AOB matches regardless of the wildcarded byte', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const region = patternRegion(fields, target.enumerateRegions());
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();
    const outcome = await target.scanAob(
      region,
      '48 8B 05 ?? 22 33 44 89',
      1024n * 1024n,
      null,
      null,
      cancellation,
      progress,
    );
    const expected = region.baseAddress + BigInt(fields.AOB_WILDCARD_OFFSET);
    assert.ok(outcome.matches.some((m) => m.address === expected));
  });
});

test('pattern: nibble wildcard AOB matches regardless of the wildcarded nibble', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const region = patternRegion(fields, target.enumerateRegions());
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();
    const outcome = await target.scanAob(region, 'A? 00 ?3', 1024n * 1024n, null, null, cancellation, progress);
    const expected = region.baseAddress + BigInt(fields.AOB_NIBBLE_OFFSET);
    assert.ok(outcome.matches.some((m) => m.address === expected));
  });
});

test('pattern: cross-chunk-boundary patterns are found exactly once (byte, string, wildcard AOB)', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const region = patternRegion(fields, target.enumerateRegions());
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();

    const byteOutcome = await target.scanBytes(
      region,
      Buffer.from([0xab, 0xcd]),
      1024n * 1024n,
      null,
      null,
      cancellation,
      progress,
    );
    const byteAddr = region.baseAddress + BigInt(fields.PATTERN_BOUNDARY_2_OFFSET);
    assert.equal(byteOutcome.matches.filter((m) => m.address === byteAddr).length, 1);

    const stringOutcome = await target.scanString(
      region,
      fields.PATTERN_BOUNDARY_STRING_TEXT,
      'utf8',
      true,
      'none',
      1024n * 1024n,
      null,
      null,
      cancellation,
      progress,
    );
    const stringAddr = region.baseAddress + BigInt(fields.PATTERN_BOUNDARY_STRING_OFFSET);
    assert.equal(stringOutcome.matches.filter((m) => m.address === stringAddr).length, 1);

    const wildcardQuery =
      'F0 F1 F2 F3 F4 F5 ?? F7 F8 F9 FA FB FC FD FE FF ' +
      'E0 E1 ?? E3 E4 E5 E6 E7 E8 E9 EA EB EC ED EE EF';
    const aobOutcome = await target.scanAob(region, wildcardQuery, 1024n * 1024n, null, null, cancellation, progress);
    const aobAddr = region.baseAddress + BigInt(fields.PATTERN_BOUNDARY_32_OFFSET);
    assert.equal(aobOutcome.matches.filter((m) => m.address === aobAddr).length, 1);
  });
});

test('pattern: a signature well beyond the old 1 MiB cap is found by the native path', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const region = patternRegion(fields, target.enumerateRegions());
    assert.ok(Number(fields.FAR_MARKER_OFFSET) > 1024 * 1024);
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();
    const outcome = await target.scanBytes(
      region,
      Buffer.from([0xde, 0xad, 0xc0, 0xde, 0x42]),
      1024n * 1024n,
      null,
      null,
      cancellation,
      progress,
    );
    assert.equal(outcome.completeness.state, 'complete');
    const expected = region.baseAddress + BigInt(fields.FAR_MARKER_OFFSET);
    assert.ok(outcome.matches.some((m) => m.address === expected));
  });
});

test('pattern: first-match mode returns exactly one deterministic (lowest) address', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const region = patternRegion(fields, target.enumerateRegions());
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();
    const outcome = await target.scanBytes(
      region,
      Buffer.from([0x13, 0x37, 0xc0, 0xde, 0x99, 0x88]),
      1024n * 1024n,
      null,
      true,
      cancellation,
      progress,
    );
    assert.equal(outcome.matches.length, 1);
    assert.equal(outcome.matches[0].address, region.baseAddress + BigInt(fields.RAW_BYTES_OFFSET));
    assert.equal(outcome.completeness.state, 'resource_limit');
  });
});

test('pattern: maxResults bounds the returned result set truthfully', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const region = patternRegion(fields, target.enumerateRegions());
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();
    const outcome = await target.scanBytes(
      region,
      Buffer.from([0x13, 0x37, 0xc0, 0xde, 0x99, 0x88]),
      1024n * 1024n,
      1n,
      null,
      cancellation,
      progress,
    );
    assert.equal(outcome.matches.length, 1);
    assert.equal(outcome.completeness.state, 'resource_limit');
  });
});

test('pattern: cancellation stops the scan before full coverage', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const region = patternRegion(fields, target.enumerateRegions());
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();
    const scanPromise = target.scanBytes(
      region,
      Buffer.from([0xde, 0xad, 0xc0, 0xde, 0x42]),
      1024n * 1024n,
      null,
      null,
      cancellation,
      progress,
    );
    // Cancel promptly; a real large (8 MiB) region guarantees multiple
    // chunks remain unread when this fires.
    cancellation.cancel();
    const outcome = await scanPromise;
    assert.equal(outcome.completeness.state, 'cancelled');
    const farAddr = region.baseAddress + BigInt(fields.FAR_MARKER_OFFSET);
    assert.ok(!outcome.matches.some((m) => m.address === farAddr));
  });
});

test('pattern: progress reflects real work done during the scan', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const region = patternRegion(fields, target.enumerateRegions());
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();
    const outcome = await target.scanBytes(
      region,
      Buffer.from([0xde, 0xad, 0xc0, 0xde, 0x42]),
      1024n * 1024n,
      null,
      null,
      cancellation,
      progress,
    );
    assert.equal(outcome.completeness.state, 'complete');
    const snapshot = progress.snapshot();
    assert.ok(snapshot.bytesRead > 0n);
  });
});

test('pattern: a real unreadable page reports skipped-region incompleteness, never authoritative not-found', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const region = guardRegion(fields);
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();
    const outcome = await target.scanBytes(
      region,
      Buffer.from([0x5e, 0xc4, 0x37, 0x21]),
      4096n,
      null,
      null,
      cancellation,
      progress,
    );
    assert.equal(outcome.matches.length, 0);
    assert.notEqual(outcome.completeness.state, 'complete');
    assert.equal(outcome.completeness.state, 'complete_with_skipped_regions');
  });
});

test('pattern: a genuinely absent pattern under full coverage is authoritatively not found', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const region = patternRegion(fields, target.enumerateRegions());
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();
    const outcome = await target.scanBytes(
      region,
      Buffer.from([0x00, 0x99, 0x88, 0x77, 0x66, 0x55, 0x44, 0x33]),
      1024n * 1024n,
      null,
      null,
      cancellation,
      progress,
    );
    assert.equal(outcome.matches.length, 0);
    assert.equal(outcome.completeness.state, 'complete');
  });
});

test('pattern: a malformed AOB pattern is rejected with a stable error, not silently accepted', async () => {
  await withFixture(async (child, fields) => {
    const target = addon.NativeScanTarget.attach(child.pid);
    const region = patternRegion(fields, target.enumerateRegions());
    const cancellation = new addon.ScanCancellationHandle();
    const progress = new addon.ScanProgressHandle();
    // Pattern parsing/validation throws synchronously (before any
    // AsyncTask/Promise is constructed) — wrapped in an async arrow so a
    // synchronous throw still becomes a rejected promise for assert.rejects
    // (the same distinction Stage 4 doc 31 documented for session.refine).
    await assert.rejects(
      async () => target.scanAob(region, 'AA GG CC', 1024n * 1024n, null, null, cancellation, progress),
      /invalid_hex_token/,
    );
    await assert.rejects(
      async () => target.scanAob(region, '', 1024n * 1024n, null, null, cancellation, progress),
      /empty_pattern/,
    );
  });
});
