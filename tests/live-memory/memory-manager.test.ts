import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryAuditLog } from '../../src/core/live-memory/audit-log.js';
import { MemoryManager } from '../../src/core/live-memory/memory-manager.js';
import { LiveMemorySession, MAX_FREEZE_DURATION_MS } from '../../src/core/live-memory/live-memory-session.js';
import { researchProbeWritePolicyContext } from '../../src/core/live-memory/write-policy.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import type { LiveMemoryAddress } from '../../src/core/live-memory/types.js';
import { issueWriteConsent } from '../../src/core/consent/write-consent.js';

async function attachedManager(): Promise<{
  manager: MemoryManager;
  audit: MemoryAuditLog;
  address: LiveMemoryAddress;
  session: LiveMemorySession;
  driver: FakeMemoryDriver;
}> {
  const driver = new FakeMemoryDriver({ '4096': 10 });
  driver.setProcessExecutableName(1234, 'Demo.exe');
  driver.setProcessExecutablePath(1234, 'C:\\Games\\Demo\\Demo.exe');
  driver.setProcessStartTime(1234, '2026-07-01T00:00:00.000Z');
  const session = new LiveMemorySession(driver);
  session._injectRemoteConnectionObserver(async () => ({
    availability: 'available',
    remoteConnectionCount: 0,
    observedAt: new Date().toISOString(),
  }));
  const attach = await session.attach(
    { pid: 1234, executableName: 'Demo.exe', executablePath: 'C:\\Games\\Demo\\Demo.exe', startTime: '2026-07-01T00:00:00.000Z' },
    true,
  );
  assert.equal(attach.success, true);
  const audit = new MemoryAuditLog();
  const manager = new MemoryManager(session, audit);
  const address: LiveMemoryAddress = {
    address: 0x1000n,
    dataType: 'int32',
    moduleName: 'Demo.exe',
  };
  return { manager, audit, address, session, driver };
}

