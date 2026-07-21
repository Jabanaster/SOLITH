import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryAuditLog } from '../../src/core/live-memory/audit-log.js';
import { MemoryManager } from '../../src/core/live-memory/memory-manager.js';
import { LiveMemorySession } from '../../src/core/live-memory/live-memory-session.js';
import { researchProbeWritePolicyContext } from '../../src/core/live-memory/write-policy.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import type { LiveMemoryAddress } from '../../src/core/live-memory/types.js';

async function attachedManager(): Promise<{
  manager: MemoryManager;
  audit: MemoryAuditLog;
  address: LiveMemoryAddress;
}> {
  const driver = new FakeMemoryDriver({ '4096': 10 });
  driver.setProcessExecutableName(1234, 'Demo.exe');
  const session = new LiveMemorySession(driver);
  session._injectRemoteConnectionObserver(async () => ({
    availability: 'available',
    remoteConnectionCount: 0,
    observedAt: new Date().toISOString(),
  }));
  const attach = await session.attach({ pid: 1234, executableName: 'Demo.exe' }, true);
  assert.equal(attach.success, true);
  const audit = new MemoryAuditLog();
  const manager = new MemoryManager(session, audit);
  const address: LiveMemoryAddress = {
    address: 0x1000n,
    dataType: 'int32',
    moduleName: 'Demo.exe',
  };
  return { manager, audit, address };
}

