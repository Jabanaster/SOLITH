// Phase 2 P2-4 — LiveMemorySession's stability-validation service seam.
// Pure orchestration is covered in pointer-stability.test.ts /
// pointer-stability-orchestration.test.ts; this file covers the session
// wiring: attach-required guards, the serializable ground-truth spec, and
// end-to-end create-map -> scan -> validate against a fake attached process.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LiveMemorySession } from '../../src/core/live-memory/live-memory-session.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import type { RemoteConnectionEvidence } from '../../src/core/live-memory/types.js';
import { _clearActiveFreezesForTests } from '../../src/core/live-memory/freeze-concurrency-registry.js';
import type { StabilityGroundTruthSpec } from '../../src/core/live-memory/pointer-stability.js';

beforeEach(() => {
  _clearActiveFreezesForTests();
});

const CLEAN_EVIDENCE: RemoteConnectionEvidence = {
  availability: 'available',
  remoteConnectionCount: 0,
  observedAt: '2026-07-05T00:00:00.000Z',
};

const MODULE_BASE = 0x400000n;
const MODULE_SIZE = 0x100000;
const STATIC_SLOT = 0x2000;
const SENTINEL = 0x1337c0de;

function makeAttachedSession(driver: FakeMemoryDriver, pid = 1234) {
  driver.setProcessExecutableName(pid, 'demo.exe');
  const session = new LiveMemorySession(driver);
  session._injectRemoteConnectionObserver(async () => CLEAN_EVIDENCE);
  return session;
}

function plantChain(driver: FakeMemoryDriver, moduleBase: bigint, nodeAddress: bigint, value: number) {
  const moduleRegion = Buffer.alloc(0x3000, 0);
  moduleRegion.writeBigUInt64LE(nodeAddress, STATIC_SLOT);
  driver.addRegion(moduleBase, moduleRegion, true);
  driver.addModule('demo.exe', moduleBase, MODULE_SIZE);
  const nodeRegion = Buffer.alloc(64, 0);
  nodeRegion.writeUInt32LE(value, 16);
  driver.addRegion(nodeAddress, nodeRegion, true);
}

const GROUND_TRUTH_SPEC: StabilityGroundTruthSpec = {
  kind: 'u32',
  expected: SENTINEL,
  description: `sentinel 0x${SENTINEL.toString(16)}`,
};

describe('LiveMemorySession pointer stability', () => {
  test('validateNodeAfterRestart requires an active attach', async () => {
    const driver = new FakeMemoryDriver();
    const session = makeAttachedSession(driver);
    const map = session.pointerMapCreate('No Attach');
    const node = session.pointerMapAddNode(map.id, 'manual', {
      moduleName: 'demo.exe',
      moduleOffset: STATIC_SLOT,
      offsets: [16],
      depth: 1,
    });
    assert.throws(() => session.pointerMapValidateNodeAfterRestart(map.id, node.id, GROUND_TRUTH_SPEC), /No process attached/);
  });

  test('end-to-end: create map, scan a real target, validate after restart establishes a baseline', async () => {
    const driver = new FakeMemoryDriver();
    plantChain(driver, MODULE_BASE, 0x10000000n, SENTINEL);
    const session = makeAttachedSession(driver);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const map = session.pointerMapCreate('Stability E2E');
    const target = 0x10000000n + 16n;
    session.pointerMapScanTargets(map.id, [target], { maxDepth: 1 });
    const scanned = session.pointerMapGet(map.id)!;
    assert.ok(scanned.nodes.length > 0);
    const nodeId = scanned.nodes[0].id;

    const result = session.pointerMapValidateNodeAfterRestart(map.id, nodeId, GROUND_TRUTH_SPEC);
    assert.equal(result.observation.status, 'stable_exact');

    const stability = session.pointerMapGetNodeStability(map.id, nodeId);
    assert.equal(stability?.observations.length, 1);
    assert.notEqual(stability?.baseline, null);
  });

  test('validateAfterRestart (map-wide) records skipped nodes and does not throw on an empty ground-truth map', async () => {
    const driver = new FakeMemoryDriver();
    plantChain(driver, MODULE_BASE, 0x10000000n, SENTINEL);
    const session = makeAttachedSession(driver);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const map = session.pointerMapCreate('Map-wide');
    const target = 0x10000000n + 16n;
    session.pointerMapScanTargets(map.id, [target], { maxDepth: 1 });
    const scanned = session.pointerMapGet(map.id)!;
    const nodeId = scanned.nodes[0].id;

    const result = session.pointerMapValidateAfterRestart(map.id, { [nodeId]: GROUND_TRUTH_SPEC });
    assert.equal(result.observations.length, 1);
    assert.equal(result.skippedNodeIds.length, 0);

    const noGroundTruthResult = session.pointerMapValidateAfterRestart(map.id, {});
    assert.equal(noGroundTruthResult.observations.length, 0);
    assert.equal(noGroundTruthResult.skippedNodeIds.length, 1);
  });

});
