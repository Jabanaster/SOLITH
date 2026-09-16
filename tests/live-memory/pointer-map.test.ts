// Phase 2 — pointer-map data model (P2-1: multi-level pointer feature
// foundation). Covers node creation from a scan candidate, immutable
// add/remove, real resolution against a FakeMemoryDriver (resolved,
// module_missing, read_failed), and the chain-step flattening a future
// visualization stage consumes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import {
  addPointerMapNode,
  createEmptyPointerMap,
  pointerMapNodeChainSteps,
  pointerMapNodeFromCandidate,
  removePointerMapNode,
  resolvePointerMap,
} from '../../src/core/live-memory/pointer-map.js';
import type { PointerPathCandidate } from '../../src/core/live-memory/pointer-scanner.js';

const HANDLE = { pid: 4711, opaque: { fake: true } };
const MODULE_BASE = 0x400000n;
const MODULE_SIZE = 0x100000;

// A depth-1 chain: the module slot holds a pointer directly to the value's
// container, so a single resolvePointerPath dereference (readPointer at
// module+moduleOffset, then +16) lands on the target. Deeper chains are
// pointer-scanner-depth-truth.test.ts's territory; this file only needs one
// realistic path per case to exercise the map, not the resolver semantics.
function candidate(overrides: Partial<PointerPathCandidate> = {}): PointerPathCandidate {
  return { moduleName: 'game.exe', moduleOffset: 0x2000, offsets: [16], depth: 1, ...overrides };
}

test('pointerMapNodeFromCandidate carries the path and depth through unresolved', () => {
  const node = pointerMapNodeFromCandidate('Gold', candidate());
  assert.equal(node.label, 'Gold');
  assert.equal(node.status, 'unresolved');
  assert.equal(node.lastResolvedAddress, null);
  assert.deepEqual(node.path, { moduleName: 'game.exe', moduleOffset: 0x2000, offsets: [16] });
  assert.equal(node.depth, 1);
});

test('addPointerMapNode and removePointerMapNode never mutate the input map', () => {
  const empty = createEmptyPointerMap();
  const node = pointerMapNodeFromCandidate('Gold', candidate());
  const withNode = addPointerMapNode(empty, node);

  assert.equal(empty.nodes.length, 0, 'original map must not be mutated');
  assert.equal(withNode.nodes.length, 1);

  const removed = removePointerMapNode(withNode, node.id);
  assert.equal(withNode.nodes.length, 1, 'map passed to remove must not be mutated');
  assert.equal(removed.nodes.length, 0);
});

test('resolvePointerMap resolves a real chain through a live driver', () => {
  const driver = new FakeMemoryDriver();
  const moduleRegion = Buffer.alloc(0x3000, 0);
  const heapNode = 0x10000000n;
  moduleRegion.writeBigUInt64LE(heapNode, 0x2000);
  driver.addRegion(MODULE_BASE, moduleRegion, true);
  driver.addModule('game.exe', MODULE_BASE, MODULE_SIZE);

  const heapRegion = Buffer.alloc(64, 0);
  heapRegion.writeInt32LE(1337, 16);
  driver.addRegion(heapNode, heapRegion, true);

  const map = addPointerMapNode(createEmptyPointerMap(), pointerMapNodeFromCandidate('Gold', candidate()));
  const result = resolvePointerMap(driver, HANDLE, map);

  assert.equal(result.resolvedCount, 1);
  assert.equal(result.failedCount, 0);
  assert.equal(result.map.nodes[0].status, 'resolved');
  assert.equal(result.map.nodes[0].lastResolvedAddress, `0x${(heapNode + 16n).toString(16)}`);
  assert.notEqual(result.map.nodes[0].lastResolvedAt, null);
});

test('resolvePointerMap reports module_missing when the module is not loaded', () => {
  const driver = new FakeMemoryDriver();
  driver.addModule('other.exe', MODULE_BASE, MODULE_SIZE);

  const map = addPointerMapNode(createEmptyPointerMap(), pointerMapNodeFromCandidate('Gold', candidate()));
  const result = resolvePointerMap(driver, HANDLE, map);

  assert.equal(result.resolvedCount, 0);
  assert.equal(result.failedCount, 1);
  assert.equal(result.map.nodes[0].status, 'module_missing');
  assert.equal(result.map.nodes[0].lastResolvedAddress, null);
});

test('resolvePointerMap reports read_failed when a dereference lands on unmapped memory', () => {
  const driver = new FakeMemoryDriver();
  const moduleRegion = Buffer.alloc(0x3000, 0);
  driver.addRegion(MODULE_BASE, moduleRegion, true);
  driver.addModule('game.exe', MODULE_BASE, MODULE_SIZE);

  // moduleOffset 0x9000 falls inside the module's address range but outside
  // the only region actually backed by memory (0x3000 bytes), so the very
  // first readPointer call has nothing to read — a real "found the module,
  // the slot itself doesn't resolve" failure, not a missing-module one.
  const map = addPointerMapNode(
    createEmptyPointerMap(),
    pointerMapNodeFromCandidate('Gold', candidate({ moduleOffset: 0x9000 })),
  );
  const result = resolvePointerMap(driver, HANDLE, map);

  assert.equal(result.resolvedCount, 0);
  assert.equal(result.failedCount, 1);
  assert.equal(result.map.nodes[0].status, 'read_failed');
});

test('resolvePointerMap resolves independent nodes independently in one map', () => {
  const driver = new FakeMemoryDriver();
  const moduleRegion = Buffer.alloc(0x3000, 0);
  const heapNode = 0x10000000n;
  moduleRegion.writeBigUInt64LE(heapNode, 0x2000);
  driver.addRegion(MODULE_BASE, moduleRegion, true);
  driver.addModule('game.exe', MODULE_BASE, MODULE_SIZE);
  const heapRegion = Buffer.alloc(64, 0);
  heapRegion.writeInt32LE(1337, 16);
  driver.addRegion(heapNode, heapRegion, true);

  let map = createEmptyPointerMap();
  map = addPointerMapNode(map, pointerMapNodeFromCandidate('Gold', candidate()));
  map = addPointerMapNode(map, pointerMapNodeFromCandidate('Broken', candidate({ moduleName: 'missing.exe' })));

  const result = resolvePointerMap(driver, HANDLE, map);
  assert.equal(result.resolvedCount, 1);
  assert.equal(result.failedCount, 1);
  assert.equal(result.map.nodes.find((n) => n.label === 'Gold')?.status, 'resolved');
  assert.equal(result.map.nodes.find((n) => n.label === 'Broken')?.status, 'module_missing');
});

test('pointerMapNodeChainSteps flattens root and offsets without touching a driver', () => {
  const node = pointerMapNodeFromCandidate('Gold', candidate({ offsets: [0, -16, 32] }));
  const steps = pointerMapNodeChainSteps(node);

  assert.equal(steps.length, 4);
  assert.deepEqual(steps[0], { label: 'game.exe+0x2000', isRoot: true });
  assert.deepEqual(steps[1], { label: '+0x0', isRoot: false });
  assert.deepEqual(steps[2], { label: '-0x10', isRoot: false });
  assert.deepEqual(steps[3], { label: '+0x20', isRoot: false });
});

test('pointerMapNodeChainSteps handles a zero-offset (direct module pointer) path', () => {
  const node = pointerMapNodeFromCandidate('Direct', candidate({ offsets: [] }));
  const steps = pointerMapNodeChainSteps(node);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].isRoot, true);
});
