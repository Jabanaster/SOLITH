import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveMemorySession } from '../src/core/live-memory/live-memory-session.js';
import { MemoryManager } from '../src/core/live-memory/memory-manager.js';
import { MemoryAuditLog } from '../src/core/live-memory/audit-log.js';
import { FakeMemoryDriver } from './fixtures/fake-memory-driver.js';
import { LiveMemoryCapabilities } from '../src/core/trainer-runtime/capabilities.js';
import { TrainerRuntime } from '../src/core/trainer-runtime/runtime.js';
import type { SolithDefinitionV1 } from '../src/core/definitions/schema.v1.js';

/**
 * Proves TrainerRuntime + LiveMemoryCapabilities genuinely compose the real
 * production LiveMemorySession/MemoryManager rather than a parallel
 * implementation — everything below the capability boundary is real code,
 * only the OS process itself is faked (FakeMemoryDriver), same as the
 * existing live-memory test suite.
 */
test('TrainerRuntime end-to-end over a real LiveMemorySession/MemoryManager', async () => {
  const pid = 9999;
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
    ],
  };

  assert.equal(runtime.load(definition).success, true);
  assert.equal(runtime.validate().success, true);
  assert.equal(
    runtime.checkCompatibility({ pid, executableName: 'Demo.exe', executablePath: 'C:\\Games\\Demo\\Demo.exe' }).success,
    true,
  );

  const bind = await runtime.bind(
    { pid, executableName: 'Demo.exe', executablePath: 'C:\\Games\\Demo\\Demo.exe', startTime: '2026-01-01T00:00:00.000Z' },
    true,
  );
  assert.equal(bind.success, true);
  assert.equal(runtime.getState(), 'READY');
  assert.equal(capabilities.isAttached(), true);

  const activate = await runtime.activateWriteFeature('gold', 42424, { kind: 'approved' });
  assert.equal(activate.success, true);
  assert.equal(runtime.getState(), 'ACTIVE');
  // The write landed through the REAL driver, not a fake capability.
  assert.equal(driver.getValue(0x400010n), 42424);

  const proposalId = runtime.getFeatureState('gold')!.activation.proposalId!;
  const rollback = await runtime.rollbackFeature('gold', proposalId);
  assert.equal(rollback.success, true);
  assert.equal(driver.getValue(0x400010n), 100);

  runtime.dispose();
  assert.equal(runtime.getState(), 'DISPOSED');
  assert.equal(session.isAttached(), false);
  assert.equal(driver.closeCallCount, 1);
});
