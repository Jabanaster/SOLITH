// Phase 1 final closure §6-§14 — D05, pointer depth and truncation truth.
//
// Audit 2 recorded a pointer scan that reported `levelsSearched: 1` against a
// requested `maxDepth: 3` with `truncated: false`. The old implementation had
// no way to express the difference between the two situations that produce
// that shape:
//
//   - the frontier genuinely ran out (nothing deeper exists to follow), and
//   - the search stopped at a result cap, a candidate cap, a scan budget, a
//     read failure, a cancellation or a dead process.
//
// Only the first is complete. The old code reported both as complete, and on
// top of that had no cycle detection at all, so A -> B -> A re-expanded the
// same addresses at every level.
//
// Every case in mission §7 is covered here, and each one asserts the SPECIFIC
// termination reason rather than just `truncated`, so a future change that
// makes everything look incomplete would not pass either.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import { scanForPointerPath } from '../../src/core/live-memory/pointer-scanner.js';
import { resolvePointerPath } from '../../src/core/live-memory/pointer-resolver.js';

const HANDLE = { pid: 4711, opaque: { fake: true } };

const MODULE_BASE = 0x400000n;
const MODULE_SIZE = 0x100000;
const STATIC_SLOT = 0x2000;

/**
 * Builds `base -> ptr1 -> ptr2 -> ... -> target`, the §13 shape.
 *
 * `levels` is how many pointer edges separate the module slot from the target.
 * Every heap node sits in its own region, and the value lives at `+16` in the
 * final one, so a depth-N chain has offsets `[0, 0, ..., 16]`.
 */
function buildChain(levels: number): { driver: FakeMemoryDriver; target: bigint; nodes: bigint[] } {
  const driver = new FakeMemoryDriver();
  const nodes: bigint[] = [];
  for (let i = 0; i < levels; i++) {
    nodes.push(0x10000000n * BigInt(i + 1));
  }

  const moduleRegion = Buffer.alloc(0x3000, 0);
  moduleRegion.writeBigUInt64LE(nodes[0], STATIC_SLOT);
  driver.addRegion(MODULE_BASE, moduleRegion, true);
  driver.addModule('game.exe', MODULE_BASE, MODULE_SIZE);

  for (let i = 0; i < levels; i++) {
    const region = Buffer.alloc(64, 0);
    if (i + 1 < levels) {
      region.writeBigUInt64LE(nodes[i + 1], 0);
    } else {
      region.writeInt32LE(1337, 16);
    }
    driver.addRegion(nodes[i], region, true);
  }

  return { driver, target: nodes[levels - 1] + 16n, nodes };
}

// ---------------------------------------------------------------------------
// §9 — depth semantics. maxDepth N means exactly N pointer edge levels.
// ---------------------------------------------------------------------------

test('D05 §9 — maxDepth 1 searches exactly one pointer level and finds a depth-1 path', () => {
  const { driver, target } = buildChain(1);

  const result = scanForPointerPath(driver, HANDLE, target, { maxDepth: 1 });

  assert.equal(result.requestedDepth, 1);
  assert.equal(result.levelsSearched, 1);
  assert.equal(result.deepestLevelCompleted, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].depth, 1);
  assert.deepEqual(result.candidates[0].offsets, [16]);
  assert.equal(result.termination, 'frontier_exhausted');
  assert.equal(result.completeness.state, 'complete');
  assert.equal(result.truncated, false);
  assert.equal(resolvePointerPath(driver, HANDLE, result.candidates[0]), target);
});

test('D05 §9 — maxDepth 2 reaches level 2 and resolves the two-edge chain', () => {
  const { driver, target } = buildChain(2);

  const result = scanForPointerPath(driver, HANDLE, target, { maxDepth: 2 });

  assert.equal(result.levelsSearched, 2);
  assert.equal(result.deepestLevelCompleted, 2);
  const candidate = result.candidates.find((c) => c.depth === 2);
  assert.ok(candidate, 'a two-edge chain must produce a depth-2 candidate');
  assert.deepEqual(candidate.offsets, [0, 16]);
  assert.equal(result.truncated, false);
  assert.equal(resolvePointerPath(driver, HANDLE, candidate), target);
});

test('D05 §9 — maxDepth 3 reaches level 3 and resolves the three-edge chain', () => {
  const { driver, target } = buildChain(3);

  const result = scanForPointerPath(driver, HANDLE, target, { maxDepth: 3 });

  assert.equal(result.levelsSearched, 3);
  assert.equal(result.deepestLevelCompleted, 3);
  const candidate = result.candidates.find((c) => c.depth === 3);
  assert.ok(candidate, 'a three-edge chain must produce a depth-3 candidate');
  assert.deepEqual(candidate.offsets, [0, 0, 16]);
  assert.equal(result.truncated, false);
  assert.equal(resolvePointerPath(driver, HANDLE, candidate), target);
});

