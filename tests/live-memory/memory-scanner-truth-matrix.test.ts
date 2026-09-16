// Phase 1 final closure §4 — the D01 truth-reporting matrix.
//
// ROADMAP D01 stayed open because six sibling functions in `memory-scanner.ts`
// each did a bare `catch { continue; }` on a failed region read, so an
// unreadable region produced a result that claimed `truncated: false` and a
// zero-match result that read as an authoritative "this value is not in the
// process". `scanFirstRange` was repaired long ago (P0-SCAN-001); its five
// siblings were not, and the roadmap's prohibited-shortcut clause explicitly
// forbids closing D01 by fixing only a subset.
//
// This file runs the same matrix against EVERY function that sweeps regions:
//
//   A. fully readable memory            -> complete, truncated false
//   B. one unreadable eligible region   -> incomplete, truncated true
//   C. zero matches + unreadable region -> NOT an authoritative absence
//   D. matches before the unreadable region -> matches kept, truth kept
//   E. readable continuation after it   -> later matches kept, truth kept
//   F. process exit mid-scan            -> process_exited, not complete
//   G. cancellation                     -> cancelled, not complete
//
// Case E is the one that also catches the subtler pre-existing defect: the
// already-"fixed" `scanFirstRange` set `truncated = true` on a skip and then
// hit a shared `if (truncated) break`, so one unreadable region silently
// aborted the whole sweep one region later.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import {
  scanFirst,
  scanFirstAutoMatrix,
  scanFirstRange,
  scanFirstUnknown,
  scanNextFromSnapshot,
  scanNextFromSnapshotMultiType,
  type ScanCoverage,
} from '../../src/core/live-memory/memory-scanner.js';
import type { LiveValueType, ScanBounds } from '../../src/core/live-memory/types.js';

const HANDLE = { pid: 4242, opaque: { fake: true } };
const TARGET = 777;

/** A region holding `TARGET` at offset 0, plus filler that never matches. */
function matchingRegion(): Buffer {
  const buf = Buffer.alloc(64, 0x11);
  buf.writeInt32LE(TARGET, 0);
  return buf;
}

function nonMatchingRegion(): Buffer {
  return Buffer.alloc(64, 0x11);
}

/**
 * The functions under test have different signatures but the same obligation,
 * so each is wrapped down to one shape: given a driver, produce matches plus
 * coverage. That keeps the matrix itself a single set of assertions rather
 * than six near-copies that could drift apart again.
 */
interface SweepOutcome extends ScanCoverage {
  truncated: boolean;
  matchCount: number;
  /** Where results were found, so "the sweep continued past a skip" is testable. */
  resultAddresses: bigint[];
}

interface SweepUnderTest {
  name: string;
  run(driver: FakeMemoryDriver, bounds?: ScanBounds): SweepOutcome;
}

/** True when at least one result lies inside [base, base + size). */
function hasResultIn(outcome: SweepOutcome, base: bigint, size: bigint): boolean {
  return outcome.resultAddresses.some((a) => a >= base && a < base + size);
}

function snapshotFor(driver: FakeMemoryDriver, bounds?: ScanBounds) {
  return scanFirstUnknown(driver, HANDLE, bounds);
}

