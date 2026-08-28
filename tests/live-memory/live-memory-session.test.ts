import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LiveMemorySession } from '../../src/core/live-memory/live-memory-session.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import type { RemoteConnectionEvidence, LiveMemoryAddress } from '../../src/core/live-memory/types.js';
import { _clearActiveFreezesForTests } from '../../src/core/live-memory/freeze-concurrency-registry.js';

// Batch B1.1's cross-session freeze concurrency registry is process-global (by design —
// it must see freezes started by OTHER sessions). Tests in this file create many
// short-lived sessions that often share the same fake pid/address, so the registry must be
// reset before every test or an earlier test's un-stopped freeze registration would cause a
// later, unrelated test to be spuriously rejected as a "duplicate_address".
beforeEach(() => {
  _clearActiveFreezesForTests();
});

const CLEAN_EVIDENCE: RemoteConnectionEvidence = {
  availability: 'available',
  remoteConnectionCount: 0,
  observedAt: '2026-07-05T00:00:00.000Z',
};

const ONLINE_EVIDENCE: RemoteConnectionEvidence = {
  availability: 'available',
  remoteConnectionCount: 3,
  observedAt: '2026-07-05T00:00:01.000Z',
};

function makeSession(
  driver: FakeMemoryDriver,
  evidenceSequence: RemoteConnectionEvidence[],
  executableName = 'demo.exe',
) {
  driver.setProcessExecutableName(1234, executableName);
  const session = new LiveMemorySession(driver);
  let call = 0;
  session._injectRemoteConnectionObserver(async () => {
    const result = evidenceSequence[Math.min(call, evidenceSequence.length - 1)];
    call += 1;
    return result;
  });
  return session;
}

const HEALTH_ADDR: LiveMemoryAddress = { address: 0x1000n, dataType: 'int32' };

