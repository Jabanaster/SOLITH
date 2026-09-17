// Phase 2 P2-4 — pointer-map-level stability orchestration.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import { createEmptyPointerMap, addPointerMapNode, pointerMapNodeFromCandidate } from '../../src/core/live-memory/pointer-map.js';
import {
  validateNodeAfterRestart,
  validateMapAfterRestart,
  getNodeStabilitySummary,
} from '../../src/core/live-memory/pointer-stability-orchestration.js';
import type { StabilityGroundTruth } from '../../src/core/live-memory/pointer-stability.js';

const HANDLE = { pid: 4711, opaque: { fake: true } };
const MODULE_BASE = 0x400000n;
const MODULE_SIZE = 0x100000;
const SLOT = 0x2000;
const SENTINEL = 0x1337c0de;

function buildDriver(moduleBase = MODULE_BASE, nodeAddress = 0x10000000n, value = SENTINEL) {
  const driver = new FakeMemoryDriver();
  const moduleRegion = Buffer.alloc(0x3000, 0);
  moduleRegion.writeBigUInt64LE(nodeAddress, SLOT);
  driver.addRegion(moduleBase, moduleRegion, true);
  driver.addModule('game.exe', moduleBase, MODULE_SIZE);
  const nodeRegion = Buffer.alloc(64, 0);
  nodeRegion.writeUInt32LE(value, 16);
  driver.addRegion(nodeAddress, nodeRegion, true);
  return driver;
}

const GROUND_TRUTH: StabilityGroundTruth = {
  readSize: 4,
  verify: (b) => b.readUInt32LE(0) === SENTINEL,
  description: `sentinel 0x${SENTINEL.toString(16)}`,
};

function makeMapWithOneNode() {
  const map0 = createEmptyPointerMap('Stability Test Map');
  const node = pointerMapNodeFromCandidate('candidate 1', {
    moduleName: 'game.exe',
    moduleOffset: SLOT,
    offsets: [16],
    depth: 1,
  });
  const map = addPointerMapNode(map0, node);
  return { map, nodeId: node.id };
}

describe('P2-4 map-level stability orchestration', () => {
  test('first validation establishes a baseline; second identical-launch validation reuses it as stable_exact', () => {
    const { map, nodeId } = makeMapWithOneNode();
    const driver = buildDriver();

    const first = validateNodeAfterRestart(driver, HANDLE, map, nodeId, GROUND_TRUTH, 100);
    const node1 = first.map.nodes.find((n) => n.id === nodeId)!;
    assert.equal(node1.stability?.observations.length, 1);
    assert.notEqual(node1.stability?.baseline, null);

    const second = validateNodeAfterRestart(driver, HANDLE, first.map, nodeId, GROUND_TRUTH, 100);
    const node2 = second.map.nodes.find((n) => n.id === nodeId)!;
    assert.equal(node2.stability?.observations.length, 2);
    assert.equal(second.observation.status, 'stable_exact');
    // Baseline must not be overwritten by a later observation.
    assert.deepEqual(node2.stability?.baseline, node1.stability?.baseline);
  });

  test('restart with a relocated module base classifies stable_relocated and keeps the ORIGINAL baseline', () => {
    const { map, nodeId } = makeMapWithOneNode();
    const driver1 = buildDriver();
    const afterLaunch1 = validateNodeAfterRestart(driver1, HANDLE, map, nodeId, GROUND_TRUTH, 100);

    const relocatedBase = 0x55550000n;
    const driver2 = buildDriver(relocatedBase);
    const afterLaunch2 = validateNodeAfterRestart(driver2, HANDLE, afterLaunch1.map, nodeId, GROUND_TRUTH, 200);

    assert.equal(afterLaunch2.observation.status, 'stable_relocated');
    const node = afterLaunch2.map.nodes.find((n) => n.id === nodeId)!;
    assert.equal(node.stability?.baseline?.moduleBase, `0x${MODULE_BASE.toString(16)}`); // unchanged
    assert.equal(node.stability?.observations.length, 2);
  });

  test('a chain that breaks after a prior success is recorded truthfully, does not retroactively rewrite the earlier success', () => {
    const { map, nodeId } = makeMapWithOneNode();
    const driver1 = buildDriver();
    const afterLaunch1 = validateNodeAfterRestart(driver1, HANDLE, map, nodeId, GROUND_TRUTH, 100);
    assert.equal(afterLaunch1.observation.status, 'stable_exact');

    const brokenDriver = new FakeMemoryDriver(); // no module registered at all
    const afterLaunch2 = validateNodeAfterRestart(brokenDriver, HANDLE, afterLaunch1.map, nodeId, GROUND_TRUTH, 300);

    assert.equal(afterLaunch2.observation.status, 'module_missing');
    const node = afterLaunch2.map.nodes.find((n) => n.id === nodeId)!;
    assert.equal(node.stability?.observations[0]?.status, 'stable_exact'); // history preserved, not rewritten
    assert.equal(node.stability?.observations[1]?.status, 'module_missing');

    const summary = getNodeStabilitySummary(node);
    assert.equal(summary.attempts, 2);
    assert.equal(summary.correct, 1);
    assert.equal(summary.broken, 1);
  });

  test('validateMapAfterRestart validates every node with a ground truth and records skipped ones truthfully', () => {
    const map0 = createEmptyPointerMap('Multi-node Map');
    const nodeA = pointerMapNodeFromCandidate('a', { moduleName: 'game.exe', moduleOffset: SLOT, offsets: [16], depth: 1 });
    const nodeB = pointerMapNodeFromCandidate('b', { moduleName: 'game.exe', moduleOffset: SLOT, offsets: [16], depth: 1 });
    let map = addPointerMapNode(map0, nodeA);
    map = addPointerMapNode(map, nodeB);
    const driver = buildDriver();

    const result = validateMapAfterRestart(
      driver,
      HANDLE,
      map,
      (node) => (node.id === nodeA.id ? GROUND_TRUTH : null), // only nodeA has known ground truth
      100,
    );

    assert.equal(result.observations.length, 1);
    assert.deepEqual(result.skippedNodeIds, [nodeB.id]);
    const resultNodeA = result.map.nodes.find((n) => n.id === nodeA.id)!;
    const resultNodeB = result.map.nodes.find((n) => n.id === nodeB.id)!;
    assert.equal(resultNodeA.stability?.observations.length, 1);
    assert.equal(resultNodeB.stability?.observations.length ?? 0, 0);
  });

  test('a false-positive resolution never establishes a baseline (readable != correct)', () => {
    const { map, nodeId } = makeMapWithOneNode();
    const wrongValueDriver = buildDriver(MODULE_BASE, 0x10000000n, 0xdeadbeef); // wrong sentinel

    const result = validateNodeAfterRestart(wrongValueDriver, HANDLE, map, nodeId, GROUND_TRUTH, 100);
    assert.equal(result.observation.status, 'false_positive');
    const node = result.map.nodes.find((n) => n.id === nodeId)!;
    assert.equal(node.stability?.baseline, null);
  });
});