/** Builds a valid consent binding matching an attached session's current identity, for freeze tests. */
function freezeBindingFor(
  session: LiveMemorySession,
  proposal: { proposalId: string; target: LiveMemoryAddress; value: number; intervalMs: number },
) {
  const identity = session.getAttachedIdentity()!;
  return {
    operation: 'live_memory_freeze_start' as const,
    sessionKey: 'test-session',
    proposalId: proposal.proposalId,
    attachedPid: identity.pid,
    attachedExecutableName: identity.executableName,
    executablePath: identity.executablePath,
    processStartTime: identity.startTime,
    volumeSerialNumber: identity.volumeSerialNumber,
    fileIndex: identity.fileIndex,
    attachedExeSha256: identity.exeSha256,
    address: proposal.target.address.toString(),
    dataType: proposal.target.dataType,
    freezeValue: proposal.value,
    freezeIntervalMs: proposal.intervalMs,
    freezeMaxDurationMs: MAX_FREEZE_DURATION_MS,
    windowId: 1,
  };
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

  test('safeWrite without userApproved is denied by fail-closed defaults', async () => {
    const { manager, address } = await attachedManager();
    const result = await manager.safeWrite(address, 55, { reason: 'no_approval' });
    assert.equal(result.success, false);
    assert.equal(result.policyCode, 'NO_APPROVAL');
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
      userApproved: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.verified, true);
    assert.equal(result.readbackValue, 99);
    assert.ok(audit.recent().some((e) => e.op === 'write' && e.featureId === 'demo-health'));
    assert.ok(audit.recent().some((e) => e.reason?.includes('readback_ok')));
    assert.equal(
      audit.recent().find((e) => e.reason?.includes('confirmed'))?.waiverAssumed,
      true,
    );
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

      const proposal = manager.proposeWrite(address, 42, {
        reason: 'ipc_propose',
        userApproved: true,
      });
      const confirm = await manager.confirmWrite(proposal.proposalId, {
        reason: 'ipc_confirm',
        userApproved: true,
      });
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
    const proposal = manager.proposeWrite(address, 7, { featureId: 'demo', userApproved: true });
    const confirm = await manager.confirmWrite(proposal.proposalId, {
      featureId: 'demo',
      userApproved: true,
    });
    assert.equal(confirm.success, true);
    assert.equal(hits, 1);

    manager.setSnapshotListener(null);
    const proposal2 = manager.proposeWrite(address, 8, { userApproved: true });
    await manager.confirmWrite(proposal2.proposalId, { userApproved: true });
    assert.equal(hits, 1);
  });

  test('snapshot listener failure is audited and returned without lying', async () => {
    const { manager, audit, address } = await attachedManager();
    manager.setSnapshotListener(() => {
      throw new Error('backup_copy_failed');
    });
    const result = await manager.safeWrite(address, 33, {
      reason: 'snap_fail',
      userApproved: true,
    });
    assert.equal(result.success, true);
    assert.equal(result.snapshotError, 'backup_copy_failed');
    assert.ok(
      audit.recent().some((e) => e.op === 'abort' && e.reason?.includes('snapshot_listener_failed')),
    );
  });

  test('default trainer policy does not require researchWriteMode', async () => {
    const { manager, address } = await attachedManager();
    const result = await manager.safeWrite(address, 55, {
      reason: 'trainer_default',
      userApproved: true,
    });
    assert.equal(result.success, true);
    assert.equal(result.verified, true);
  });

  test('safeWrite denies research_probe when Research Write Mode is off', async () => {
    const { manager, audit, address } = await attachedManager();
    manager.setWritePolicyContext(
      researchProbeWritePolicyContext({
        singlePlayerWaiverAccepted: true,
        userApproved: true,
      }),
    );
    const result = await manager.safeWrite(address, 99, {
      reason: 'research_probe',
      userApproved: true,
    });
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
        singlePlayerWaiverAccepted: true,
        userApproved: true,
      }),
    );

    assert.throws(
      () => manager.proposeWrite(address, 11, { reason: 'no_backup', userApproved: true }),
      /write_policy_denied:NO_BACKUP/,
    );

    manager.setWritePolicyContext(null);
    const proposal = manager.proposeWrite(address, 12, {
      reason: 'pre_confirm',
      userApproved: true,
    });
    manager.setWritePolicyContext(
      researchProbeWritePolicyContext({
        researchWriteModeEnabled: false,
        singlePlayerWaiverAccepted: true,
        userApproved: true,
      }),
    );
    const confirm = await manager.confirmWrite(proposal.proposalId, {
      reason: 'blocked',
      userApproved: true,
    });
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
        singlePlayerWaiverAccepted: true,
        userApproved: true,
      }),
    );
    const result = await manager.safeWrite(address, 77, {
      reason: 'probe_ok',
      userApproved: true,
    });
    assert.equal(result.success, true);
    assert.equal(result.verified, true);
  });

  test('MemoryManager.rollback accepts only a proposalId and restores the confirmed write', async () => {
    const { manager, audit, address } = await attachedManager();
    const result = await manager.safeWrite(address, 55, { reason: 'setup', userApproved: true });
    assert.equal(result.success, true);
    const proposalId = result.confirm!.manifest!.proposalId;

    const rollback = await manager.rollback(proposalId);

    assert.equal(rollback.success, true);
    assert.equal(rollback.manifest?.valueBefore, 10, 'the confirmed write manifest recorded the original pre-write value');
    const rollbackEntry = audit.recent(1)[0];
    assert.equal(rollbackEntry.op, 'rollback');
    assert.equal(rollbackEntry.reason, 'rollback_ok');
  });

  test('MemoryManager.rollback rejects an unconfirmed/forged proposalId without writing memory or crashing', async () => {
    const { manager, audit } = await attachedManager();

    const rollback = await manager.rollback('never-confirmed-proposal-id');

    assert.equal(rollback.success, false);
    assert.match(rollback.error ?? '', /unknown, expired, or already rolled back/i);
    const rollbackEntry = audit.recent(1)[0];
    assert.equal(rollbackEntry.op, 'rollback');
    assert.equal(rollbackEntry.address, undefined, 'no address should be logged when the proposal was never confirmed');
  });

  test('MemoryManager.rollback cannot replay the same proposalId twice', async () => {
    const { manager, address } = await attachedManager();
    const result = await manager.safeWrite(address, 55, { reason: 'setup', userApproved: true });
    const proposalId = result.confirm!.manifest!.proposalId;

    const first = await manager.rollback(proposalId);
    const second = await manager.rollback(proposalId);

    assert.equal(first.success, true);
    assert.equal(second.success, false);
    assert.match(second.error ?? '', /unknown, expired, or already rolled back/i);
  });
});

