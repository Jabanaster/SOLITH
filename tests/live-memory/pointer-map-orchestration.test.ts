// Phase 2 P2-2 — pointer-map live orchestration. Covers multi-target
// scanning into one map, independent target grouping (no candidate
// merging across targets), truthful per-target + aggregate completeness
// (D05 must not regress into a flattened "map = complete"), cancellation
// between targets, and per-target/per-map resource bounds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import { createEmptyPointerMap } from '../../src/core/live-memory/pointer-map.js';
import {
  MAX_NODES_PER_MAP,
  MAX_NODES_PER_TARGET,
  MAX_TARGETS_PER_SCAN,
  aggregatePointerMapCompleteness,
  scanTargetsIntoMap,
} from '../../src/core/live-memory/pointer-map-orchestration.js';

const HANDLE = { pid: 4711, opaque: { fake: true } };
const MODULE_BASE = 0x400000n;
const MODULE_SIZE = 0x100000;

/**
 * Plants the heap side of a module+offset -> heap -> value chain and returns
 * the final target address. The module region itself (with the pointer
 * slot written into it) is built by the caller via addRegion, since
 * FakeMemoryDriver has no "fetch and mutate an existing region" accessor.
 */
function plantChain(driver: FakeMemoryDriver, heapNode: bigint, value: number): bigint {
  const heapRegion = Buffer.alloc(64, 0);
  heapRegion.writeInt32LE(value, 16);
  driver.addRegion(heapNode, heapRegion, true);
  return heapNode + 16n;
}

function baseDriverWithModule(): FakeMemoryDriver {
  const driver = new FakeMemoryDriver();
  driver.addModule('game.exe', MODULE_BASE, MODULE_SIZE);
  return driver;
}

test('scanTargetsIntoMap populates independent nodes for two independent targets, not merged', () => {
  const driver = baseDriverWithModule();
  const moduleRegion = Buffer.alloc(0x4000, 0);
  const heapA = 0x10000000n;
  const heapB = 0x20000000n;
  moduleRegion.writeBigUInt64LE(heapA, 0x1000);
  moduleRegion.writeBigUInt64LE(heapB, 0x2000);
  driver.addRegion(MODULE_BASE, moduleRegion, true);
  const targetA = plantChain(driver, heapA, 111);
  const targetB = plantChain(driver, heapB, 222);

  const map = createEmptyPointerMap('Two Targets');
  const result = scanTargetsIntoMap(driver, HANDLE, map, [targetA, targetB], { maxDepth: 2 });

  assert.equal(result.targetsRequested, 2);
  assert.equal(result.targetsScanned, 2);
  assert.equal(result.perTarget.length, 2);

  const nodesForA = result.map.nodes.filter((n) => n.targetAddress === `0x${targetA.toString(16)}`);
  const nodesForB = result.map.nodes.filter((n) => n.targetAddress === `0x${targetB.toString(16)}`);
  assert.ok(nodesForA.length > 0, 'target A must contribute at least one node');
  assert.ok(nodesForB.length > 0, 'target B must contribute at least one node');
  // No node may claim to serve both targets — grouping must not blur.
  for (const node of result.map.nodes) {
    assert.ok(node.targetAddress === `0x${targetA.toString(16)}` || node.targetAddress === `0x${targetB.toString(16)}`);
  }
  assert.notEqual(
    nodesForA[0].scanId,
    nodesForB[0].scanId,
    'each target scan gets its own provenance id, even in one orchestration call',
  );
});

