import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveMemorySession } from '../src/core/live-memory/live-memory-session.js';
import { MemoryManager } from '../src/core/live-memory/memory-manager.js';
import { MemoryAuditLog } from '../src/core/live-memory/audit-log.js';
import { FakeMemoryDriver } from './fixtures/fake-memory-driver.js';
import { LiveMemoryCapabilities } from '../src/core/trainer-runtime/capabilities.js';
import { TrainerRuntime } from '../src/core/trainer-runtime/runtime.js';
import { CompositeTransactionRuntime, type CompositeTransactionPlan } from '../src/core/trainer-runtime/transaction.js';
import type { SolithDefinitionV1 } from '../src/core/definitions/schema.v1.js';

/**
 * Proves CompositeTransactionRuntime genuinely composes P4-5's canonical
 * TrainerRuntime over the real production LiveMemorySession/MemoryManager —
 * same pattern as trainer-runtime-integration.test.ts. Only the OS process
 * itself is faked (FakeMemoryDriver); every write, rollback, and freeze call
 * below runs through real code.
 */
test('CompositeTransactionRuntime: atomic two-write transaction over a real LiveMemorySession/MemoryManager', async () => {
  const pid = 8888;
  const driver = new FakeMemoryDriver();
  driver.setProcessExecutableName(pid, 'Demo.exe');
  driver.setProcessExecutablePath(pid, 'C:\\Games\\Demo\\Demo.exe');
  driver.setProcessStartTime(pid, '2026-01-01T00:00:00.000Z');
  driver.addModule('Demo.exe', 0x400000n, 0x100000);
  driver.setValue(0x400010n, 100);
  driver.setValue(0x400020n, 5);

  const session = new LiveMemorySession(driver);
  session._injectRemoteConnectionObserver(async () => ({
    availability: 'available',
    remoteConnectionCount: 0,
    observedAt: new Date().toISOString(),
  }));
  const audit = new MemoryAuditLog();
  const manager = new MemoryManager(session, audit);
  const capabilities = new LiveMemoryCapabilities(session, manager);
  const runtime = new TrainerRuntime(capabilities);
  const tx = new CompositeTransactionRuntime(runtime, capabilities);

  const definition: SolithDefinitionV1 = {
    schemaVersion: 1,
    id: 'demo-game',
    title: 'Demo',
    gameVersion: '*',
    executableHashPrefixes: [],
    author: 'test',
    safety: { requiresApproval: true, requiresOfflineConfirm: true, verificationStatus: 'community' },
    target: { executables: ['Demo.exe'], arch: 'x64' },
    memoryFeatures: [
      {
        id: 'gold',
        name: 'Gold',
        category: 'Currency',
        type: 'toggle',
        dataType: 'int32',
        defaultValue: 9999,
        resolution: { moduleName: 'Demo.exe', baseOffset: '0x10' },
      },
      {
        id: 'ammo',
        name: 'Ammo',
        category: 'Combat',
        type: 'write_once',
        dataType: 'int32',
        defaultValue: 999,
        resolution: { moduleName: 'Demo.exe', baseOffset: '0x20' },
      },
    ],
  };

  assert.equal(runtime.load(definition).success, true);
  assert.equal(runtime.validate().success, true);
  const pidTarget = { pid, executableName: 'Demo.exe', executablePath: 'C:\\Games\\Demo\\Demo.exe' };
  assert.equal(runtime.checkCompatibility(pidTarget).success, true);
  const bind = await runtime.bind({ ...pidTarget, startTime: '2026-01-01T00:00:00.000Z' }, true);
  assert.equal(bind.success, true);

  const plan: CompositeTransactionPlan = {
    id: 'real-tx-1',
    mode: 'ATOMIC',
    actions: [
      { kind: 'write', featureId: 'gold', requestedValue: 42424, approval: { kind: 'approved' } },
      { kind: 'write', featureId: 'ammo', requestedValue: 777, approval: { kind: 'approved' } },
    ],
  };

  const prep = await tx.prepareTransaction(plan);
  assert.equal(prep.success, true);
  const exec = await tx.executeTransaction('real-tx-1');
  assert.equal(exec.success, true);
  if (!exec.success) return;
  assert.equal(exec.value.state, 'COMMITTED');
  // Writes landed through the REAL driver, not a fake capability.
  assert.equal(driver.getValue(0x400010n), 42424);
  assert.equal(driver.getValue(0x400020n), 777);

  runtime.dispose();
  assert.equal(session.isAttached(), false);
});