describe('memory-manager + audit-log', () => {
  test('audit log keeps recent entries in ring buffer', () => {
    const log = new MemoryAuditLog({ maxEntries: 3 });
    log.append({ op: 'read', reason: 'a' });
    log.append({ op: 'write', reason: 'b' });
    log.append({ op: 'write', reason: 'c' });
    log.append({ op: 'rollback', reason: 'd' });
    assert.equal(log.size, 3);
    assert.deepEqual(
      log.recent(3).map((e) => e.reason),
      ['b', 'c', 'd'],
    );
  });

  test('safeWrite proposes, confirms, verifies, and audits', async () => {
    const driver = new FakeMemoryDriver({ '4096': 10 });
    driver.setProcessExecutableName(1234, 'Demo.exe');
    const session = new LiveMemorySession(driver);
    session._injectRemoteConnectionObserver(async () => ({
      availability: 'available',
      remoteConnectionCount: 0,
      observedAt: new Date().toISOString(),
    }));

    const attach = await session.attach({ pid: 1234, executableName: 'Demo.exe' }, true);
    assert.equal(attach.success, true);

    const audit = new MemoryAuditLog();
    const manager = new MemoryManager(session, audit);
    const address: LiveMemoryAddress = {
      address: 0x1000n,
      dataType: 'int32',
      moduleName: 'Demo.exe',
    };

    const result = await manager.safeWrite(address, 99, {
      featureId: 'demo-health',
      reason: 'test_write',
      verifyReadback: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.verified, true);
    assert.equal(result.readbackValue, 99);
    assert.ok(audit.recent().some((e) => e.op === 'write' && e.featureId === 'demo-health'));
    assert.ok(audit.recent().some((e) => e.reason?.includes('readback_ok')));
  });

  test('proposeWrite + confirmWrite append audit lines to jsonl file', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-audit-'));
    const filePath = path.join(tmpDir, 'memory-audit.jsonl');
    try {
      const driver = new FakeMemoryDriver({ '4096': 10 });
      driver.setProcessExecutableName(1234, 'Demo.exe');
      const session = new LiveMemorySession(driver);
      session._injectRemoteConnectionObserver(async () => ({
        availability: 'available',
        remoteConnectionCount: 0,
        observedAt: new Date().toISOString(),
      }));
      await session.attach({ pid: 1234, executableName: 'Demo.exe' }, true);

      const audit = new MemoryAuditLog({ filePath });
      const manager = new MemoryManager(session, audit);
      const address: LiveMemoryAddress = { address: 0x1000n, dataType: 'int32' };

      const proposal = manager.proposeWrite(address, 42, { reason: 'ipc_propose' });
      const confirm = await manager.confirmWrite(proposal.proposalId, { reason: 'ipc_confirm' });
      assert.equal(confirm.success, true);

      const body = fs.readFileSync(filePath, 'utf8');
      assert.match(body, /ipc_propose:proposed/);
      assert.match(body, /ipc_confirm:confirmed/);
      assert.doesNotMatch(body, /https?:\/\//);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('snapshot listener fires after successful confirmWrite', async () => {
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
    let hits = 0;
    manager.setSnapshotListener(() => {
      hits += 1;
    });

    const address: LiveMemoryAddress = { address: 0x1000n, dataType: 'int32' };
    const proposal = manager.proposeWrite(address, 7, { featureId: 'demo' });
    const confirm = await manager.confirmWrite(proposal.proposalId, { featureId: 'demo' });
    assert.equal(confirm.success, true);
    assert.equal(hits, 1);

    manager.setSnapshotListener(null);
    const proposal2 = manager.proposeWrite(address, 8);
    await manager.confirmWrite(proposal2.proposalId);
    assert.equal(hits, 1);
  });

  test('default trainer policy does not require researchWriteMode', async () => {
    const { manager, address } = await attachedManager();
    // researchWriteMode stays false in trainer defaults — writes must still succeed.
    const result = await manager.safeWrite(address, 55, { reason: 'trainer_default' });
    assert.equal(result.success, true);
    assert.equal(result.verified, true);
  });

  test('safeWrite denies research_probe when Research Write Mode is off', async () => {
    const { manager, audit, address } = await attachedManager();
    manager.setWritePolicyContext(researchProbeWritePolicyContext());
    const result = await manager.safeWrite(address, 99, { reason: 'research_probe' });
    assert.equal(result.success, false);
    assert.equal(result.policyCode, 'RESEARCH_MODE_OFF');
    assert.match(result.error ?? '', /write_policy_denied:RESEARCH_MODE_OFF/);
    assert.ok(
      audit.recent().some((e) => e.op === 'abort' && e.reason?.includes('RESEARCH_MODE_OFF')),
    );
  });

  test('proposeWrite throws and confirmWrite fails when policy denies', async () => {
    const { manager, audit, address } = await attachedManager();
    manager.setWritePolicyContext(
      researchProbeWritePolicyContext({
        researchWriteModeEnabled: true,
        hasBackupSnapshot: false,
      }),
    );

    assert.throws(
      () => manager.proposeWrite(address, 11, { reason: 'no_backup' }),
      /write_policy_denied:NO_BACKUP/,
    );

    // Restore trainer defaults so a proposal can be created, then deny on confirm.
    manager.setWritePolicyContext(null);
    const proposal = manager.proposeWrite(address, 12, { reason: 'pre_confirm' });
    manager.setWritePolicyContext(
      researchProbeWritePolicyContext({
        researchWriteModeEnabled: false,
      }),
    );
    const confirm = await manager.confirmWrite(proposal.proposalId, { reason: 'blocked' });
    assert.equal(confirm.success, false);
    assert.match(confirm.error ?? '', /write_policy_denied:RESEARCH_MODE_OFF/);
    assert.ok(
      audit.recent().some((e) => e.op === 'abort' && e.reason?.includes('write_policy')),
    );
  });

  test('research_probe safeWrite succeeds when mode + backup pass', async () => {
    const { manager, address } = await attachedManager();
    manager.setWritePolicyContext(
      researchProbeWritePolicyContext({
        researchWriteModeEnabled: true,
        hasBackupSnapshot: true,
      }),
    );
    const result = await manager.safeWrite(address, 77, { reason: 'probe_ok' });
    assert.equal(result.success, true);
    assert.equal(result.verified, true);
  });
});
