import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LiveMemorySession } from '../../src/core/live-memory/live-memory-session.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import type { LiveProcessHandle, RemoteConnectionEvidence, LiveMemoryAddress } from '../../src/core/live-memory/types.js';
import { _clearActiveFreezesForTests } from '../../src/core/live-memory/freeze-concurrency-registry.js';

/**
 * Gate 2 — raw-byte rollback-equality test matrix. Complements
 * rollback-float-integrity.test.ts (which unit-tests the pure
 * compareRollbackValue function in isolation) by exercising the additive,
 * byte-exact safety net end-to-end through LiveMemorySession + a real
 * propose/confirm/rollback cycle against FakeMemoryDriver.
 *
 * See Docs/Security/Evidence/BatchB1_1_Closeout/Gate2/rollback-byte-feasibility.md
 * and rollback-byte-test-matrix.csv for the requirement-to-test mapping.
 */

beforeEach(() => {
  _clearActiveFreezesForTests();
});

const CLEAN_EVIDENCE: RemoteConnectionEvidence = {
  availability: 'available',
  remoteConnectionCount: 0,
  observedAt: '2026-07-28T00:00:00.000Z',
};

function makeSession(driver: FakeMemoryDriver, evidenceSequence: RemoteConnectionEvidence[]) {
  driver.setProcessExecutableName(1234, 'demo.exe');
  const session = new LiveMemorySession(driver);
  let call = 0;
  session._injectRemoteConnectionObserver(async () => {
    const result = evidenceSequence[Math.min(call, evidenceSequence.length - 1)];
    call += 1;
    return result;
  });
  return session;
}

const DUMMY_HANDLE: LiveProcessHandle = { pid: 1234, opaque: null };

async function attachAndConfirm(
  driver: FakeMemoryDriver,
  addr: LiveMemoryAddress,
  requestedValue: number,
  evidenceCount = 3,
) {
  const session = makeSession(driver, Array(evidenceCount).fill(CLEAN_EVIDENCE));
  await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);
  const proposal = session.proposeWrite(addr, requestedValue);
  const confirmed = await session.confirmWrite(proposal.proposalId);
  assert.equal(confirmed.success, true, 'setup confirm must succeed');
  return { session, proposalId: confirmed.manifest!.proposalId };
}

