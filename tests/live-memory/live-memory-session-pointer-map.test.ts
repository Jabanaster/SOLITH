// Phase 2 P2-2 — LiveMemorySession's pointer-map production service seam.
// The pure orchestration (scanTargetsIntoMap, resolvePointerMap) is covered
// in pointer-map-orchestration.test.ts / pointer-map.test.ts; this file
// covers the session wiring itself: registry lifecycle, attach-required
// guards, and process-lifecycle behavior (exit mid-scan, reload-then-attach).
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LiveMemorySession } from '../../src/core/live-memory/live-memory-session.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import type { RemoteConnectionEvidence } from '../../src/core/live-memory/types.js';
import { _clearActiveFreezesForTests } from '../../src/core/live-memory/freeze-concurrency-registry.js';
import { resetForTesting } from '../../src/core/database/index.js';

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

function makeAttachedSession(driver: FakeMemoryDriver, pid = 1234) {
  driver.setProcessExecutableName(pid, 'demo.exe');
  const session = new LiveMemorySession(driver);
  session._injectRemoteConnectionObserver(async () => CLEAN_EVIDENCE);
  return session;
}

/** Plants module+moduleOffset -> heap -> value(+16), returns the final target address. */
function plantChain(driver: FakeMemoryDriver, moduleRegion: Buffer, moduleOffset: number, heapNode: bigint, value: number): bigint {
  moduleRegion.writeBigUInt64LE(heapNode, moduleOffset);
  const heapRegion = Buffer.alloc(64, 0);
  heapRegion.writeInt32LE(value, 16);
  driver.addRegion(heapNode, heapRegion, true);
  return heapNode + 16n;
}