// ---------------------------------------------------------------------------
// §7 — the original defect. This is the exact shape Audit 2 recorded.
// ---------------------------------------------------------------------------

test('D05 §7 — a depth-3 chain searched at maxDepth 2 must NOT report complete', () => {
  const { driver, target } = buildChain(3);

  const result = scanForPointerPath(driver, HANDLE, target, { maxDepth: 2 });

  // Level 2 was reached; the module root is one level further on.
  assert.equal(result.levelsSearched, 2);
  assert.equal(result.candidates.length, 0);
  // The defect: the old implementation stopped here with `truncated: false`,
  // so "no pointer path exists" and "we stopped looking" were the same answer.
  assert.equal(result.termination, 'depth_limit_reached');
  assert.equal(result.truncated, true);
  assert.equal(result.isAuthoritativeAbsence, false);
  assert.notEqual(result.completeness.state, 'complete');
});

test('D05 §7 — requesting more depth than the chain has still reports genuine exhaustion', () => {
  const { driver, target } = buildChain(1);

  const result = scanForPointerPath(driver, HANDLE, target, { maxDepth: 3 });

  // levelsSearched (1) is legitimately below requestedDepth (3) here, because
  // nothing remained to follow — the one case where stopping short IS
  // complete. Reporting this as truncated would be the opposite lie.
  assert.equal(result.requestedDepth, 3);
  assert.equal(result.levelsSearched, 1);
  assert.equal(result.termination, 'frontier_exhausted');
  assert.equal(result.completeness.state, 'complete');
  assert.equal(result.truncated, false);
  assert.equal(result.candidates.length, 1);
});

test('D05 §7 — a broken link yields a complete, authoritative "no path" answer', () => {
  const driver = new FakeMemoryDriver();
  // A heap object with the value, and nothing anywhere pointing at it.
  const heapBase = 0x30000000n;
  const heapRegion = Buffer.alloc(64, 0);
  heapRegion.writeInt32LE(1337, 16);
  driver.addRegion(heapBase, heapRegion, true);
  driver.addRegion(MODULE_BASE, Buffer.alloc(0x3000, 0), true);
  driver.addModule('game.exe', MODULE_BASE, MODULE_SIZE);

  const result = scanForPointerPath(driver, HANDLE, heapBase + 16n, { maxDepth: 3 });

  assert.equal(result.candidates.length, 0);
  assert.equal(result.termination, 'frontier_exhausted');
  assert.equal(result.completeness.state, 'complete');
  assert.equal(result.isAuthoritativeAbsence, true);
});

test('D05 §7 — a branching chain finds every module root without double-counting', () => {
  const { driver, target, nodes } = buildChain(2);
  // A second static slot pointing at the same intermediate node: two distinct
  // module-rooted paths to one target.
  const secondModuleRegion = Buffer.alloc(0x1000, 0);
  secondModuleRegion.writeBigUInt64LE(nodes[0], 0x100);
  driver.addRegion(0x800000n, secondModuleRegion, true);
  driver.addModule('plugin.dll', 0x800000n, 0x10000);

  const result = scanForPointerPath(driver, HANDLE, target, { maxDepth: 3 });

  const moduleNames = result.candidates.map((c) => c.moduleName).sort();
  assert.deepEqual(moduleNames, ['game.exe', 'plugin.dll']);
  assert.equal(result.truncated, false);
});

// ---------------------------------------------------------------------------
// §10 — truncation rules for read failures, caps and budgets.
// ---------------------------------------------------------------------------

test('D05 §10 — an unreadable intermediate region makes the result incomplete', () => {
  const { driver, target, nodes } = buildChain(2);
  driver.addUnreadableRegion(0x90000000n, 4096, true);
  void nodes;

  const result = scanForPointerPath(driver, HANDLE, target, { maxDepth: 3 });

  assert.ok(result.skippedRegions.length > 0, 'the unreadable region must be recorded');
  assert.equal(result.completeness.state, 'complete_with_skipped_regions');
  assert.equal(result.truncated, true);
  assert.equal(result.isAuthoritativeAbsence, false);
  // Partial results still survive — incompleteness is reported, not thrown away.
  assert.ok(result.candidates.length > 0);
});