describe('Gate 2: raw-byte rollback equality', () => {
  test('identical bytes: rollback succeeds when nothing else touched memory', async () => {
    const DOUBLE_ADDR: LiveMemoryAddress = { address: 0x3000n, dataType: 'double' };
    const driver = new FakeMemoryDriver({ '12288': 1.5 });
    const { session, proposalId } = await attachAndConfirm(driver, DOUBLE_ADDR, 42.25);

    const rolledBack = await session.rollback(proposalId);
    assert.equal(rolledBack.success, true);
    assert.equal(driver.getValue(0x3000n), 1.5);
  });

  test('one-bit mismatch in a non-NaN double is detected and rejected', async () => {
    const DOUBLE_ADDR: LiveMemoryAddress = { address: 0x3010n, dataType: 'double' };
    const driver = new FakeMemoryDriver({ '12304': 1.5 });
    const { session, proposalId } = await attachAndConfirm(driver, DOUBLE_ADDR, 42.25);

    const raw = driver.readBuffer(DUMMY_HANDLE, DOUBLE_ADDR.address, 8);
    const corrupted = Buffer.from(raw);
    corrupted[0] ^= 0x01; // flip the least-significant mantissa bit
    driver.writeBuffer(DUMMY_HANDLE, DOUBLE_ADDR.address, corrupted);

    const rolledBack = await session.rollback(proposalId);
    assert.equal(rolledBack.success, false);
    assert.match(rolledBack.error ?? '', /expected_value_mismatch/);
  });

  test('one-byte mismatch (uint32) is detected and rejected', async () => {
    const U32_ADDR: LiveMemoryAddress = { address: 0x3020n, dataType: 'uint32' };
    const driver = new FakeMemoryDriver({ '12320': 10 });
    const { session, proposalId } = await attachAndConfirm(driver, U32_ADDR, 0x7fffffff);

    const raw = driver.readBuffer(DUMMY_HANDLE, U32_ADDR.address, 4);
    const corrupted = Buffer.from(raw);
    corrupted[3] = corrupted[3] ^ 0xff; // flip the whole high byte
    driver.writeBuffer(DUMMY_HANDLE, U32_ADDR.address, corrupted);

    const rolledBack = await session.rollback(proposalId);
    assert.equal(rolledBack.success, false);
    assert.match(rolledBack.error ?? '', /mismatch/);
  });

  test('NaN payload mismatch: numeric check alone would pass, byte check must reject (the documented gap this closes)', async () => {
    const DOUBLE_ADDR: LiveMemoryAddress = { address: 0x3030n, dataType: 'double' };
    const driver = new FakeMemoryDriver({ '12336': 1.5 });
    const { session, proposalId } = await attachAndConfirm(driver, DOUBLE_ADDR, NaN);

    // Sanity: Object.is(NaN, NaN) is true regardless of payload — the numeric
    // comparator alone genuinely cannot see this class of change.
    const original = driver.readBuffer(DUMMY_HANDLE, DOUBLE_ADDR.address, 8);
    const differentNaN = Buffer.from(original);
    differentNaN[0] ^= 0x01; // still a NaN bit pattern, different payload
    assert.ok(Number.isNaN(differentNaN.readDoubleLE(0)));
    assert.notEqual(differentNaN.toString('hex'), original.toString('hex'));
    driver.writeBuffer(DUMMY_HANDLE, DOUBLE_ADDR.address, differentNaN);

    const rolledBack = await session.rollback(proposalId);
    assert.equal(rolledBack.success, false, 'byte-level check must catch the payload difference the numeric check misses');
    assert.match(rolledBack.error ?? '', /expected_value_mismatch/);
  });

  test('positive zero vs negative zero: rollback rejects (both numeric Object.is and byte check concur)', async () => {
    const DOUBLE_ADDR: LiveMemoryAddress = { address: 0x3040n, dataType: 'double' };
    const driver = new FakeMemoryDriver({ '12352': 1.5 });
    const { session, proposalId } = await attachAndConfirm(driver, DOUBLE_ADDR, 0);

    driver.setValue(DOUBLE_ADDR.address, -0); // simulate something else writing negative zero
    const rolledBack = await session.rollback(proposalId);
    assert.equal(rolledBack.success, false);
    assert.match(rolledBack.error ?? '', /expected_value_mismatch|rollback_comparison_rejected/);
  });

  test('positive vs negative infinity: rollback rejects', async () => {
    const FLOAT_ADDR: LiveMemoryAddress = { address: 0x3050n, dataType: 'float' };
    const driver = new FakeMemoryDriver({ '12368': 1.5 });
    const { session, proposalId } = await attachAndConfirm(driver, FLOAT_ADDR, Infinity);

    driver.setValue(FLOAT_ADDR.address, -Infinity);
    const rolledBack = await session.rollback(proposalId);
    assert.equal(rolledBack.success, false);
    assert.match(rolledBack.error ?? '', /expected_value_mismatch/);
  });

  test('float precision boundary: Math.fround-normalized rollback still succeeds and restores exact bytes', async () => {
    const FLOAT_ADDR: LiveMemoryAddress = { address: 0x3060n, dataType: 'float' };
    const original = Math.fround(1.0000001192092896); // smallest representable step above 1 in float32
    const driver = new FakeMemoryDriver({ '12384': original });
    const { session, proposalId } = await attachAndConfirm(driver, FLOAT_ADDR, Math.fround(2.0000002384185791));

    const rolledBack = await session.rollback(proposalId);
    assert.equal(rolledBack.success, true);
    assert.equal(driver.getValue(FLOAT_ADDR.address), original);
  });

  test('double precision boundary (Number.MAX_SAFE_INTEGER as a double) rolls back exactly', async () => {
    const DOUBLE_ADDR: LiveMemoryAddress = { address: 0x3070n, dataType: 'double' };
    const driver = new FakeMemoryDriver();
    // Seed via a typed write (not the untyped constructor) so the whole-number
    // value 1 is unambiguously encoded as a double, not guessed as int64 —
    // the constructor-seeded fallback path cannot disambiguate an 8-byte
    // whole number between the two types (see fake-memory-driver.ts).
    driver.writeMemory(DUMMY_HANDLE, DOUBLE_ADDR.address, 'double', 1);
    const { session, proposalId } = await attachAndConfirm(driver, DOUBLE_ADDR, Number.MAX_SAFE_INTEGER);

    const rolledBack = await session.rollback(proposalId);
    assert.equal(rolledBack.success, true);
    assert.equal(driver.getValue(DOUBLE_ADDR.address), 1);
  });

  test('large integer boundary: uint32 max (0xFFFFFFFF) rolls back exactly', async () => {
    const U32_ADDR: LiveMemoryAddress = { address: 0x3080n, dataType: 'uint32' };
    const driver = new FakeMemoryDriver({ '12416': 0 });
    const { session, proposalId } = await attachAndConfirm(driver, U32_ADDR, 0xffffffff);

    const rolledBack = await session.rollback(proposalId);
    assert.equal(rolledBack.success, true);
    assert.equal(driver.getValue(U32_ADDR.address), 0);
  });

  test('large integer boundary: int64 rejects unsafe precision even though raw bytes were captured', async () => {
    const I64_ADDR: LiveMemoryAddress = { address: 0x3090n, dataType: 'int64' };
    const driver = new FakeMemoryDriver({ '12432': 1 });
    const { session, proposalId } = await attachAndConfirm(driver, I64_ADDR, Number.MAX_SAFE_INTEGER);

    // An intervening write pushes the current value beyond Number.MAX_SAFE_INTEGER —
    // the pre-existing unsafe-integer guard must still fail closed, independent of bytes.
    driver.setValue(I64_ADDR.address, Number.MAX_SAFE_INTEGER + 2);
    const rolledBack = await session.rollback(proposalId);
    assert.equal(rolledBack.success, false);
    assert.match(rolledBack.error ?? '', /rollback_comparison_rejected:unsafe_integer/);
  });

  test('boolean is not a supported LiveValueType — no boolean rollback path exists to test (documented, not a regression)', () => {
    // LiveValueType = 'int32' | 'uint32' | 'float' | 'double' | 'int64' | 'byte'.
    // This test exists only to make the N/A explicit in the matrix rather than
    // silently omitting the required row.
    assert.ok(true);
  });

  test('concurrent external mutation via raw writeBuffer (not just setValue) is detected', async () => {
    const BYTE_ADDR: LiveMemoryAddress = { address: 0x30a0n, dataType: 'byte' };
    const driver = new FakeMemoryDriver({ '12448': 5 });
    const { session, proposalId } = await attachAndConfirm(driver, BYTE_ADDR, 200);

    // Simulate a different actor writing raw bytes directly (bypassing the
    // numeric setValue helper entirely) — e.g. another tool's raw memory write.
    driver.writeBuffer(DUMMY_HANDLE, BYTE_ADDR.address, Buffer.from([201]));

    const rolledBack = await session.rollback(proposalId);
    assert.equal(rolledBack.success, false);
    assert.match(rolledBack.error ?? '', /mismatch/);
  });

  test('expired record cannot be rolled back, and the session remains usable afterward (no stale-entry corruption)', async () => {
    const INT32_ADDR: LiveMemoryAddress = { address: 0x30b0n, dataType: 'int32' };
    const driver = new FakeMemoryDriver({ '12464': 7 });
    const session = makeSession(driver, Array(6).fill(CLEAN_EVIDENCE));
    let simulatedNow = 1_000_000;
    session._injectNowMsForTests(() => simulatedNow);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const proposal = session.proposeWrite(INT32_ADDR, 99);
    const confirmed = await session.confirmWrite(proposal.proposalId);
    assert.equal(confirmed.success, true);

    simulatedNow += 30 * 60 * 1000 + 1;
    const expiredRollback = await session.rollback(confirmed.manifest!.proposalId);
    assert.equal(expiredRollback.success, false);
    assert.match(expiredRollback.error ?? '', /unknown, expired, or already rolled back/i);

    // A fresh cycle at the same address still works correctly afterward.
    const proposal2 = session.proposeWrite(INT32_ADDR, 55);
    const confirmed2 = await session.confirmWrite(proposal2.proposalId);
    assert.equal(confirmed2.success, true);
    const rolledBack2 = await session.rollback(confirmed2.manifest!.proposalId);
    assert.equal(rolledBack2.success, true);
    assert.equal(driver.getValue(INT32_ADDR.address), 99);
  });

  test('failed current-byte read during rollback fails closed without writing', async () => {
    const INT32_ADDR: LiveMemoryAddress = { address: 0x30c0n, dataType: 'int32' };
    const driver = new FakeMemoryDriver({ '12480': 3 });
    const { session, proposalId } = await attachAndConfirm(driver, INT32_ADDR, 88);

    // Simulate the region becoming unreadable between confirm and rollback
    // (e.g. protection changed, page freed).
    driver.addUnreadableRegion(INT32_ADDR.address, 4);

    const rolledBack = await session.rollback(proposalId);
    assert.equal(rolledBack.success, false);
    assert.match(rolledBack.error ?? '', /Unable to verify current memory (before rollback|bytes before rollback)/);
  });

  test('failed rollback write leaves the ledger entry intact for a later retry', async () => {
    class WriteBufferFailsDriver extends FakeMemoryDriver {
      writeBuffer(_handle: LiveProcessHandle, _address: bigint, _buffer: Buffer): void {
        throw new Error('Simulated writeBuffer failure');
      }
    }
    const INT32_ADDR: LiveMemoryAddress = { address: 0x30d0n, dataType: 'int32' };
    const driver = new WriteBufferFailsDriver({ '12496': 12 });
    const { session, proposalId } = await attachAndConfirm(driver, INT32_ADDR, 34);

    const rolledBack = await session.rollback(proposalId);
    assert.equal(rolledBack.success, false);
    assert.match(rolledBack.error ?? '', /Rollback write failed/);

    // Ledger entry must still exist (not deleted on a failed restore write) —
    // a retry with a *working* driver at the same logical state should be
    // possible in principle; here we just assert it wasn't silently consumed.
    const secondAttempt = await session.rollback(proposalId);
    assert.equal(secondAttempt.success, false);
    assert.match(secondAttempt.error ?? '', /Rollback write failed/, 'entry must remain for retry, not be silently dropped');
  });

  test('cleanup (detach) destroys retained rollback bytes — later rollback on the same proposalId fails', async () => {
    const INT32_ADDR: LiveMemoryAddress = { address: 0x30e0n, dataType: 'int32' };
    const driver = new FakeMemoryDriver({ '12512': 1 });
    const { session, proposalId } = await attachAndConfirm(driver, INT32_ADDR, 2);

    session.detach();

    const rolledBack = await session.rollback(proposalId);
    assert.equal(rolledBack.success, false);
    assert.match(rolledBack.error ?? '', /No process attached/);
  });

  test('cleanup (revokePendingAuthorizationsForCleanup) destroys a pending proposal\'s captured raw bytes before confirm', async () => {
    const INT32_ADDR: LiveMemoryAddress = { address: 0x30f0n, dataType: 'int32' };
    const driver = new FakeMemoryDriver({ '12528': 1 });
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE]);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const proposal = session.proposeWrite(INT32_ADDR, 2);
    session.revokePendingAuthorizationsForCleanup();

    const confirmed = await session.confirmWrite(proposal.proposalId);
    assert.equal(confirmed.success, false);
    assert.match(confirmed.error ?? '', /Unknown or expired proposal/);
    assert.equal(driver.getValue(INT32_ADDR.address), 1, 'no write should occur for a revoked proposal');
  });

  test('full ledger rejects the 51st confirm before mutation; a fresh address is unaffected afterward', async () => {
    const driver = new FakeMemoryDriver();
    const session = makeSession(driver, Array(60).fill(CLEAN_EVIDENCE));
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    for (let i = 0; i < 50; i++) {
      driver.setValue(BigInt(0x4000 + i), 0);
      const p = session.proposeWrite({ address: BigInt(0x4000 + i), dataType: 'int32' }, 1);
      const c = await session.confirmWrite(p.proposalId);
      assert.equal(c.success, true);
    }

    driver.setValue(BigInt(0x4000 + 50), 0);
    const p51 = session.proposeWrite({ address: BigInt(0x4000 + 50), dataType: 'int32' }, 1);
    const c51 = await session.confirmWrite(p51.proposalId);
    assert.equal(c51.success, false);
    assert.match(c51.error ?? '', /rollback_ledger_full/);
    assert.equal(driver.getValue(BigInt(0x4000 + 50)), 0, 'rejected 51st write must not touch memory at all');
  });

  test('failed initial write retains nothing — no ledger entry, no leaked pending raw bytes', async () => {
    class WriteMemoryFailsDriver extends FakeMemoryDriver {
      writeMemory(_handle: LiveProcessHandle, _address: bigint, _dataType: import('../../src/core/live-memory/types.js').LiveValueType, _value: number): void {
        throw new Error('Simulated writeMemory failure');
      }
    }
    const INT32_ADDR: LiveMemoryAddress = { address: 0x3100n, dataType: 'int32' };
    const driver = new WriteMemoryFailsDriver({ '12544': 1 });
    const session = makeSession(driver, [CLEAN_EVIDENCE, CLEAN_EVIDENCE]);
    await session.attach({ pid: 1234, executableName: 'demo.exe' }, true);

    const proposal = session.proposeWrite(INT32_ADDR, 2);
    const confirmed = await session.confirmWrite(proposal.proposalId);
    assert.equal(confirmed.success, false);
    assert.match(confirmed.error ?? '', /Write failed/);

    const rolledBack = await session.rollback(proposal.proposalId);
    assert.equal(rolledBack.success, false);
    assert.match(rolledBack.error ?? '', /unknown, expired, or already rolled back/i, 'no ledger entry should exist for a write that never applied');
  });
});