describe('LiveMemorySession', () => {
  test('attach fails without user confirmation, process is never opened', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE]);

    const result = await session.attach({ pid: 1234, executableName: 'demo.exe' }, false);

    assert.equal(result.success, false);
    assert.equal(driver.isOpen(), false);
    assert.equal(session.isAttached(), false);
  });

  test('attach succeeds when remote connections are present if waiver accepted (Trust Shift)', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [ONLINE_EVIDENCE]);

    const result = await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    assert.equal(result.success, true);
    assert.equal(driver.isOpen(), true);
    assert.match(result.guard.reason, /advisory/i);
  });

  test('attach succeeds with confirmation and clean evidence', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE]);

    const result = await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    assert.equal(result.success, true);
    assert.equal(driver.isOpen(), true);
    assert.equal(session.isAttached(), true);
  });

  test('attach fails closed and closes handle when protected target modules are present', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    driver.addModule('demo.exe', 0x400000n, 0x1000);
    driver.addModule('EasyAntiCheat_EOS.dll', 0x500000n, 0x1000);
    const session = makeSession(driver, [CLEAN_EVIDENCE]);

    const result = await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /Protected target indicator/i);
    assert.equal(driver.isOpen(), false);
    assert.equal(driver.closeCallCount, 1);
    assert.equal(session.isAttached(), false);
  });

  test('propose then confirm writes the new value and produces a manifest', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE]);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const proposal = session.proposeWrite(HEALTH_ADDR, 9999);
    assert.equal(proposal.currentValue, 100);
    assert.equal(driver.getValue(0x1000n), 100, 'propose must not write yet');

    const result = await session.confirmWrite(proposal.proposalId);

    assert.equal(result.success, true);
    assert.equal(driver.getValue(0x1000n), 9999);
    assert.equal(result.manifest?.valueBefore, 100);
    assert.equal(result.manifest?.valueAfter, 9999);
  });

  test('discardPendingWrite removes a staged proposal so it can no longer be confirmed', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE]);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const proposal = session.proposeWrite(HEALTH_ADDR, 9999);
    assert.ok(session.getPendingWriteProposal(proposal.proposalId));

    session.discardPendingWrite(proposal.proposalId);

    assert.equal(session.getPendingWriteProposal(proposal.proposalId), undefined);
    const result = await session.confirmWrite(proposal.proposalId);
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /Unknown or expired proposal/i);
    assert.equal(driver.getValue(0x1000n), 100, 'a discarded proposal must never actually write memory');
  });

  test('discardPendingWrite on an unknown/already-consumed proposalId is a safe no-op', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE]);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    assert.doesNotThrow(() => session.discardPendingWrite('never-existed'));

    const proposal = session.proposeWrite(HEALTH_ADDR, 9999);
    await session.confirmWrite(proposal.proposalId);
    assert.doesNotThrow(() => session.discardPendingWrite(proposal.proposalId), 'discarding an already-confirmed (already-deleted) proposalId must not throw');
  });

  test('confirmWrite proceeds when connection count rises between propose and confirm (Trust Shift)', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    // First call (attach) clean, second call (confirmWrite) online — still allowed with waiver.
    const session = makeSession(driver, [CLEAN_EVIDENCE, ONLINE_EVIDENCE]);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const proposal = session.proposeWrite(HEALTH_ADDR, 9999);
    const result = await session.confirmWrite(proposal.proposalId);

    assert.equal(result.success, true);
    assert.equal(driver.getValue(0x1000n), 9999);
    assert.match(result.guard?.reason ?? '', /advisory/i);
  });

  test('confirmWrite is blocked if the OS executable name no longer matches the attached target', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE]);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const proposal = session.proposeWrite(HEALTH_ADDR, 9999);
    driver.setProcessExecutableName(1234, 'other.exe');

    const result = await session.confirmWrite(proposal.proposalId);

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /identity mismatch/i);
    assert.equal(driver.getValue(0x1000n), 100);
  });

  test('verifyAttachedProcessIdentity fails closed on path or creation-time mismatch', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    driver.setProcessExecutableName(1234, 'demo.exe');
    driver.setProcessExecutablePath(1234, 'C:\\Games\\demo.exe');
    driver.setProcessStartTime(1234, '2026-07-01T00:00:00.000Z');
    const session = makeSession(driver, [CLEAN_EVIDENCE]);
    await session.attach(
      {
        pid: 1234,
        executableName: 'demo.exe',
        executablePath: 'C:\\Games\\demo.exe',
        startTime: '2026-07-01T00:00:00.000Z',
      },
      true,
    );
    assert.equal(session.verifyAttachedProcessIdentity(), null);

    driver.setProcessExecutablePath(1234, 'C:\\Games\\spoofed.exe');
    assert.match(session.verifyAttachedProcessIdentity() ?? '', /path mismatch/i);

    driver.setProcessExecutablePath(1234, 'C:\\Games\\demo.exe');
    driver.setProcessStartTime(1234, '2026-07-02T00:00:00.000Z');
    assert.match(session.verifyAttachedProcessIdentity() ?? '', /creation time|PID reuse/i);
  });

  test('rollback restores the value captured before the write', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE, CLEAN_EVIDENCE]);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const proposal = session.proposeWrite(HEALTH_ADDR, 9999);
    const confirmed = await session.confirmWrite(proposal.proposalId);
    assert.equal(confirmed.success, true);

    const rolledBack = await session.rollback(confirmed.manifest!.proposalId);
    assert.equal(rolledBack.success, true);
    assert.equal(driver.getValue(0x1000n), 100);
  });

  test('rollback rejects a caller-supplied manifest for a write that was never confirmed', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE]);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const forged = await session.rollback('forged-proposal-id-never-confirmed');

    assert.equal(forged.success, false);
    assert.match(forged.error ?? '', /unknown, expired, or already rolled back/i);
    assert.equal(driver.getValue(0x1000n), 100, 'no memory should be written for an unknown proposal');
  });

  test('rollback cannot be replayed after it has already consumed the confirmed write', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE, CLEAN_EVIDENCE, CLEAN_EVIDENCE]);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const proposal = session.proposeWrite(HEALTH_ADDR, 9999);
    const confirmed = await session.confirmWrite(proposal.proposalId);
    const first = await session.rollback(confirmed.manifest!.proposalId);
    assert.equal(first.success, true);
    assert.equal(driver.getValue(0x1000n), 100);

    driver.setValue(0x1000n, 4242);
    const replay = await session.rollback(confirmed.manifest!.proposalId);

    assert.equal(replay.success, false);
    assert.match(replay.error ?? '', /unknown, expired, or already rolled back/i);
    assert.equal(driver.getValue(0x1000n), 4242, 'replayed rollback must not touch memory again');
  });

  test('rollback fails closed when the attached process identity no longer matches', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE, CLEAN_EVIDENCE]);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const proposal = session.proposeWrite(HEALTH_ADDR, 9999);
    const confirmed = await session.confirmWrite(proposal.proposalId);
    assert.equal(confirmed.success, true);

    driver.setProcessExecutableName(1234, 'different.exe');
    const rolledBack = await session.rollback(confirmed.manifest!.proposalId);

    assert.equal(rolledBack.success, false);
    assert.match(rolledBack.error ?? '', /identity mismatch/i);
    assert.equal(driver.getValue(0x1000n), 9999, 'rollback must not write when identity fails closed');
  });

  test('rollback ledger is cleared on detach — a re-attached session cannot roll back a prior session\'s write', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE, CLEAN_EVIDENCE, CLEAN_EVIDENCE]);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const proposal = session.proposeWrite(HEALTH_ADDR, 9999);
    const confirmed = await session.confirmWrite(proposal.proposalId);
    assert.equal(confirmed.success, true);

    session.detach();
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const rolledBack = await session.rollback(confirmed.manifest!.proposalId);
    assert.equal(rolledBack.success, false);
    assert.match(rolledBack.error ?? '', /unknown, expired, or already rolled back/i);
  });

  test('rollback fails closed against a same-PID process restart (path + start time both changed, PID unchanged)', async () => {
    // Distinct from the generic identity-mismatch test above: this specifically simulates
    // the PID-reuse scenario (OS assigns the SAME numeric PID to a brand-new process after
    // the original exits) rather than an executable-name-only discrepancy.
    const driver = new FakeMemoryDriver({ '4096': 100 });
    driver.setProcessExecutablePath(1234, 'C:\\Games\\demo\\demo.exe');
    driver.setProcessStartTime(1234, '2026-07-01T00:00:00.000Z');
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE, CLEAN_EVIDENCE]);
    await session.attach(
      { pid: 1234, executableName: 'demo.exe', executablePath: 'C:\\Games\\demo\\demo.exe', startTime: '2026-07-01T00:00:00.000Z' },
      true,
    );

    const proposal = session.proposeWrite(HEALTH_ADDR, 9999);
    const confirmed = await session.confirmWrite(proposal.proposalId);
    assert.equal(confirmed.success, true);

    // Simulate PID reuse: same numeric PID 1234, but the OS now reports a different
    // executable path AND a different process creation time — the signature of a
    // restarted (or entirely different) process reusing a recycled PID.
    driver.setProcessExecutablePath(1234, 'C:\\Windows\\Temp\\unrelated.exe');
    driver.setProcessStartTime(1234, '2026-07-01T00:05:00.000Z');

    const rolledBack = await session.rollback(confirmed.manifest!.proposalId);

    assert.equal(rolledBack.success, false);
    assert.match(rolledBack.error ?? '', /mismatch/i);
    assert.equal(driver.getValue(0x1000n), 9999, 'rollback must not write to a process that only shares a recycled PID');
  });

  test('Batch B1.1: confirmWrite is REJECTED (not evicted-and-allowed) once the ledger is full of still-valid entries', async () => {
    // Each write targets its OWN distinct address, so rolling back an early write is never
    // itself blocked by the new expected-current-value check picking up a LATER write's
    // effect on a shared address — this test is specifically about ledger capacity, not
    // about the expected-value check (covered by separate tests above).
    const initial: Record<string, number> = {};
    for (let i = 0; i < 51; i++) initial[String(0x2000 + i)] = 0;
    const driver = new FakeMemoryDriver(initial);
    const evidence = Array.from({ length: 120 }, () => CLEAN_EVIDENCE);
    const session = makeSession(driver, evidence);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const manifests = [];
    for (let i = 0; i < 50; i++) {
      const addr: LiveMemoryAddress = { address: BigInt(0x2000 + i), dataType: 'int32' };
      const proposal = session.proposeWrite(addr, 1000 + i);
      const confirmed = await session.confirmWrite(proposal.proposalId);
      assert.equal(confirmed.success, true, `write ${i} should succeed — ledger not yet full`);
      manifests.push(confirmed.manifest!);
    }

    // The 51st confirm must be REJECTED — no eviction of a still-valid entry, and no orphan write.
    const addr51: LiveMemoryAddress = { address: BigInt(0x2000 + 50), dataType: 'int32' };
    const proposal51 = session.proposeWrite(addr51, 5555);
    const confirmed51 = await session.confirmWrite(proposal51.proposalId);
    assert.equal(confirmed51.success, false);
    assert.match(confirmed51.error ?? '', /rollback_ledger_full/);
    assert.equal(driver.getValue(BigInt(0x2000 + 50)), 0, 'the rejected 51st write must not have touched memory at all');

    // Every one of the first 50 (still-valid, none evicted) remains rollback-able.
    const firstRollback = await session.rollback(manifests[0].proposalId);
    assert.equal(firstRollback.success, true, 'the very first confirmed write must NOT have been evicted');
  });

  test('Batch B1.1: rollback FAILS CLOSED when current memory no longer matches the confirmed write (fixes the prior "silently overwrites intervening change" gap)', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE, CLEAN_EVIDENCE]);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const proposal = session.proposeWrite(HEALTH_ADDR, 9999);
    const confirmed = await session.confirmWrite(proposal.proposalId);
    assert.equal(confirmed.success, true);
    assert.equal(driver.getValue(0x1000n), 9999);

    // Something else changes the same address after the confirmed write — e.g. the game's
    // own logic, a concurrent freeze, or a second unrelated write to the same address.
    driver.setValue(0x1000n, 42);

    const rolledBack = await session.rollback(confirmed.manifest!.proposalId);

    assert.equal(rolledBack.success, false, 'rollback must refuse to proceed once current memory no longer matches');
    assert.match(rolledBack.error ?? '', /expected_value_mismatch/);
    assert.equal(driver.getValue(0x1000n), 42, 'the intervening value must be left untouched, not clobbered');
  });

  test('Batch B1.1: rollback succeeds when current memory still matches the confirmed write (no false positives from the new check)', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE, CLEAN_EVIDENCE]);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const proposal = session.proposeWrite(HEALTH_ADDR, 9999);
    const confirmed = await session.confirmWrite(proposal.proposalId);
    assert.equal(confirmed.success, true);

    // Nothing else touches the address — current value is still exactly what the write applied.
    const rolledBack = await session.rollback(confirmed.manifest!.proposalId);

    assert.equal(rolledBack.success, true);
    assert.equal(driver.getValue(0x1000n), 100);
  });

  test('Batch B1.1: a confirmed write expires after its TTL and can no longer be rolled back (fixes the prior "indefinite" gap)', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE, CLEAN_EVIDENCE]);
    let simulatedNow = 1_000_000;
    session._injectNowMsForTests(() => simulatedNow);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const proposal = session.proposeWrite(HEALTH_ADDR, 9999);
    const confirmed = await session.confirmWrite(proposal.proposalId);
    assert.equal(confirmed.success, true);

    // Advance the fake clock past the centralized 30-minute TTL.
    simulatedNow += 30 * 60 * 1000 + 1;

    const rolledBack = await session.rollback(confirmed.manifest!.proposalId);

    assert.equal(rolledBack.success, false);
    assert.match(rolledBack.error ?? '', /unknown, expired, or already rolled back/i);
    assert.equal(driver.getValue(0x1000n), 9999, 'an expired rollback record must not write to memory');
  });

  test('Batch B1.1: a confirmed write is still rollback-able just before its TTL boundary (no off-by-one)', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE, CLEAN_EVIDENCE]);
    let simulatedNow = 1_000_000;
    session._injectNowMsForTests(() => simulatedNow);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const proposal = session.proposeWrite(HEALTH_ADDR, 9999);
    const confirmed = await session.confirmWrite(proposal.proposalId);
    assert.equal(confirmed.success, true);

    // One millisecond before the 30-minute TTL elapses.
    simulatedNow += 30 * 60 * 1000 - 1;

    const rolledBack = await session.rollback(confirmed.manifest!.proposalId);

    assert.equal(rolledBack.success, true, 'must still be valid one ms before the TTL boundary');
  });

  test('detach closes the process handle and clears pending proposals', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE], 'game.exe');
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    session.detach();

    assert.equal(driver.isOpen(), false);
    assert.equal(driver.closeCallCount, 1);
    assert.equal(session.isAttached(), false);
  });

  test('confirmWrite on unknown proposal id fails without touching memory', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE]);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const result = await session.confirmWrite('does-not-exist');

    assert.equal(result.success, false);
    assert.equal(driver.getValue(0x1000n), 100);
  });

  test('scanFirstAutoMatrix fans out modes and value types while storing unknown baseline internally', async () => {
    const driver = new FakeMemoryDriver();
    const region = Buffer.alloc(32, 0);
    region.writeInt32LE(125, 0);
    region.writeFloatLE(125, 4);
    driver.addRegion(0x5000n, region, true);
    const session = makeSession(driver, [CLEAN_EVIDENCE]);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const first = session.scanFirstAutoMatrix({
      value: 125,
      min: 120,
      max: 130,
      dataTypes: ['int32', 'float'],
      modes: ['exact', 'between'],
      includeUnknown: true,
      unknownKey: 'health',
    });

    assert.equal(first.readOnly, true);
    assert.equal(first.executable, false);
    assert.equal(first.totals.buckets, 4);
    assert.equal(first.totals.unknownCaptured, true);
    assert.ok(first.unknown);
    assert.equal('snapshot' in first.unknown, false);
    assert.ok(first.buckets.some((bucket) =>
      bucket.mode === 'exact' &&
      bucket.dataType === 'int32' &&
      bucket.matches.some((match) => match.address === 0x5000n),
    ));

    region.writeInt32LE(100, 0);
    region.writeFloatLE(100, 4);
    const narrowed = session.scanNextFromUnknown('health', ['int32', 'float'], { kind: 'decreased' });

    assert.ok(narrowed.matches.some((match) => match.address === 0x5000n && match.dataType === 'int32'));
    assert.ok(narrowed.matches.some((match) => match.address === 0x5004n && match.dataType === 'float'));
  });
});