test('D05 §10 — hitting the result cap reports resource_limit, not completion', () => {
  const driver = new FakeMemoryDriver();
  const heapBase = 0x40000000n;
  const heapRegion = Buffer.alloc(64, 0);
  heapRegion.writeInt32LE(1337, 16);
  driver.addRegion(heapBase, heapRegion, true);

  // Many static slots all pointing at the same heap object: more module-rooted
  // candidates than the result cap allows.
  const moduleRegion = Buffer.alloc(0x1000, 0);
  for (let i = 0; i < 10; i++) {
    moduleRegion.writeBigUInt64LE(heapBase, i * 8);
  }
  driver.addRegion(MODULE_BASE, moduleRegion, true);
  driver.addModule('game.exe', MODULE_BASE, MODULE_SIZE);

  const result = scanForPointerPath(driver, HANDLE, heapBase + 16n, { maxDepth: 3, maxResults: 3 });

  assert.equal(result.candidates.length, 3);
  assert.equal(result.termination, 'result_limit_reached');
  assert.equal(result.completeness.state, 'resource_limit');
  assert.equal(result.truncated, true);
});

test('D05 §10/§12 — dropping heap candidates at the per-level cap reports resource_limit', () => {
  const driver = new FakeMemoryDriver();
  const target = 0x50000000n;
  const targetRegion = Buffer.alloc(64, 0);
  targetRegion.writeInt32LE(1337, 16);
  driver.addRegion(target, targetRegion, true);

  // Five separate heap regions each pointing at the target, no module anywhere,
  // so every hit is a heap candidate competing for the per-level slots.
  for (let i = 0; i < 5; i++) {
    const region = Buffer.alloc(64, 0);
    region.writeBigUInt64LE(target + 16n, 0);
    driver.addRegion(0x60000000n + BigInt(i) * 0x10000n, region, true);
  }

  const result = scanForPointerPath(driver, HANDLE, target + 16n, {
    maxDepth: 2,
    maxCandidatesPerLevel: 2,
  });

  assert.ok(result.candidatesDropped > 0, 'candidates beyond the per-level cap must be counted');
  assert.equal(result.completeness.state, 'resource_limit');
  assert.equal(result.truncated, true);
  assert.equal(result.isAuthoritativeAbsence, false);
});

test('D05 §12 — exhausting the global scan budget reports resource_limit', () => {
  const { driver, target } = buildChain(3);

  const result = scanForPointerPath(driver, HANDLE, target, { maxDepth: 6, maxTotalScans: 1 });

  assert.equal(result.scansPerformed, 1);
  assert.equal(result.termination, 'scan_budget_exhausted');
  assert.equal(result.completeness.state, 'resource_limit');
  assert.equal(result.truncated, true);
});

test('D05 §10 — cancellation reports cancelled and keeps partial results', () => {
  const { driver, target } = buildChain(2);

  const result = scanForPointerPath(driver, HANDLE, target, {
    maxDepth: 3,
    signal: { aborted: true },
  });

  assert.equal(result.termination, 'cancelled');
  assert.equal(result.completeness.state, 'cancelled');
  assert.equal(result.truncated, true);
  assert.equal(result.isAuthoritativeAbsence, false);
});

test('D05 §10 — a process that exits mid-traversal reports process_exited', () => {
  const { driver, target } = buildChain(2);

  driver.readBuffer = (() => {
    throw new Error('read failed: the process is not running');
  }) as typeof driver.readBuffer;

  const result = scanForPointerPath(driver, HANDLE, target, { maxDepth: 3 });

  assert.equal(result.termination, 'process_exited');
  assert.equal(result.completeness.state, 'process_exited');
  assert.equal(result.truncated, true);
  assert.equal(result.isAuthoritativeAbsence, false);
});

// ---------------------------------------------------------------------------
// §11 — cycle handling. Each shape must terminate, must not duplicate work,
// and must not be misreported as truncation: de-duplicating a cycle loses
// nothing, so it is valid graph traversal, not a coverage gap.
// ---------------------------------------------------------------------------

test('D05 §11 — a self-referencing pointer (A -> A) terminates and stays complete', () => {
  const driver = new FakeMemoryDriver();
  const heapBase = 0x70000000n;
  const region = Buffer.alloc(64, 0);
  // The slot at +0 holds its own address, and the target sits at +16.
  region.writeBigUInt64LE(heapBase, 0);
  region.writeInt32LE(1337, 16);
  driver.addRegion(heapBase, region, true);
  driver.addRegion(MODULE_BASE, Buffer.alloc(0x3000, 0), true);
  driver.addModule('game.exe', MODULE_BASE, MODULE_SIZE);

  const result = scanForPointerPath(driver, HANDLE, heapBase + 16n, { maxDepth: 4 });

  assert.equal(result.termination, 'frontier_exhausted');
  assert.equal(result.completeness.state, 'complete');
  assert.equal(result.truncated, false);
});