test('CompositeTransactionRuntime: atomic rollback over a real LiveMemorySession/MemoryManager when Action 2 fails', async () => {
  const pid = 8889;
  const driver = new FakeMemoryDriver();
  driver.setProcessExecutableName(pid, 'Demo.exe');
  driver.setProcessExecutablePath(pid, 'C:\\Games\\Demo\\Demo.exe');
  driver.setProcessStartTime(pid, '2026-01-01T00:00:00.000Z');
  driver.addModule('Demo.exe', 0x400000n, 0x100000);
  driver.setValue(0x400010n, 100);

  const session = new LiveMemorySession(driver);
  session._injectRemoteConnectionObserver(async () => ({
    availability: 'available',
    remoteConnectionCount: 0,
    observedAt: new Date().toISOString(),
  }));
  const audit = new MemoryAuditLog();
  const manager = new MemoryManager(session, audit);
  const capabilities = new LiveMemoryCapabilities(session, manager);
  const runtime = new TrainerRuntime(capabilities);
  const tx = new CompositeTransactionRuntime(runtime, capabilities);

  const definition: SolithDefinitionV1 = {
    schemaVersion: 1,
    id: 'demo-game',
    title: 'Demo',
    gameVersion: '*',
    executableHashPrefixes: [],
    author: 'test',
    safety: { requiresApproval: true, requiresOfflineConfirm: true, verificationStatus: 'community' },
    target: { executables: ['Demo.exe'], arch: 'x64' },
    memoryFeatures: [
      {
        id: 'gold',
        name: 'Gold',
        category: 'Currency',
        type: 'toggle',
        dataType: 'int32',
        defaultValue: 9999,
        resolution: { moduleName: 'Demo.exe', baseOffset: '0x10' },
      },
      {
        id: 'missing-target',
        name: 'Missing Target',
        category: 'Combat',
        type: 'write_once',
        dataType: 'int32',
        defaultValue: 0,
        // Points outside the fake module's bounds so resolution/write fails for real.
        resolution: { moduleName: 'Demo.exe', baseOffset: '0xFFFFFF' },
      },
    ],
  };

  assert.equal(runtime.load(definition).success, true);
  assert.equal(runtime.validate().success, true);
  const pidTarget = { pid, executableName: 'Demo.exe', executablePath: 'C:\\Games\\Demo\\Demo.exe' };
  assert.equal(runtime.checkCompatibility(pidTarget).success, true);
  const bind = await runtime.bind({ ...pidTarget, startTime: '2026-01-01T00:00:00.000Z' }, true);
  assert.equal(bind.success, true);

  const plan: CompositeTransactionPlan = {
    id: 'real-tx-2',
    mode: 'ATOMIC',
    actions: [
      { kind: 'write', featureId: 'gold', requestedValue: 55555, approval: { kind: 'approved' } },
      { kind: 'write', featureId: 'missing-target', requestedValue: 1, approval: { kind: 'approved' } },
    ],
  };

  // Address resolution only computes moduleBase + offset — it does not
  // validate the target lies within a seeded value, so pre-flight succeeds
  // here. The real driver only rejects the address once MemoryManager
  // actually tries to read/write it, which happens during execution — this
  // proves rollback of Action 1 (gold) composes the REAL
  // MemoryManager.rollback() over the real driver, not a fake shortcut.
  const prep = await tx.prepareTransaction(plan);
  assert.equal(prep.success, true);

  const exec = await tx.executeTransaction('real-tx-2');
  assert.equal(exec.success, false);
  const state = tx.getTransactionState('real-tx-2')!;
  assert.equal(state.state, 'ROLLED_BACK');
  assert.equal(state.actionRecords[0].result, 'rolled_back');
  assert.equal(state.actionRecords[1].result, 'failed');
  // Gold was written then rolled back for real: value ends where it started.
  assert.equal(driver.getValue(0x400010n), 100);

  runtime.dispose();
});