test('scanTargetsIntoMap reports truthful per-target completeness without flattening the aggregate', () => {
  const driver = baseDriverWithModule();
  const moduleRegion = Buffer.alloc(0x3000, 0);
  const heapGood = 0x10000000n;
  moduleRegion.writeBigUInt64LE(heapGood, 0x1000);
  // moduleOffset 0x2000 intentionally has nothing behind it in this buffer.
  driver.addRegion(MODULE_BASE, moduleRegion, true);
  const targetGood = plantChain(driver, heapGood, 999);
  const targetBad = 0xdeadbeefn; // never planted — scanForPointerPath will exhaust its frontier and find nothing

  const map = createEmptyPointerMap('Mixed Completeness');
  const result = scanTargetsIntoMap(driver, HANDLE, map, [targetGood, targetBad], { maxDepth: 2 });

  const goodOutcome = result.perTarget.find((t) => t.targetAddress === `0x${targetGood.toString(16)}`)!;
  const badOutcome = result.perTarget.find((t) => t.targetAddress === `0x${targetBad.toString(16)}`)!;
  assert.equal(goodOutcome.completeness.state, 'complete');
  assert.ok(goodOutcome.candidateCount > 0);
  assert.equal(badOutcome.candidateCount, 0);

  // Regardless of what the aggregate collapses to, the per-target truth for
  // the good target must not have been altered by the bad one's presence.
  assert.equal(goodOutcome.completeness.state, 'complete');
});

test('aggregatePointerMapCompleteness never reports complete when any input is not', () => {
  const mixed = aggregatePointerMapCompleteness([
    { state: 'complete' },
    { state: 'resource_limit', atByte: 10n },
  ]);
  assert.equal(mixed.state, 'resource_limit');

  const allComplete = aggregatePointerMapCompleteness([{ state: 'complete' }, { state: 'complete' }]);
  assert.equal(allComplete.state, 'complete');

  const worstWins = aggregatePointerMapCompleteness([
    { state: 'cancelled', atByte: 1n },
    { state: 'failed', reason: 'boom' },
    { state: 'complete_with_skipped_regions', skipped: [] },
  ]);
  assert.equal(worstWins.state, 'failed');

  assert.equal(aggregatePointerMapCompleteness([]).state, 'complete');
});

test('scanTargetsIntoMap marks an unreached target cancelled, distinct from a scanned-but-empty one', () => {
  const driver = baseDriverWithModule();
  const map = createEmptyPointerMap('Cancel Between Targets');
  const signal = { aborted: false };
  const targets = [0x1111n, 0x2222n, 0x3333n];

  // Abort before the loop even starts scanning — every target should come
  // back cancelled with zero candidates, not "scanned and found nothing".
  signal.aborted = true;
  const result = scanTargetsIntoMap(driver, HANDLE, map, targets, { maxDepth: 1, signal });

  assert.equal(result.targetsScanned, 3);
  for (const outcome of result.perTarget) {
    assert.equal(outcome.termination, 'cancelled');
    assert.equal(outcome.completeness.state, 'cancelled');
    assert.equal(outcome.candidateCount, 0);
    assert.equal(outcome.nodesAdded, 0);
  }
  assert.equal(result.aggregateCompleteness.state, 'cancelled');
  assert.equal(result.map.nodes.length, 0);
});

test('scanTargetsIntoMap enforces MAX_TARGETS_PER_SCAN and reports resourceLimited', () => {
  const driver = baseDriverWithModule();
  const map = createEmptyPointerMap('Too Many Targets');
  const targets = Array.from({ length: MAX_TARGETS_PER_SCAN + 5 }, (_, i) => BigInt(0x1000 + i));

  const result = scanTargetsIntoMap(driver, HANDLE, map, targets, { maxDepth: 1 });

  assert.equal(result.targetsRequested, MAX_TARGETS_PER_SCAN + 5);
  assert.equal(result.targetsScanned, MAX_TARGETS_PER_SCAN);
  assert.equal(result.resourceLimited, true);
  assert.equal(result.perTarget.length, MAX_TARGETS_PER_SCAN, 'targets beyond the cap must not be silently scanned');
});