describe('LiveMemorySession pointer maps', () => {
  test('create/list/get/rename/delete manage the live registry without a live process', () => {
    const driver = new FakeMemoryDriver();
    const session = makeAttachedSession(driver);

    const map = session.pointerMapCreate('Loot Table');
    assert.equal(session.pointerMapList().length, 1);
    assert.equal(session.pointerMapGet(map.id)?.name, 'Loot Table');

    const renamed = session.pointerMapRename(map.id, 'Loot Table v2');
    assert.equal(renamed.name, 'Loot Table v2');
    assert.equal(session.pointerMapGet(map.id)?.name, 'Loot Table v2');

    assert.equal(session.pointerMapDelete(map.id), true);
    assert.equal(session.pointerMapGet(map.id), null);
    assert.equal(session.pointerMapList().length, 0);
  });

  test('pointerMapScanTargets throws without an attached process, and does not create a partial map', () => {
    const driver = new FakeMemoryDriver();
    const session = makeAttachedSession(driver);
    const map = session.pointerMapCreate('Unattached');

    assert.throws(() => session.pointerMapScanTargets(map.id, [0x1234n]), /No process attached/);
    assert.equal(session.pointerMapGet(map.id)?.nodes.length, 0);
  });

  test('pointerMapScanTargets populates a map from a real attached process', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeAttachedSession(driver);
    const attachResult = await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);
    assert.equal(attachResult.success, true);

    driver.addModule('demo.exe', MODULE_BASE, MODULE_SIZE);
    const moduleRegion = Buffer.alloc(0x3000, 0);
    const target = plantChain(driver, moduleRegion, 0x1000, 0x10000000n, 555);
    driver.addRegion(MODULE_BASE, moduleRegion, true);

    const map = session.pointerMapCreate('Attached Scan');
    const result = session.pointerMapScanTargets(map.id, [target], { maxDepth: 1 });

    assert.equal(result.targetsScanned, 1);
    assert.ok(result.perTarget[0].candidateCount > 0);
    assert.equal(session.pointerMapGet(map.id)?.nodes.length, result.perTarget[0].nodesAdded);
  });

  test('pointerMapResolve/Refresh re-resolve against the currently attached process', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeAttachedSession(driver);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    driver.addModule('demo.exe', MODULE_BASE, MODULE_SIZE);
    const moduleRegion = Buffer.alloc(0x3000, 0);
    const target = plantChain(driver, moduleRegion, 0x1000, 0x10000000n, 777);
    driver.addRegion(MODULE_BASE, moduleRegion, true);

    const map = session.pointerMapCreate('Resolve Test');
    session.pointerMapScanTargets(map.id, [target], { maxDepth: 1 });

    const resolved = session.pointerMapResolve(map.id);
    assert.equal(resolved.resolvedCount, resolved.map.nodes.length);
    assert.ok(resolved.map.nodes.every((n) => n.status === 'resolved'));

    const refreshed = session.pointerMapRefresh(map.id);
    assert.equal(refreshed.resolvedCount, resolved.resolvedCount);
  });

  test('process exit between scan and resolve is reported truthfully, not silently rebound', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeAttachedSession(driver);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    driver.addModule('demo.exe', MODULE_BASE, MODULE_SIZE);
    const moduleRegion = Buffer.alloc(0x3000, 0);
    const target = plantChain(driver, moduleRegion, 0x1000, 0x10000000n, 42);
    driver.addRegion(MODULE_BASE, moduleRegion, true);

    const map = session.pointerMapCreate('Exit Mid-Lifecycle');
    session.pointerMapScanTargets(map.id, [target], { maxDepth: 1 });

    // Simulate the process exiting: module enumeration now fails, exactly
    // the real dead-but-open-handle behavior Phase 1 established.
    driver.getModules = (() => {
      throw new Error('the process is not running');
    }) as typeof driver.getModules;

    const resolved = session.pointerMapResolve(map.id);
    assert.equal(resolved.resolvedCount, 0);
    assert.ok(resolved.map.nodes.every((n) => n.status === 'process_exited'));
  });

  test('save, load into a fresh session, and confirm the reloaded map is inactive until resolved', async () => {
    await resetForTesting();
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeAttachedSession(driver);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    driver.addModule('demo.exe', MODULE_BASE, MODULE_SIZE);
    const moduleRegion = Buffer.alloc(0x3000, 0);
    const target = plantChain(driver, moduleRegion, 0x1000, 0x10000000n, 9001);
    driver.addRegion(MODULE_BASE, moduleRegion, true);

    const map = session.pointerMapCreate('Persisted');
    session.pointerMapScanTargets(map.id, [target], { maxDepth: 1 });
    session.pointerMapResolve(map.id);
    const beforeSave = session.pointerMapGet(map.id)!;
    assert.ok(beforeSave.nodes.some((n) => n.status === 'resolved'));

    const saveResult = session.pointerMapSave(map.id, { executableIdentity: 'demo.exe' });
    assert.deepEqual(saveResult, { ok: true });

    // A brand new session (e.g. after an app restart) loading the same
    // saved map must not inherit the old resolved addresses as live truth.
    const freshDriver = new FakeMemoryDriver();
    const freshSession = makeAttachedSession(freshDriver, 5678);
    const loaded = freshSession.pointerMapLoad(map.id);
    assert.equal(loaded.name, 'Persisted');
    assert.ok(loaded.nodes.every((n) => n.status === 'unresolved' && n.lastResolvedAddress === null));

    await resetForTesting();
  });

  test('pointerMapListSaved / pointerMapDeleteSaved manage the persisted store independent of any session registry', async () => {
    await resetForTesting();
    const driver = new FakeMemoryDriver();
    const session = makeAttachedSession(driver);
    const map = session.pointerMapCreate('Saved List Test');
    session.pointerMapSave(map.id);

    const saved = session.pointerMapListSaved();
    assert.ok(saved.some((m) => m.mapId === map.id));

    session.pointerMapDeleteSaved(map.id);
    assert.equal(session.pointerMapListSaved().some((m) => m.mapId === map.id), false);
    assert.equal(session.pointerMapGet(map.id), null, 'deleting the saved copy also clears the live registry entry');

    await resetForTesting();
  });
});
