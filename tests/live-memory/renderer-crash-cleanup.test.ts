import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LiveMemorySession } from '../../src/core/live-memory/live-memory-session.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import { runCleanup } from '../../src/core/live-memory/cleanup-coordinator.js';
import { issueWriteConsent, consumeWriteConsent, revokeWriteConsentsForSession, clearWriteConsentStore } from '../../src/core/consent/write-consent.js';
import { createProcessSelection, resolveProcessSelection, clearSelectionsForWindow, _clearAllSelectionsForTests } from '../../src/core/security/process-selection-registry.js';
import { registerTrustedWindow, validateTrustedSender, unregisterTrustedWindow, _clearTrustedWindowsForTests } from '../../src/core/security/trusted-sender-registry.js';
import { _clearActiveFreezesForTests } from '../../src/core/live-memory/freeze-concurrency-registry.js';

afterEach(() => { clearWriteConsentStore(); _clearAllSelectionsForTests(); _clearTrustedWindowsForTests(); _clearActiveFreezesForTests(); });

function sessionFixture(owner: string, value: number) {
  const driver = new FakeMemoryDriver({ '4096': 100 });
  const session = new LiveMemorySession(driver);
  const scheduled: Array<{ fn: () => void }> = [];
  session.setOwnerId(owner);
  session._injectRemoteConnectionObserver(async () => ({ availability: 'available', remoteConnectionCount: 0, observedAt: '2026-07-05T00:00:00.000Z' }));
  session._injectFreezeScheduler({ schedule(fn) { const h = { fn }; scheduled.push(h); return h; }, cancel(h) { const i = scheduled.indexOf(h as { fn: () => void }); if (i >= 0) scheduled.splice(i, 1); } });
  return { driver, session, scheduled, value };
}

test('real render-process-gone wiring performs owner-scoped idempotent cleanup', async () => {
  assert.match(fs.readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8'), /app\.on\('render-process-gone'[\s\S]*disposeLiveMemorySessionForOwner/);
  const crashed = sessionFixture('1', 9999);
  const other = sessionFixture('2', 8888);
  for (const fixture of [crashed, other]) {
    await fixture.session.attach({ pid: 1000 + Number(fixture.value), executableName: 'demo.exe' }, true);
    const proposal = fixture.session.proposeFreeze({ address: 0x1000n, dataType: 'int32' }, fixture.value, 100);
    assert.equal(fixture.session.startFreezeConfirmed(proposal.proposalId).success, true);
  }
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  const pending = crashed.session.proposeFreeze({ address: 0x1004n, dataType: 'int32' }, 77, 100);
  const binding = { operation: 'live_memory_freeze_start' as const, sessionKey: '1', proposalId: pending.proposalId, attachedPid: 10999, attachedExecutableName: 'demo.exe', executablePath: 'C:\\FakeGames\\demo.exe', processStartTime: '2020-01-01T00:00:00.000Z', address: '4100', dataType: 'int32', freezeValue: 77, freezeIntervalMs: 100, freezeMaxDurationMs: 21_600_000, windowId: 1 };
  const token = issueWriteConsent(binding);
  const selection = createProcessSelection({ pid: 10999, executableName: 'demo.exe', windowId: 1 });
  registerTrustedWindow({ webContentsId: 1, windowType: 'main', allowedUrlPrefixes: ['file:///trusted/app/index.html'] });
  const audits: string[] = [];
  const cleanup = () => runCleanup({ ownerId: '1', markRevoking: () => crashed.session.beginCleanupRevocation(), blockFutureWrites: () => crashed.session.beginCleanupRevocation(), revokeConsentTokens: () => { revokeWriteConsentsForSession('1'); }, revokePendingProposals: () => crashed.session.revokePendingAuthorizationsForCleanup(), stopFreezeSchedulers: () => crashed.session.stopFreezeForCleanup(), detachMemorySessions: () => crashed.session.detachMemoryForCleanup(), clearRollbackRecords: () => crashed.session.clearRollbackRecordsForCleanup(), clearProcessSelections: () => clearSelectionsForWindow(1), removeTrustedWindowOwnership: () => unregisterTrustedWindow(1), audit: (event) => { audits.push(event); } });

  assert.equal(cleanup().success, true);
  assert.equal(cleanup().success, true);
  assert.equal(crashed.session.getFreezeStatus().active, false);
  assert.equal(other.session.getFreezeStatus().active, true);
  assert.equal(crashed.scheduled.length, 0);
  assert.equal(crashed.session.getPendingFreezeProposal(pending.proposalId), undefined);
  assert.equal(consumeWriteConsent(token.tokenId, binding).ok, false);
  assert.equal(resolveProcessSelection(selection.selectionId, 1).ok, false);
  assert.equal(validateTrustedSender({ webContentsId: 1, isDestroyed: false, isMainFrame: true, frameUrl: 'file:///trusted/app/index.html' }).ok, false);
  assert.ok(audits.includes('cleanup_started') && audits.includes('cleanup_completed'));
  other.session.detach();
});
