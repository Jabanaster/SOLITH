// Gate 2.2A — real-process write/failure/freeze/rollback verification.
// Run: PATH=<node22>:$PATH node <tsx-cli> this-file.mts
//
// Every assertion below runs against the REAL rebuilt vendored memoryjs
// addon and the REAL Gate 2.2 fixture process (tests/fixtures/gate2-2-memory-fixture),
// via the project's actual nativeMemoryDriver and LiveMemorySession — not
// FakeMemoryDriver, and not a raw Win32 bypass (the raw memoryjs binding is
// used only for the read-only-handle comparison test, per authorization).
import { spawn, ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'os';
import { createRequire } from 'node:module';
import { nativeMemoryDriver } from '../../../../../src/core/live-memory/native-memory-driver.ts';
import { LiveMemorySession } from '../../../../../src/core/live-memory/live-memory-session.ts';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '../../../../../');
const FIXTURE_EXE = path.join(ROOT, 'tests/fixtures/gate2-2-memory-fixture/bin/Release/net9.0/Gate2_2Fixture.exe');

let passCount = 0;
let failCount = 0;
const results: { name: string; status: 'PASS' | 'FAIL'; detail?: string }[] = [];

function record(name: string, ok: boolean, detail?: string): void {
  results.push({ name, status: ok ? 'PASS' : 'FAIL', detail });
  if (ok) passCount++; else failCount++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function safeStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v));
}

interface FixtureHandle {
  child: ChildProcess;
  statusPath: string;
  stopPath: string;
  mutatePath: string;
}

