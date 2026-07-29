import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { LiveMemorySession } from '../../src/core/live-memory/live-memory-session.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import { issueWriteConsent, consumeWriteConsent, clearWriteConsentStore } from '../../src/core/consent/write-consent.js';
import { _clearActiveFreezesForTests } from '../../src/core/live-memory/freeze-concurrency-registry.js';

afterEach(() => { clearWriteConsentStore(); _clearActiveFreezesForTests(); });

function fixture() {
  const driver = new FakeMemoryDriver({ '4096': 100 });
  const session = new LiveMemorySession(driver);
  const scheduled: Array<{ fn: () => void }> = [];
  session.setOwnerId('42');
  session._injectRemoteConnectionObserver(async () => ({ availability: 'available', remoteConnectionCount: 0, observedAt: '2026-07-05T00:00:00.000Z' }));
  session._injectFreezeScheduler({
    schedule(fn) { const handle = { fn }; scheduled.push(handle); return handle; },
    cancel(handle) { const index = scheduled.indexOf(handle as { fn: () => void }); if (index >= 0) scheduled.splice(index, 1); },
  });
  return { driver, session, scheduled };
}

describe('feature-disable cleanup', () => {
  test('stops an active freeze, revokes pending authorization, and prevents later writes', async () => {
    const { driver, session, scheduled } = fixture();
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);
    const proposal = session.proposeFreeze({ address: 0x1000n, dataType: 'int32' }, 9999, 100);
    assert.equal(session.startFreezeConfirmed(proposal.proposalId).success, true);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(scheduled.length, 1);

    const pending = session.proposeFreeze({ address: 0x1004n, dataType: 'int32' }, 77, 100);
    const binding = {
      operation: 'live_memory_freeze_start' as const, sessionKey: '42', proposalId: pending.proposalId,
      attachedPid: 1234, attachedExecutableName: 'demo.exe', executablePath: 'C:\\FakeGames\\demo.exe',
      processStartTime: '2020-01-01T00:00:00.000Z', address: '4100', dataType: 'int32',
      freezeValue: 77, freezeIntervalMs: 100, freezeMaxDurationMs: 21_600_000, windowId: 42,
    };
    const consent = issueWriteConsent(binding);

    session._injectFreezeFeatureFlagCheck(() => false);
    assert.equal(session.getFreezeStatus().active, false);
    assert.equal(session.getFreezeStatus().stopReason, 'feature_disabled');
    const valueAtDisable = driver.getValue(0x1000n);
    assert.equal(session.getPendingFreezeProposal(pending.proposalId), undefined);
    assert.equal(consumeWriteConsent(consent.tokenId, binding).ok, false);
    assert.equal(scheduled.length, 0);
    assert.equal(driver.getValue(0x1000n), valueAtDisable);

    session._injectFreezeFeatureFlagCheck(() => true);
    assert.equal(session.getFreezeStatus().active, false, 're-enable must not restart an old freeze');
    assert.equal(driver.getValue(0x1000n), valueAtDisable);
  });
});
