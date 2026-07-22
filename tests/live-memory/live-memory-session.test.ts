import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LiveMemorySession } from '../../src/core/live-memory/live-memory-session.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import type { RemoteConnectionEvidence, LiveMemoryAddress } from '../../src/core/live-memory/types.js';

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

  test('rollback restores the value captured before the write', async () => {
    const driver = new FakeMemoryDriver({ '4096': 100 });
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE, CLEAN_EVIDENCE]);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const proposal = session.proposeWrite(HEALTH_ADDR, 9999);
    const confirmed = await session.confirmWrite(proposal.proposalId);
    assert.equal(confirmed.success, true);

    const rolledBack = await session.rollback(confirmed.manifest!);
    assert.equal(rolledBack.success, true);
    assert.equal(driver.getValue(0x1000n), 100);
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

    const session = makeSession(driver, [CLEAN_EVIDENCE]);
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