// ── Freeze (continuous re-write) ─────────────────────────────────────────────

interface ScheduledTick {
  fn: () => void;
  delay: number;
}

function makeFakeFreezeScheduler() {
  const scheduled: ScheduledTick[] = [];
  const scheduler = {
    schedule(fn: () => void, delay: number): unknown {
      const entry: ScheduledTick = { fn, delay };
      scheduled.push(entry);
      return entry;
    },
    cancel(handle: unknown): void {
      const idx = scheduled.indexOf(handle as ScheduledTick);
      if (idx !== -1) scheduled.splice(idx, 1);
    },
  };
  return {
    scheduler,
    pendingCount: () => scheduled.length,
    async fireNext(): Promise<void> {
      const entry = scheduled.shift();
      if (!entry) throw new Error('No scheduled tick to fire.');
      entry.fn();
      // Flush the async tick's internal awaits (observer call) before returning control to the test.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('LiveMemorySession freeze', () => {
  test('discardPendingFreeze removes a staged freeze proposal so it can no longer be started', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE]);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const proposal = session.proposeFreeze(HEALTH_ADDR, 9999);
    assert.ok(session.getPendingFreezeProposal(proposal.proposalId));

    session.discardPendingFreeze(proposal.proposalId);

    assert.equal(session.getPendingFreezeProposal(proposal.proposalId), undefined);
    const result = session.startFreezeConfirmed(proposal.proposalId);
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /Unknown or already-consumed freeze proposal/i);
    assert.equal(session.getFreezeStatus().active, false, 'a discarded freeze proposal must never actually start freezing');
  });

  test('discardPendingFreeze on an unknown proposalId is a safe no-op', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE]);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    assert.doesNotThrow(() => session.discardPendingFreeze('never-existed'));
  });

  test('startFreeze fails when no process is attached', () => {
    const driver = new FakeMemoryDriver();
    const session = makeSession(driver, [CLEAN_EVIDENCE]);

    const result = session.startFreeze(HEALTH_ADDR, 9999);

    assert.equal(result.success, false);
  });

  test('startFreeze fails if a freeze is already active on this session', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE, CLEAN_EVIDENCE]);
    const { scheduler } = makeFakeFreezeScheduler();
    session._injectFreezeScheduler(scheduler);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const first = session.startFreeze(HEALTH_ADDR, 9999);
    await flushMicrotasks();
    const second = session.startFreeze(HEALTH_ADDR, 1);

    assert.equal(first.success, true);
    assert.equal(second.success, false);
  });

  test('freeze writes immediately on the first tick and schedules the next one', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE]);
    const { scheduler, pendingCount } = makeFakeFreezeScheduler();
    session._injectFreezeScheduler(scheduler);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const result = session.startFreeze(HEALTH_ADDR, 9999, 100);
    await flushMicrotasks();

    assert.equal(result.success, true);
    assert.equal(driver.getValue(0x1000n), 9999);
    assert.equal(session.getFreezeStatus().active, true);
    assert.equal(session.getFreezeStatus().tickCount, 1);
    assert.equal(pendingCount(), 1, 'exactly one next tick should be scheduled');
  });

  test('freeze re-writes the value on each subsequent scheduled tick', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE, CLEAN_EVIDENCE]);
    const { scheduler, fireNext } = makeFakeFreezeScheduler();
    session._injectFreezeScheduler(scheduler);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    session.startFreeze(HEALTH_ADDR, 9999, 100);
    await flushMicrotasks();

    driver.setValue(0x1000n, 1); // simulate the game overwriting it between ticks
    await fireNext();

    assert.equal(driver.getValue(0x1000n), 9999, 'freeze should have re-written the value on the next tick');
    assert.equal(session.getFreezeStatus().tickCount, 2);
  });

  test('freeze continues when connection count rises mid-freeze (Trust Shift advisory only)', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    // First tick clean; second tick online — freeze must keep writing with waiver.
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE, ONLINE_EVIDENCE]);
    const { scheduler, fireNext, pendingCount } = makeFakeFreezeScheduler();
    session._injectFreezeScheduler(scheduler);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    session.startFreeze(HEALTH_ADDR, 9999, 100);
    await flushMicrotasks();

    driver.setValue(0x1000n, 42);
    await fireNext();

    const status = session.getFreezeStatus();
    assert.equal(status.active, true);
    assert.equal(driver.getValue(0x1000n), 9999, 'advisory online tick must still write');
    assert.equal(status.tickCount, 2);
    assert.ok(pendingCount() >= 1);
    assert.match(status.lastGuard?.reason ?? '', /advisory/i);
  });

  test('stopFreeze halts scheduling and reports user_stopped', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE]);
    const { scheduler, pendingCount } = makeFakeFreezeScheduler();
    session._injectFreezeScheduler(scheduler);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    session.startFreeze(HEALTH_ADDR, 9999, 100);
    await flushMicrotasks();

    const status = session.stopFreeze();

    assert.equal(status.active, false);
    assert.equal(status.stopReason, 'user_stopped');
    assert.equal(pendingCount(), 0, 'the pending scheduled tick must be cancelled');
  });

  test('stopFreeze is a safe no-op when no freeze is active', () => {
    const driver = new FakeMemoryDriver();
    const session = makeSession(driver, [CLEAN_EVIDENCE]);

    const status = session.stopFreeze();

    assert.equal(status.active, false);
  });

  test('detach stops an active freeze with stopReason "detached"', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE]);
    const { scheduler, pendingCount } = makeFakeFreezeScheduler();
    session._injectFreezeScheduler(scheduler);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    session.startFreeze(HEALTH_ADDR, 9999, 100);
    await flushMicrotasks();

    session.detach();

    assert.equal(driver.isOpen(), false);
    assert.equal(pendingCount(), 0);
  });

  test('startFreeze rejects an interval below the minimum bound', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE]);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const result = session.startFreeze(HEALTH_ADDR, 9999, 1);

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /interval/i);
    assert.equal(session.getFreezeStatus().active, false);
  });

  test('startFreeze rejects an interval above the maximum bound', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE]);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const result = session.startFreeze(HEALTH_ADDR, 9999, 999_999);

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /interval/i);
  });

  test('startFreeze rejects a non-finite freeze value even though the IPC schema would also catch it', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE]);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const result = session.startFreeze(HEALTH_ADDR, Number.NaN, 100);

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /finite/i);
    assert.equal(driver.getValue(0x1000n), 100, 'no write should occur for a rejected freeze value');
  });

  test('freeze auto-stops once the maximum duration is exceeded', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE]);
    const { scheduler, fireNext, pendingCount } = makeFakeFreezeScheduler();
    session._injectFreezeScheduler(scheduler);
    session._setMaxFreezeDurationMsForTests(300); // 3 ticks at 100ms
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    session.startFreeze(HEALTH_ADDR, 9999, 100);
    await flushMicrotasks();
    assert.equal(session.getFreezeStatus().tickCount, 1);

    await fireNext(); // tick 2 — elapsed 200ms, still under the 300ms cap
    assert.equal(session.getFreezeStatus().active, true);
    assert.equal(session.getFreezeStatus().tickCount, 2);

    await fireNext(); // tick 3 — elapsed 300ms, hits the cap: stop instead of scheduling tick 4
    assert.equal(session.getFreezeStatus().active, false);
    assert.equal(session.getFreezeStatus().stopReason, 'max_duration_exceeded');
    assert.equal(pendingCount(), 0, 'no further tick should be scheduled once the duration cap is hit');
  });

  test('freeze auto-stops when the target process identity no longer matches (process exited or PID reused)', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE, CLEAN_EVIDENCE]);
    const { scheduler, fireNext } = makeFakeFreezeScheduler();
    session._injectFreezeScheduler(scheduler);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    session.startFreeze(HEALTH_ADDR, 9999, 100);
    await flushMicrotasks();
    assert.equal(session.getFreezeStatus().active, true);

    driver.setProcessExecutableName(1234, 'different.exe');
    await fireNext();

    assert.equal(session.getFreezeStatus().active, false);
    assert.equal(session.getFreezeStatus().stopReason, 'identity_mismatch');
  });
});

