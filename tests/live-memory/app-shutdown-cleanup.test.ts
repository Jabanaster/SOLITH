import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LiveMemorySession } from '../../src/core/live-memory/live-memory-session.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import { runCleanup } from '../../src/core/live-memory/cleanup-coordinator.js';
import { clearWriteConsentStore } from '../../src/core/consent/write-consent.js';
import { clearAllProcessSelections, _clearAllSelectionsForTests } from '../../src/core/security/process-selection-registry.js';
import { clearAllTrustedWindows, _clearTrustedWindowsForTests } from '../../src/core/security/trusted-sender-registry.js';
import { _clearActiveFreezesForTests } from '../../src/core/live-memory/freeze-concurrency-registry.js';

afterEach(() => { clearWriteConsentStore(); _clearAllSelectionsForTests(); _clearTrustedWindowsForTests(); _clearActiveFreezesForTests(); });

function make(owner: string, pid: number) {
  const session = new LiveMemorySession(new FakeMemoryDriver({ '4096': 100 }));
  const scheduled: unknown[] = [];
  session.setOwnerId(owner);
  session._injectRemoteConnectionObserver(async () => ({ availability: 'available', remoteConnectionCount: 0, observedAt: '2026-07-05T00:00:00.000Z' }));
  session._injectFreezeScheduler({ schedule(fn) { const h = { fn }; scheduled.push(h); return h; }, cancel(h) { const i = scheduled.indexOf(h); if (i >= 0) scheduled.splice(i, 1); } });
  return { session, scheduled, pid };
}

test('will-quit cleanup stops every session and records accurate sanitized results', async () => {
  const main = fs.readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8');
  assert.match(main, /app\.on\('will-quit'[\s\S]*disposeAllLiveMemorySessions/);
  const fixtures = [make('1', 1001), make('2', 1002)];
  for (const fixture of fixtures) {
    await fixture.session.attach({ pid: fixture.pid, executableName: 'demo.exe' }, true);
    const proposal = fixture.session.proposeFreeze({ address: 0x1000n, dataType: 'int32' }, fixture.pid, 100);
    assert.equal(fixture.session.startFreezeConfirmed(proposal.proposalId).success, true);
  }
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  const audit: string[] = [];
  const results = fixtures.map(({ session }, index) => runCleanup({
    ownerId: String(index + 1), markRevoking: () => session.beginCleanupRevocation(), blockFutureWrites: () => session.beginCleanupRevocation(),
    revokeConsentTokens: clearWriteConsentStore, revokePendingProposals: () => session.revokePendingAuthorizationsForCleanup(),
    stopFreezeSchedulers: () => session.stopFreezeForCleanup(), detachMemorySessions: () => session.detachMemoryForCleanup(),
    clearRollbackRecords: () => session.clearRollbackRecordsForCleanup(), clearProcessSelections: clearAllProcessSelections,
    removeTrustedWindowOwnership: clearAllTrustedWindows, audit: (event) => { audit.push(event); },
  }));
  assert.equal(results.every((result) => result.success), true);
  assert.equal(fixtures.every(({ session }) => !session.getFreezeStatus().active && !session.isAttached()), true);
  assert.equal(fixtures.every(({ scheduled }) => scheduled.length === 0), true);
  assert.equal(audit.filter((event) => event === 'cleanup_completed').length, 2);
  assert.doesNotMatch(JSON.stringify(results), /9999|C:\\\\|tokenId|exePath/i);
});