function readStatus(statusPath: string): { pid: number; addressHex: string; value: number } {
  // The fixture's own status-file write (File.WriteAllText) is not atomic
  // with respect to a concurrent read; retry briefly on a transient
  // partial-read rather than treating it as a verification failure.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      return JSON.parse(readFileSync(statusPath, 'utf8'));
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function spawnFixture(): Promise<FixtureHandle> {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const statusPath = path.join(os.tmpdir(), `gate2-2a-status-${runId}.json`);
  const stopPath = path.join(os.tmpdir(), `gate2-2a-stop-${runId}.stop`);
  const mutatePath = path.join(os.tmpdir(), `gate2-2a-mutate-${runId}.txt`);
  const child = spawn(FIXTURE_EXE, [statusPath, stopPath, mutatePath], { stdio: 'ignore', windowsHide: true });
  await sleep(500);
  return { child, statusPath, stopPath, mutatePath };
}

function stopFixture(f: FixtureHandle): void {
  try { writeFileSync(f.stopPath, ''); } catch { /* best-effort */ }
}

async function killAndCleanup(f: FixtureHandle): Promise<void> {
  stopFixture(f);
  await sleep(500);
  if (f.child.pid && !f.child.killed) {
    try { process.kill(f.child.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  for (const p of [f.statusPath, f.stopPath, f.mutatePath]) {
    try { unlinkSync(p); } catch { /* best-effort */ }
  }
}

async function main(): Promise<void> {
  if (!existsSync(FIXTURE_EXE)) {
    console.error(`FAIL: fixture exe not found at ${FIXTURE_EXE}`);
    process.exitCode = 1;
    return;
  }

  // ── Failure test 1: invalid PID ─────────────────────────────────────────
  try {
    nativeMemoryDriver.openProcess(999999);
    record('invalid PID is rejected', false, 'expected openProcess to throw for a non-existent PID');
  } catch {
    record('invalid PID is rejected', true);
  }

  // ── Failure test 2: process exits before write ──────────────────────────
  {
    const f = await spawnFixture();
    const status = readStatus(f.statusPath);
    const handle = nativeMemoryDriver.openProcess(status.pid);
    await killAndCleanup(f);
    await sleep(300);
    try {
      nativeMemoryDriver.writeMemory(handle, BigInt(status.addressHex), 'int32', 1);
      record('write after process exit is rejected', false, 'expected writeMemory to throw after the target process exited');
    } catch {
      record('write after process exit is rejected', true);
    }
  }

  // ── Failure test 3: read-only handle cannot write (proves access-rights fix) ─
  {
    const f = await spawnFixture();
    try {
      const status = readStatus(f.statusPath);
      const memoryjs = require('../../../../../vendor/memoryjs-3.5.1-patched/index.js');
      const readOnlyHandle = memoryjs.openProcess(status.pid); // no writable flag => read-only, per Gate 2.2A fix
      let threw = false;
      try {
        memoryjs.writeMemory(readOnlyHandle.handle, parseInt(status.addressHex, 16), 999999, 'int32');
      } catch {
        threw = true;
      }
      await sleep(300);
      const after = readStatus(f.statusPath);
      const valueUnchanged = after.value === status.value;
      record(
        'write via read-only handle fails closed (no silent success)',
        threw && valueUnchanged,
        `threw=${threw}, valueUnchanged=${valueUnchanged} (before=${status.value}, after=${after.value})`,
      );
    } finally {
      await killAndCleanup(f);
    }
  }

  // ── Failure test 4: invalid/unmapped address ────────────────────────────
  {
    const f = await spawnFixture();
    try {
      const status = readStatus(f.statusPath);
      const handle = nativeMemoryDriver.openProcess(status.pid);
      try {
        nativeMemoryDriver.writeMemory(handle, 0x1n, 'int32', 42);
        record('write to unmapped address is rejected', false, 'expected writeMemory to throw for address 0x1');
      } catch {
        record('write to unmapped address is rejected', true);
      }
    } finally {
      await killAndCleanup(f);
    }
  }

  // ── Real-process direct write (re-proof after fix) ──────────────────────
  {
    const f = await spawnFixture();
    try {
      const before = readStatus(f.statusPath);
      const handle = nativeMemoryDriver.openProcess(before.pid);
      const address = BigInt(before.addressHex);
      const readBack = nativeMemoryDriver.readMemory(handle, address, 'int32');
      nativeMemoryDriver.writeMemory(handle, address, 'int32', 555222);
      await sleep(400);
      const after = readStatus(f.statusPath);
      record('real direct write lands via nativeMemoryDriver', readBack === before.value && after.value === 555222,
        `readBack=${readBack}, before=${before.value}, after=${after.value}`);

      // Restore original value and confirm restoration is observed.
      nativeMemoryDriver.writeMemory(handle, address, 'int32', before.value);
      await sleep(400);
      const restored = readStatus(f.statusPath);
      record('restore-to-original write lands', restored.value === before.value, `restored=${restored.value}, expected=${before.value}`);
    } finally {
      await killAndCleanup(f);
    }
  }

  // ── Freeze verification (real LiveMemorySession + real driver + fixture) ─
  {
    const f = await spawnFixture();
    try {
      const status = readStatus(f.statusPath);
      const session = new LiveMemorySession(nativeMemoryDriver);
      session._injectRemoteConnectionObserver(async () => ({
        availability: 'available', remoteConnectionCount: 0, observedAt: new Date().toISOString(),
      }));

      const attachResult = await session.attach({ pid: status.pid, executableName: 'Gate2_2Fixture.exe' }, true);
      if (!attachResult.success) {
        record('freeze scenario: attach', false, safeStringify(attachResult));
      } else {
        const address = { address: BigInt(status.addressHex), dataType: 'int32' as const };
        const FROZEN_VALUE = 111222;
        const proposal = session.proposeFreeze(address, FROZEN_VALUE, 150);
        const started = session.startFreezeConfirmed(proposal.proposalId);
        record('freeze starts', started.success === true, safeStringify(started));

        // First tick's identity re-verification computes a real exe SHA256
        // (subprocess-based on Windows), which is far slower than the freeze
        // interval itself — allow generous headroom before treating this as
        // a failure.
        await sleep(2500);
        const afterStart = readStatus(f.statusPath);
        record('freeze applies frozen value', afterStart.value === FROZEN_VALUE, `value=${afterStart.value}`);

        // Simulate an external actor (e.g. game logic) changing the value.
        writeFileSync(f.mutatePath, String(999888));
        await sleep(150); // give the fixture time to apply the mutation before the next freeze tick
        await sleep(300); // then let the next freeze tick restore it
        const afterMutateAndTick = readStatus(f.statusPath);
        record('freeze restores value after external mutation', afterMutateAndTick.value === FROZEN_VALUE,
          `value=${afterMutateAndTick.value}`);

        session.stopFreeze();
        writeFileSync(f.mutatePath, String(777333));
        await sleep(400);
        const afterStop = readStatus(f.statusPath);
        record('freeze no longer writes after stop', afterStop.value === 777333, `value=${afterStop.value}`);
      }
      session.stopFreezeForCleanup();
    } finally {
      await killAndCleanup(f);
    }
  }

  // ── Rollback verification (real session + real driver + fixture) ───────
  {
    const f = await spawnFixture();
    try {
      const status = readStatus(f.statusPath);
      const session = new LiveMemorySession(nativeMemoryDriver);
      session._injectRemoteConnectionObserver(async () => ({
        availability: 'available', remoteConnectionCount: 0, observedAt: new Date().toISOString(),
      }));
      const attachResult = await session.attach({ pid: status.pid, executableName: 'Gate2_2Fixture.exe' }, true);
      if (!attachResult.success) {
        record('rollback scenario: attach', false, safeStringify(attachResult));
      } else {
        const address = { address: BigInt(status.addressHex), dataType: 'int32' as const };
        const proposal = session.proposeWrite(address, 333444);
        const confirmed = await session.confirmWrite(proposal.proposalId);
        record('rollback scenario: confirmWrite succeeds', confirmed.success === true, safeStringify(confirmed));

        await sleep(300);
        const afterWrite = readStatus(f.statusPath);
        record('rollback scenario: write landed', afterWrite.value === 333444, `value=${afterWrite.value}`);

        const rollbackResult = await session.rollback(proposal.proposalId);
        record('rollback succeeds', rollbackResult.success === true, safeStringify(rollbackResult));

        await sleep(300);
        const afterRollback = readStatus(f.statusPath);
        record('rollback restores original value', afterRollback.value === status.value,
          `value=${afterRollback.value}, expected=${status.value}`);

        // Rollback must be single-use: a second attempt must fail, not repeat.
        const secondRollback = await session.rollback(proposal.proposalId);
        record('rollback is single-use (no replay)', secondRollback.success === false, safeStringify(secondRollback));
      }
      session.stopFreezeForCleanup();
    } finally {
      await killAndCleanup(f);
    }
  }

  // ── Rollback rejection after external mutation ──────────────────────────
  {
    const f = await spawnFixture();
    try {
      const status = readStatus(f.statusPath);
      const session = new LiveMemorySession(nativeMemoryDriver);
      session._injectRemoteConnectionObserver(async () => ({
        availability: 'available', remoteConnectionCount: 0, observedAt: new Date().toISOString(),
      }));
      const attachResult = await session.attach({ pid: status.pid, executableName: 'Gate2_2Fixture.exe' }, true);
      if (!attachResult.success) {
        record('rollback-rejection scenario: attach', false, safeStringify(attachResult));
      } else {
        const address = { address: BigInt(status.addressHex), dataType: 'int32' as const };
        const proposal = session.proposeWrite(address, 222111);
        const confirmed = await session.confirmWrite(proposal.proposalId);
        record('rollback-rejection scenario: confirmWrite succeeds', confirmed.success === true, safeStringify(confirmed));
        await sleep(300);

        // Independent external change after the confirmed write, before rollback.
        writeFileSync(f.mutatePath, String(444555));
        await sleep(300);

        const rollbackResult = await session.rollback(proposal.proposalId);
        record('rollback refuses to clobber an intervening external change', rollbackResult.success === false,
          safeStringify(rollbackResult));

        await sleep(200);
        const finalStatus = readStatus(f.statusPath);
        record('value after refused rollback remains the external mutation (not silently overwritten)',
          finalStatus.value === 444555, `value=${finalStatus.value}`);
      }
      session.stopFreezeForCleanup();
    } finally {
      await killAndCleanup(f);
    }
  }

  console.log(`\n${passCount}/${passCount + failCount} passed`);
  if (failCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