const SWEEPS: SweepUnderTest[] = [
  {
    name: 'scanFirst',
    run(driver, bounds) {
      const r = scanFirst(driver, HANDLE, 'int32', TARGET, bounds);
      return { ...r, matchCount: r.matches.length, resultAddresses: r.matches.map((m) => m.address) };
    },
  },
  {
    name: 'scanFirstRange',
    run(driver, bounds) {
      const r = scanFirstRange(driver, HANDLE, 'int32', TARGET, TARGET, bounds);
      return { ...r, matchCount: r.matches.length, resultAddresses: r.matches.map((m) => m.address) };
    },
  },
  {
    name: 'scanFirstUnknown',
    run(driver, bounds) {
      const r = scanFirstUnknown(driver, HANDLE, bounds);
      // A baseline snapshot searches for nothing, so it never claims an
      // absence; `matchCount` is reported as its captured region count so the
      // "results are preserved" cases below still mean something.
      return { ...r, matchCount: r.regions.length, resultAddresses: r.regions.map((region) => region.baseAddress) };
    },
  },
  {
    name: 'scanNextFromSnapshot',
    run(driver, bounds) {
      // Take the baseline against a fully readable driver so the narrowing
      // pass is the only thing under test, then apply the scenario.
      const r = scanNextFromSnapshot(driver, HANDLE, 'int32', { kind: 'unchanged' }, snapshotFor(driver), bounds);
      return { ...r, matchCount: r.matches.length, resultAddresses: r.matches.map((m) => m.address) };
    },
  },
  {
    name: 'scanNextFromSnapshotMultiType',
    run(driver, bounds) {
      const r = scanNextFromSnapshotMultiType(
        driver,
        HANDLE,
        ['int32'],
        { kind: 'unchanged' },
        snapshotFor(driver),
        bounds,
      );
      return { ...r, matchCount: r.matches.length, resultAddresses: r.matches.map((m) => m.address) };
    },
  },
  {
    name: 'scanFirstAutoMatrix/scanFirstByComparison',
    run(driver, bounds) {
      const result = scanFirstAutoMatrix(driver, HANDLE, {
        value: TARGET,
        modes: ['exact'],
        dataTypes: ['int32'] as LiveValueType[],
        bounds,
      });
      const bucket = result.buckets.find((b) => !b.skipped);
      assert.ok(bucket, 'auto matrix must produce an exact/int32 bucket');
      return { ...bucket, matchCount: bucket.matches.length, resultAddresses: bucket.matches.map((m) => m.address) };
    },
  },
];

for (const sweep of SWEEPS) {
  test(`D01 case A — ${sweep.name}: fully readable memory reports complete`, () => {
    const driver = new FakeMemoryDriver();
    driver.addRegion(0x1000n, matchingRegion(), true);
    driver.addRegion(0x2000n, nonMatchingRegion(), true);

    const result = sweep.run(driver);

    assert.equal(result.truncated, false, 'a fully readable sweep must not claim truncation');
    assert.equal(result.completeness.state, 'complete');
    assert.deepEqual(result.skippedRegions, []);
  });

  test(`D01 case B — ${sweep.name}: one unreadable eligible region reports incomplete`, () => {
    const driver = new FakeMemoryDriver();
    driver.addRegion(0x1000n, matchingRegion(), true);
    driver.addUnreadableRegion(0x2000n, 64, true);

    const result = sweep.run(driver);

    assert.equal(result.truncated, true, 'an unreadable eligible region must make the result truncated');
    assert.equal(result.completeness.state, 'complete_with_skipped_regions');
    assert.equal(result.skippedRegions.length, 1);
    assert.equal(result.skippedRegions[0].baseAddress, 0x2000n);
    assert.equal(result.skippedRegions[0].size, 64n);
  });

  test(`D01 case C — ${sweep.name}: zero matches plus an unreadable region is not an authoritative absence`, () => {
    const driver = new FakeMemoryDriver();
    driver.addRegion(0x1000n, nonMatchingRegion(), true);
    driver.addUnreadableRegion(0x2000n, 64, true);

    const result = sweep.run(driver);

    assert.equal(
      result.isAuthoritativeAbsence,
      false,
      'zero results over incomplete coverage must never be reported as a proven absence',
    );
  });

  test(`D01 case D — ${sweep.name}: matches found before the unreadable region are preserved`, () => {
    const driver = new FakeMemoryDriver();
    driver.addRegion(0x1000n, matchingRegion(), true);
    driver.addUnreadableRegion(0x2000n, 64, true);

    const result = sweep.run(driver);

    assert.ok(result.matchCount > 0, 'partial results must survive a later skip');
    assert.equal(result.truncated, true);
  });

  test(`D01 case E — ${sweep.name}: regions after the unreadable one are still scanned`, () => {
    const driver = new FakeMemoryDriver();
    // Order matters: the unreadable region comes FIRST, so a sweep that
    // aborts on a skip would never reach the two matches behind it.
    driver.addUnreadableRegion(0x1000n, 64, true);
    driver.addRegion(0x2000n, matchingRegion(), true);
    driver.addRegion(0x3000n, matchingRegion(), true);

    const result = sweep.run(driver);

    // The count varies by sweep (a `unchanged` narrowing matches every aligned
    // cell), so assert the property that actually matters: results came from
    // BOTH regions behind the skip, which an aborting sweep could not produce.
    assert.ok(hasResultIn(result, 0x2000n, 64n), 'the region right after the skip must still be scanned');
    assert.ok(hasResultIn(result, 0x3000n, 64n), 'later regions must still be scanned');
    assert.equal(result.truncated, true);
    assert.equal(result.isAuthoritativeAbsence, false);
  });

  test(`D01 case F — ${sweep.name}: a process that exits mid-sweep reports process_exited`, () => {
    const driver = new FakeMemoryDriver();
    driver.addRegion(0x1000n, matchingRegion(), true);
    driver.addRegion(0x2000n, matchingRegion(), true);

    // Baselines for the snapshot-consuming sweeps are captured inside run(),
    // against this same driver, so the failure must be armed by address
    // rather than by call count.
    const realRead = driver.readBuffer.bind(driver);
    driver.readBuffer = ((h: unknown, base: bigint, size: number) => {
      if (base === 0x2000n) throw new Error('read failed: the process is not running');
      return realRead(h as never, base, size);
    }) as typeof driver.readBuffer;

    const result = sweep.run(driver);

    assert.equal(result.completeness.state, 'process_exited');
    assert.equal(result.truncated, true);
    assert.equal(result.isAuthoritativeAbsence, false);
  });
}