describe('Batch B1.1 — freeze propose/issue-consent/confirm', () => {
  test('proposeFreeze stages a request without touching memory', async () => {
    const { session, address, driver } = await attachedManager();
    const proposal = session.proposeFreeze(address, 9999, 100);

    assert.ok(proposal.proposalId);
    assert.equal(proposal.value, 9999);
    assert.equal(proposal.intervalMs, 100);
    assert.equal(driver.getValue(0x1000n), 10, 'propose must not write to memory');
  });

  test('MemoryManager.freezeStart requires BOTH a valid consentToken and a matching binding — a generic approved:true is not accepted', async () => {
    const { manager, session, address } = await attachedManager();
    const proposal = session.proposeFreeze(address, 9999, 100);

    // @ts-expect-error — deliberately calling with no consentToken/consentBinding at all,
    // proving there is no boolean/legacy bypass path for freeze the way confirmWrite has.
    const result = await manager.freezeStart(proposal.proposalId, {});

    assert.equal(result.success, false);
  });

  test('freezeStart succeeds end-to-end with a properly issued, matching consent token', async () => {
    const { manager, session, address, driver } = await attachedManager();
    const proposal = session.proposeFreeze(address, 9999, 100);
    const binding = freezeBindingFor(session, proposal);
    const consent = issueWriteConsent(binding);

    const result = await manager.freezeStart(proposal.proposalId, {
      consentToken: consent.tokenId,
      consentBinding: binding,
    });

    assert.equal(result.success, true);
    assert.equal(session.getFreezeStatus().active, true);
    session.stopFreeze();
  });

  test('freezeStart rejects consent denial (token never issued because the dialog was denied)', async () => {
    const { manager, session, address } = await attachedManager();
    const proposal = session.proposeFreeze(address, 9999, 100);
    const binding = freezeBindingFor(session, proposal);

    // Simulates a denied native dialog: no token was ever issued for this proposal.
    const result = await manager.freezeStart(proposal.proposalId, {
      consentToken: 'never-issued-00000000-0000-4000-8000-000000000000',
      consentBinding: binding,
    });

    assert.equal(result.success, false);
    assert.equal(session.getFreezeStatus().active, false);
  });

  test('freezeStart rejects an expired consent token', async () => {
    const { manager, session, address } = await attachedManager();
    const proposal = session.proposeFreeze(address, 9999, 100);
    const binding = freezeBindingFor(session, proposal);
    const consent = issueWriteConsent(binding, { ttlMs: 10, nowMs: 1_000_000 });

    const result = await manager.freezeStart(proposal.proposalId, {
      consentToken: consent.tokenId,
      consentBinding: binding,
    }, );
    // consumeWriteConsent defaults to real Date.now() for expiry comparison when nowMs is
    // omitted, and the token above was issued far in the simulated past (nowMs: 1_000_000
    // epoch ms — 1970), so any real "now" is already past its 10ms TTL.
    assert.equal(result.success, false);
  });

  test('freezeStart rejects a replayed (already-consumed) consent token', async () => {
    const { manager, session, address } = await attachedManager();
    const proposal = session.proposeFreeze(address, 9999, 100);
    const binding = freezeBindingFor(session, proposal);
    const consent = issueWriteConsent(binding);

    const first = await manager.freezeStart(proposal.proposalId, {
      consentToken: consent.tokenId,
      consentBinding: binding,
    });
    assert.equal(first.success, true);
    session.stopFreeze();

    // Re-propose (the first proposal was consumed) but reuse the OLD token — must fail.
    const proposal2 = session.proposeFreeze(address, 4242, 100);
    const result = await manager.freezeStart(proposal2.proposalId, {
      consentToken: consent.tokenId,
      consentBinding: freezeBindingFor(session, proposal2),
    });

    assert.equal(result.success, false, 'a consumed token must not be usable for a second proposal');
  });

  test('freezeStart rejects a token whose binding no longer matches (address changed since issuance)', async () => {
    const { manager, session, address } = await attachedManager();
    const proposal = session.proposeFreeze(address, 9999, 100);
    const binding = freezeBindingFor(session, proposal);
    const consent = issueWriteConsent(binding);

    const tamperedBinding = { ...binding, address: '0x9999' };
    const result = await manager.freezeStart(proposal.proposalId, {
      consentToken: consent.tokenId,
      consentBinding: tamperedBinding,
    });

    assert.equal(result.success, false, 'a mismatched address in the re-derived binding must invalidate the token');
  });

  test('freezeStart rejects a token bound to a different value than what confirm would apply', async () => {
    const { manager, session, address } = await attachedManager();
    const proposal = session.proposeFreeze(address, 9999, 100);
    const binding = freezeBindingFor(session, proposal);
    const consent = issueWriteConsent(binding);

    const tamperedBinding = { ...binding, freezeValue: 1 };
    const result = await manager.freezeStart(proposal.proposalId, {
      consentToken: consent.tokenId,
      consentBinding: tamperedBinding,
    });

    assert.equal(result.success, false);
  });

  test('freezeStart rejects a token bound to a different interval than what confirm would apply', async () => {
    const { manager, session, address } = await attachedManager();
    const proposal = session.proposeFreeze(address, 9999, 100);
    const binding = freezeBindingFor(session, proposal);
    const consent = issueWriteConsent(binding);

    const tamperedBinding = { ...binding, freezeIntervalMs: 5000 };
    const result = await manager.freezeStart(proposal.proposalId, {
      consentToken: consent.tokenId,
      consentBinding: tamperedBinding,
    });

    assert.equal(result.success, false);
  });

  test('freezeStart rejects a token bound to a different PID (process identity mismatch)', async () => {
    const { manager, session, address } = await attachedManager();
    const proposal = session.proposeFreeze(address, 9999, 100);
    const binding = freezeBindingFor(session, proposal);
    const consent = issueWriteConsent(binding);

    const tamperedBinding = { ...binding, attachedPid: 9999 };
    const result = await manager.freezeStart(proposal.proposalId, {
      consentToken: consent.tokenId,
      consentBinding: tamperedBinding,
    });

    assert.equal(result.success, false);
  });

  test('confirm structurally cannot start a freeze with different parameters than approved — confirm takes only proposalId, never fresh address/value/interval', async () => {
    const { manager, session, address, driver } = await attachedManager();
    const proposal = session.proposeFreeze(address, 9999, 100);
    const binding = freezeBindingFor(session, proposal);
    const consent = issueWriteConsent(binding);

    const result = await manager.freezeStart(proposal.proposalId, {
      consentToken: consent.tokenId,
      consentBinding: binding,
    });

    assert.equal(result.success, true);
    // The freeze that started uses exactly the proposed value (9999), not anything else —
    // there is no code path through which a caller could have substituted a different value,
    // since freezeStart's public signature accepts only (proposalId, {consentToken, consentBinding}).
    assert.equal(session.getFreezeStatus().target?.value, 9999);
    assert.equal(driver.getValue(0x1000n), 9999);
    session.stopFreeze();
  });

  test('attachment replacement (detach) invalidates a pending freeze proposal — confirm fails after re-attach', async () => {
    const { session, address } = await attachedManager();
    const proposal = session.proposeFreeze(address, 9999, 100);
    const binding = freezeBindingFor(session, proposal);
    const consent = issueWriteConsent(binding);

    session.detach();
    await session.attach({ pid: 1234, executableName: 'Demo.exe' }, true);

    const result = session.startFreezeConfirmed(proposal.proposalId);
    assert.equal(result.success, false, 'proposal must not survive a detach/re-attach cycle');
    void consent; // token was never consumed since the proposal itself is gone
  });

  test('concurrent confirmation attempts for the same proposal: only one can succeed (single-use)', async () => {
    const { manager, session, address } = await attachedManager();
    const proposal = session.proposeFreeze(address, 9999, 100);
    const binding = freezeBindingFor(session, proposal);
    const consent = issueWriteConsent(binding);

    const [first, second] = await Promise.all([
      manager.freezeStart(proposal.proposalId, { consentToken: consent.tokenId, consentBinding: binding }),
      manager.freezeStart(proposal.proposalId, { consentToken: consent.tokenId, consentBinding: binding }),
    ]);

    const successes = [first.success, second.success].filter(Boolean).length;
    assert.equal(successes, 1, 'exactly one of two concurrent confirmations must succeed, never both');
    if (session.getFreezeStatus().active) session.stopFreeze();
  });
});