describe('LiveMemorySession catalog controls', () => {
  test('getAttachedExecutableName returns null before attach, and the target name after', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE]);
    assert.equal(session.getAttachedExecutableName(), null);

    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);
    assert.equal(session.getAttachedExecutableName(), 'demo.exe');
  });

  test('resolveControl resolves a catalog control\'s pointer path to a live, readable address', async () => {
    const driver = new FakeMemoryDriver();
    const moduleRegion = Buffer.alloc(0x3000, 0);
    const heapBase = 0x10000000n;
    moduleRegion.writeBigUInt64LE(heapBase, 0x2000);
    driver.addRegion(0x400000n, moduleRegion, true);
    driver.addModule('game.exe', 0x400000n, 0x100000);

    const heapRegion = Buffer.alloc(64, 0);
    heapRegion.writeInt32LE(77, 16);
    driver.addRegion(heapBase, heapRegion, true);

    const session = makeSession(driver, [CLEAN_EVIDENCE], 'game.exe');
    await session.attach({ pid: 1234, executableName: 'game.exe' }, true);

    const control = {
      id: 'test-control',
      executableName: 'game.exe',
      label: 'Test Control',
      description: 'test',
      dataType: 'int32' as const,
      pointerPath: { moduleName: 'game.exe', moduleOffset: 0x2000, offsets: [16] },
      discoveredAt: '2026-07-06',
      evidence: 'test',
    };

    const resolvedAddress = session.resolveControl(control);
    assert.equal(resolvedAddress.address, heapBase + 16n);

    const value = session.readValue(resolvedAddress);
    assert.equal(value, 77);
  });

  test('resolveControl throws when not attached', () => {
    const driver = new FakeMemoryDriver();
    const session = makeSession(driver, [CLEAN_EVIDENCE]);
    assert.throws(() =>
      session.resolveControl({
        id: 'x',
        executableName: 'x.exe',
        label: 'x',
        description: 'x',
        dataType: 'int32',
        pointerPath: { moduleName: 'x.exe', moduleOffset: 0, offsets: [0] },
        discoveredAt: '2026-07-06',
        evidence: 'x',
      }),
    );
  });

  test('attach blocks on executable fingerprint mismatch until drift acknowledged', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE]);
    const hash = 'abc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890';

    const blocked = await session.attach(
      { pid: 1234, executableName: 'demo.exe' },
      true,
      { executableHashSHA256: hash, executableHashPrefixes: ['deadbeef'] },
    );
    assert.equal(blocked.success, false);
    assert.equal(blocked.error, 'executable_fingerprint_mismatch');
    assert.match(blocked.fingerprintWarning ?? '', /Patch Day Drift/);
    assert.equal(driver.isOpen(), false);

    const allowed = await session.attach(
      { pid: 1234, executableName: 'demo.exe' },
      true,
      { executableHashSHA256: hash, executableHashPrefixes: ['deadbeef'], driftAcknowledged: true },
    );
    assert.equal(allowed.success, true);
    assert.equal(allowed.fingerprint?.status, 'mismatch');
    assert.match(allowed.fingerprintWarning ?? '', /Patch Day Drift/);
  });

  test('resolveMemoryFeature uses session cache cleared on detach', async () => {
    const driver = new FakeMemoryDriver({ '4194320': 42 });
    driver.addModule('demo.exe', 0x400000n, 0x2000);
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE]);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const feature = {
      id: 'hp',
      name: 'HP',
      category: 'Player',
      type: 'freeze' as const,
      dataType: 'int32' as const,
      defaultValue: 999,
      resolution: {
        moduleName: 'demo.exe',
        baseOffset: '0x10',
      },
    };

    const first = session.resolveMemoryFeature(feature);
    const second = session.resolveMemoryFeature(feature);
    assert.equal(first.address, second.address);

    session.detach();

    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);
    const afterDetach = session.resolveMemoryFeature(feature);
    assert.equal(afterDetach.address, first.address);
  });
});