// Cancellation only applies to the sweeps that accept bounds with a signal;
// `scanNext` narrows an explicit candidate list and takes none.
for (const sweep of SWEEPS) {
  test(`D01 case G — ${sweep.name}: a cancelled sweep reports cancelled, never complete`, () => {
    const driver = new FakeMemoryDriver();
    driver.addRegion(0x1000n, matchingRegion(), true);
    driver.addRegion(0x2000n, matchingRegion(), true);

    const result = sweep.run(driver, { signal: { aborted: true } });

    assert.equal(result.completeness.state, 'cancelled');
    assert.equal(result.truncated, true);
    assert.equal(result.isAuthoritativeAbsence, false);
  });
}

// The repo-wide guarantee behind §5: no sibling may quietly regress to a
// consequence-free skip. This asserts on the source itself, so a future edit
// that reintroduces a bare `catch { continue; }` in a scanner sweep fails here
// rather than silently reopening D01.
test('D01 §5 — no scanner sweep file retains a consequence-free catch/continue', async () => {
  const { readFile } = await import('node:fs/promises');
  const files = [
    'src/core/live-memory/memory-scanner.ts',
    'src/core/live-memory/pointer-scanner.ts',
    'src/core/live-memory/aob-resolver.ts',
    'src/core/live-memory/signature-engine.ts',
  ];

  for (const file of files) {
    const raw = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
    // Comments are stripped first — these files deliberately DESCRIBE the old
    // `catch { continue; }` shape in their doc comments, and that prose is
    // evidence of the repair, not an instance of the defect.
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // A bare `catch {` whose body is nothing but `continue;` is the exact
    // shape that loses the failure.
    const bareSkip = /catch\s*(\([^)]*\))?\s*\{\s*continue\s*;/;
    assert.equal(
      bareSkip.test(source),
      false,
      `${file} contains a catch that continues without recording the failure`,
    );
  }
});