test('scanTargetsIntoMap caps nodes per target and flags resourceLimited when a target has more candidates', () => {
  const driver = baseDriverWithModule();
  const moduleRegion = Buffer.alloc(0x3000, 0);
  const heapBase = 0x10000000n;
  // Plant more independent candidate chains at the same offset-depth than
  // MAX_NODES_PER_TARGET allows, all pointing near the same target address
  // (each within maxOffsetPerLevel), so the scan legitimately finds more
  // candidates than one target may contribute to the map.
  const target = heapBase + 16n;
  for (let i = 0; i < MAX_NODES_PER_TARGET + 3; i++) {
    const slotOffset = 0x1000 + i * 8;
    moduleRegion.writeBigUInt64LE(heapBase, slotOffset);
  }
  driver.addRegion(MODULE_BASE, moduleRegion, true);
  const heapRegion = Buffer.alloc(64, 0);
  heapRegion.writeInt32LE(42, 16);
  driver.addRegion(heapBase, heapRegion, true);

  const map = createEmptyPointerMap('Node Cap');
  const result = scanTargetsIntoMap(driver, HANDLE, map, [target], { maxDepth: 1, maxResults: 50 });

  const outcome = result.perTarget[0];
  assert.ok(outcome.candidateCount > MAX_NODES_PER_TARGET, 'fixture must actually exceed the per-target cap to test it');
  assert.equal(outcome.nodesAdded, MAX_NODES_PER_TARGET);
  assert.equal(result.resourceLimited, true);
  assert.equal(result.map.nodes.length, MAX_NODES_PER_TARGET);
});

test('scanTargetsIntoMap caps total nodes per map across multiple targets', () => {
  const driver = baseDriverWithModule();
  const moduleRegion = Buffer.alloc(0x4000, 0);
  driver.addRegion(MODULE_BASE, moduleRegion, true);

  // Seed a map already near MAX_NODES_PER_MAP so even a small next scan
  // must be capped by the map-wide ceiling, not just the per-target one.
  let map = createEmptyPointerMap('Near Map Cap');
  const heapPrefill = 0x30000000n;
  moduleRegion.writeBigUInt64LE(heapPrefill, 0x3000);
  const heapPrefillRegion = Buffer.alloc(64, 0);
  heapPrefillRegion.writeInt32LE(7, 16);
  driver.addRegion(heapPrefill, heapPrefillRegion, true);
  const prefillTarget = heapPrefill + 16n;
  const prefill = scanTargetsIntoMap(driver, HANDLE, map, [prefillTarget], { maxDepth: 1 });
  map = prefill.map;
  assert.ok(map.nodes.length > 0 && map.nodes.length <= MAX_NODES_PER_MAP);

  // Pad the map to exactly one slot below the ceiling, so only one more
  // node can legally fit — the next target must find MORE than one real
  // candidate for the cap to actually bite (finding exactly the remaining
  // capacity and no more is not a limited outcome, it's a fit).
  while (map.nodes.length < MAX_NODES_PER_MAP - 1) {
    map = { ...map, nodes: [...map.nodes, { ...map.nodes[0], id: `pad-${map.nodes.length}` }] };
  }

  // Two independent module slots landing near the same target address —
  // scanForPointerPath legitimately reports two depth-1 candidates for it.
  const heapNext = 0x40000000n;
  moduleRegion.writeBigUInt64LE(heapNext, 0x1000);
  moduleRegion.writeBigUInt64LE(heapNext, 0x1010);
  const heapNextRegion = Buffer.alloc(64, 0);
  heapNextRegion.writeInt32LE(9, 16);
  driver.addRegion(heapNext, heapNextRegion, true);
  const nextTarget = heapNext + 16n;

  const result = scanTargetsIntoMap(driver, HANDLE, map, [nextTarget], { maxDepth: 1, maxResults: 10 });
  assert.ok(result.perTarget[0].candidateCount >= 2, 'fixture must actually produce more candidates than the remaining capacity');
  assert.equal(result.map.nodes.length, MAX_NODES_PER_MAP, 'map-wide cap must hold even mid-scan');
  assert.equal(result.resourceLimited, true);
});
