import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryAuditLog } from '../../src/core/live-memory/audit-log.js';
import { MemoryManager } from '../../src/core/live-memory/memory-manager.js';
import { LiveMemorySession } from '../../src/core/live-memory/live-memory-session.js';
import {
  WritePolicyGate,
  defaultTrainerWritePolicyContext,
} from '../../src/core/live-memory/write-policy.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import type { LiveMemoryAddress } from '../../src/core/live-memory/types.js';

describe('Phase 10 WritePolicyGate', () => {
  test('denies when research mode off for research_probe', () => {
    const gate = new WritePolicyGate();
    const decision = gate.evaluate({
      writeClass: 'research_probe',
      isOffline: true,
      hasBackupSnapshot: true,
      userApproved: true,
      researchWriteModeEnabled: false,
    });
    assert.equal(decision.allow, false);
    if (!decision.allow) assert.equal(decision.code, 'RESEARCH_MODE_OFF');
  });

  test('denies research_probe without snapshot backup', () => {
    const gate = new WritePolicyGate();
    const decision = gate.evaluate({
      writeClass: 'research_probe',
      isOffline: true,
      hasBackupSnapshot: false,
      userApproved: true,
      researchWriteModeEnabled: true,
    });
    assert.equal(decision.allow, false);
    if (!decision.allow) assert.equal(decision.code, 'NO_BACKUP');
  });

  test('allows trainer path with default context', () => {
    const gate = new WritePolicyGate();
    const decision = gate.evaluate(defaultTrainerWritePolicyContext());
    assert.equal(decision.allow, true);
  });

  test('denies online / no approval / read-only', () => {
    const gate = new WritePolicyGate();
    assert.equal(
      gate.evaluate(defaultTrainerWritePolicyContext({ isOffline: false })).allow,
      false,
    );
    assert.equal(
      gate.evaluate(defaultTrainerWritePolicyContext({ userApproved: false })).allow,
      false,
    );
    assert.equal(
      gate.evaluate(defaultTrainerWritePolicyContext({ readOnlyMode: true })).allow,
      false,
    );
  });

  test('MemoryManager blocks safeWrite when policy denies', async () => {
    const driver = new FakeMemoryDriver({ '4096': 10 });
    driver.setProcessExecutableName(1234, 'Demo.exe');
    const session = new LiveMemorySession(driver);
    session._injectRemoteConnectionObserver(async () => ({
      availability: 'available',
      remoteConnectionCount: 0,
      observedAt: new Date().toISOString(),
    }));
    await session.attach({ pid: 1234, executableName: 'Demo.exe' }, true);

    const audit = new MemoryAuditLog();
    const manager = new MemoryManager(session, audit);
    manager.setWritePolicyContext({
      writeClass: 'research_probe',
      isOffline: true,
      hasBackupSnapshot: false,
      userApproved: true,
      researchWriteModeEnabled: true,
    });

    const address: LiveMemoryAddress = { address: 0x1000n, dataType: 'int32' };
    const result = await manager.safeWrite(address, 99, { reason: 'probe' });
    assert.equal(result.success, false);
    assert.equal(result.policyCode, 'NO_BACKUP');
    assert.ok(audit.recent().some((e) => e.op === 'abort' && e.reason?.includes('NO_BACKUP')));
  });
});
