/**
 * Permanent regression tests: fail-closed ok guards in MemoryManager.
 *
 * Candidate 1B fix — verifies that `gate.ok !== true` and `consumed.ok !== true`
 * are the active guards in proposeWrite, confirmWrite, and freezeStart.
 *
 * These tests must never be removed. They are the production regression anchor for
 * the memory-manager fail-closed requirement.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryAuditLog } from '../../src/core/live-memory/audit-log.js';
import { MemoryManager } from '../../src/core/live-memory/memory-manager.js';
import { LiveMemorySession, MAX_FREEZE_DURATION_MS } from '../../src/core/live-memory/live-memory-session.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import type { LiveMemoryAddress } from '../../src/core/live-memory/types.js';
import {
  clearWriteConsentStore,
  issueWriteConsent,
} from '../../src/core/consent/write-consent.js';

async function attachedManager(): Promise<{
  manager: MemoryManager;
  audit: MemoryAuditLog;
  address: LiveMemoryAddress;
  session: LiveMemorySession;
  driver: FakeMemoryDriver;
}> {
  const driver = new FakeMemoryDriver({ '4096': 42 });
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

function writeConsentBinding(session: LiveMemorySession, proposalId: string, address: LiveMemoryAddress) {
  const identity = session.getAttachedIdentity()!;
  return {
    operation: 'live_memory_confirm_write' as const,
    sessionKey: 'test-session',
    proposalId,
    attachedPid: identity.pid,
    attachedExecutableName: identity.executableName,
    executablePath: identity.executablePath,
    processStartTime: identity.startTime,
    volumeSerialNumber: identity.volumeSerialNumber,
    fileIndex: identity.fileIndex,
    attachedExeSha256: identity.exeSha256,
    address: address.address.toString(),
    dataType: address.dataType,
    currentValue: 42,
    requestedValue: 99,
    windowId: 1,
  };
}

function freezeConsentBinding(
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

describe('MemoryManager — fail-closed ok guards (Candidate 1B)', () => {
  // ── Memory snapshot (safeWrite) ───────────────────────────────────────────

  // Requirement: valid snapshot success behaves unchanged
  test('valid consent success — confirmWrite succeeds and is audited', async () => {
    const { manager, audit, address, session } = await attachedManager();
    clearWriteConsentStore();
    const proposal = manager.proposeWrite(address, 99, { userApproved: true, reason: 'fc-test' });
    const binding = writeConsentBinding(session, proposal.proposalId, address);
    const artifact = issueWriteConsent(binding);

    const result = await manager.confirmWrite(proposal.proposalId, {
      reason: 'fc-test',
      consentToken: artifact.tokenId,
      consentBinding: binding,
    });

    assert.equal(result.success, true, 'valid consent must confirm successfully');
    assert.ok(
      audit.recent().some((e) => e.op === 'write' && e.reason?.includes('confirmed')),
      'successful write must be audited',
    );
    clearWriteConsentStore();
  });

  // Requirement: { ok: false } from consent is treated as snapshot failure
  test('{ ok: false } consent (unknown token) — confirmWrite returns consent_denied error', async () => {
    const { manager, audit, address, session } = await attachedManager();
    clearWriteConsentStore();
    const proposal = manager.proposeWrite(address, 99, { userApproved: true, reason: 'fc-deny' });
    const binding = writeConsentBinding(session, proposal.proposalId, address);

    const result = await manager.confirmWrite(proposal.proposalId, {
      reason: 'fc-deny',
      consentToken: '00000000-0000-4000-8000-000000000000',
      consentBinding: binding,
    });

    assert.equal(result.success, false, '{ ok: false } consent must deny');
    assert.match(result.error ?? '', /consent_denied/, 'error must identify consent_denied');
    assert.ok(
      audit.recent().some((e) => e.op === 'abort' && e.reason?.includes('consent_denied')),
      'denial must be audited as abort',
    );
    clearWriteConsentStore();
  });

  // Requirement: missing/undefined/null/non-boolean ok is treated as snapshot failure
  test('expired consent token — confirmWrite returns consent_denied error', async () => {
    const { manager, address, session } = await attachedManager();
    clearWriteConsentStore();
    const proposal = manager.proposeWrite(address, 99, { userApproved: true, reason: 'fc-expired' });
    const binding = writeConsentBinding(session, proposal.proposalId, address);

    const expired = issueWriteConsent(binding, { ttlMs: 1, nowMs: Date.now() - 10_000 });

    const result = await manager.confirmWrite(proposal.proposalId, {
      reason: 'fc-expired',
      consentToken: expired.tokenId,
      consentBinding: binding,
    });

    assert.equal(result.success, false, 'expired consent must deny');
    assert.match(result.error ?? '', /consent_denied/);
    clearWriteConsentStore();
  });

  // Requirement: malformed results are never reported as successful snapshots
  test('replayed consent token — second confirmWrite with same token returns consent_denied', async () => {
    const { manager, address, session } = await attachedManager();
    clearWriteConsentStore();

    const proposal1 = manager.proposeWrite(address, 11, { userApproved: true, reason: 'fc-replay-1' });
    const binding1 = writeConsentBinding(session, proposal1.proposalId, address);
    const artifact = issueWriteConsent(binding1);

    const first = await manager.confirmWrite(proposal1.proposalId, {
      reason: 'fc-replay-1',
      consentToken: artifact.tokenId,
      consentBinding: binding1,
    });
    assert.equal(first.success, true, 'first confirm must succeed');

    // Replay the same token on a new proposal
    const proposal2 = manager.proposeWrite(address, 22, { userApproved: true, reason: 'fc-replay-2' });
    const binding2 = writeConsentBinding(session, proposal2.proposalId, address);
    const replayed = await manager.confirmWrite(proposal2.proposalId, {
      reason: 'fc-replay-2',
      consentToken: artifact.tokenId,
      consentBinding: binding2,
    });
    assert.equal(replayed.success, false, 'replayed token must be denied');
    assert.match(replayed.error ?? '', /consent_denied/);
    clearWriteConsentStore();
  });

  // ── proposeWrite policy gate ──────────────────────────────────────────────

  // Requirement: policy gate ok !== true path denies (safeWrite without approval)
  test('safeWrite without userApproved — write policy gate denies (fail-closed default)', async () => {
    const { manager, address } = await attachedManager();
    const result = await manager.safeWrite(address, 55, { reason: 'no-approval' });
    assert.equal(result.success, false, 'safeWrite without userApproved must be denied by policy gate');
    assert.match(result.error ?? '', /write_policy_denied/, 'error must identify write_policy_denied');
  });

  // ── confirmWrite policy gate ──────────────────────────────────────────────

  // Requirement: confirmWrite policy gate ok !== true path denies
  test('confirmWrite without userApproved or consent — write policy gate denies', async () => {
    const { manager, address } = await attachedManager();
    const proposal = manager.proposeWrite(address, 77, { userApproved: true, reason: 'gate-test' });
    // Now confirm without approval to exercise gate.ok !== true path
    const result = await manager.confirmWrite(proposal.proposalId, {
      reason: 'no-approval-confirm',
      // no userApproved, no consentToken
    });
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /write_policy_denied/);
  });

  // ── freezeStart consent gate ──────────────────────────────────────────────

  // Requirement: { ok: false } consent in freezeStart is treated as failure
  test('freezeStart with unknown consent token denies (ok !== true path)', async () => {
    const { manager, address, session } = await attachedManager();
    clearWriteConsentStore();

    // Propose a freeze using positional args (address, value, intervalMs)
    const fp = session.proposeFreeze(address, 9999, 100);

    const fakeBinding = freezeConsentBinding(session, {
      proposalId: fp.proposalId,
      target: address,
      value: 9999,
      intervalMs: 100,
    });

    const result = await manager.freezeStart(fp.proposalId, {
      consentToken: '00000000-0000-4000-8000-000000000000',
      consentBinding: fakeBinding,
    });

    assert.equal(result.success, false, 'unknown consent token must deny freeze start');
    assert.match(result.error ?? '', /consent_denied/);
    clearWriteConsentStore();
  });
});