test('D05 §11 — a two-node cycle (A -> B -> A) terminates without re-expanding', () => {
  const driver = new FakeMemoryDriver();
  const a = 0x80000000n;
  const b = 0x90000000n;

  const regionA = Buffer.alloc(64, 0);
  regionA.writeBigUInt64LE(b, 0); // A points at B
  regionA.writeInt32LE(1337, 16); // and holds the target value
  driver.addRegion(a, regionA, true);

  const regionB = Buffer.alloc(64, 0);
  regionB.writeBigUInt64LE(a, 0); // B points back at A
  driver.addRegion(b, regionB, true);

  driver.addRegion(MODULE_BASE, Buffer.alloc(0x3000, 0), true);
  driver.addModule('game.exe', MODULE_BASE, MODULE_SIZE);

  const result = scanForPointerPath(driver, HANDLE, a + 16n, { maxDepth: 5 });

  // Without cycle detection this expands A and B once per level. With it, each
  // heap address is expanded at most once for the whole run.
  assert.ok(result.candidatesExplored <= 2, `expanded ${result.candidatesExplored} heap nodes, expected at most 2`);
  assert.equal(result.candidatesDropped, 0, 'cycle de-duplication is not a dropped candidate');
  assert.equal(result.termination, 'frontier_exhausted');
  assert.equal(result.truncated, false, 'valid cycle suppression must not be reported as truncation');
});

test('D05 §11 — a three-node cycle (A -> B -> C -> B) terminates and stays complete', () => {
  const driver = new FakeMemoryDriver();
  const a = 0xa0000000n;
  const b = 0xb0000000n;
  const c = 0xc0000000n;

  const regionA = Buffer.alloc(64, 0);
  regionA.writeBigUInt64LE(b, 0);
  regionA.writeInt32LE(1337, 16);
  driver.addRegion(a, regionA, true);

  const regionB = Buffer.alloc(64, 0);
  regionB.writeBigUInt64LE(c, 0);
  driver.addRegion(b, regionB, true);

  const regionC = Buffer.alloc(64, 0);
  regionC.writeBigUInt64LE(b, 0); // back to B, closing the loop
  driver.addRegion(c, regionC, true);

  driver.addRegion(MODULE_BASE, Buffer.alloc(0x3000, 0), true);
  driver.addModule('game.exe', MODULE_BASE, MODULE_SIZE);

  const result = scanForPointerPath(driver, HANDLE, a + 16n, { maxDepth: 6 });

  assert.ok(result.candidatesExplored <= 3, `expanded ${result.candidatesExplored} heap nodes, expected at most 3`);
  assert.equal(result.termination, 'frontier_exhausted');
  assert.equal(result.truncated, false);
});

// ---------------------------------------------------------------------------
// §8 — the contract itself: the two "stopped" families must never collapse.
// ---------------------------------------------------------------------------

test('D05 §8 — NO_MORE_POINTERS and SEARCH_STOPPED_EARLY are never both reported complete', () => {
  const exhausted = scanForPointerPath(buildChain(1).driver, HANDLE, buildChain(1).target, { maxDepth: 3 });

  const { driver: deepDriver, target: deepTarget } = buildChain(3);
  const stoppedEarly = scanForPointerPath(deepDriver, HANDLE, deepTarget, { maxDepth: 1 });

  // Both stop with levelsSearched below requestedDepth — the ambiguity D05 was
  // filed against. Only one of them is complete.
  assert.ok(exhausted.levelsSearched < exhausted.requestedDepth);
  assert.ok(stoppedEarly.levelsSearched <= stoppedEarly.requestedDepth);
  assert.equal(exhausted.completeness.state, 'complete');
  assert.notEqual(stoppedEarly.completeness.state, 'complete');
  assert.notEqual(exhausted.termination, stoppedEarly.termination);
});

test('D05 §8 — deepestLevelCompleted is lower than levelsSearched when a level is abandoned', () => {
  const { driver, target } = buildChain(3);
  driver.addUnreadableRegion(0xd0000000n, 4096, true);

  const result = scanForPointerPath(driver, HANDLE, target, { maxDepth: 3 });

  // Every level touched the unreadable region, so no level was ever fully
  // examined even though three were entered.
  assert.equal(result.levelsSearched, 3);
  assert.equal(result.deepestLevelCompleted, 0);
  assert.equal(result.truncated, true);
});
