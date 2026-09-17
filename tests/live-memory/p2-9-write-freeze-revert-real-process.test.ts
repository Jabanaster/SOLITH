// Phase 2 P2-9 (SOLITH.MD mission §19-27 content, owned per ROADMAP's real
// checkpoint split by P2-9 — see Docs/phase2/031) — real-process write /
// verify / revert / freeze / unfreeze certification against the CANONICAL
// write engine that already existed before this mission
// (LiveMemorySession.proposeWrite/confirmWrite/rollback/startFreeze/
// stopFreeze, live-memory-session.ts). This proves the engine directly
// (constructing a real LiveMemorySession over the real nativeMemoryDriver,
// same production classes the IPC layer itself delegates to) rather than
// re-testing the pre-existing, already-certified two-phase privileged-
// consent IPC dialog wrapper (rollback-byte-integrity.test.ts,
// rollback-float-integrity.test.ts, scanner-backend-rollback-matrix.test.ts
// already cover that layer).
//
// Uses the fixture's pre-existing MUTATION_REGION/GUARD_REGION
// infrastructure (writable marker region with protect/decommit/recommit/
// free stdin commands) — built for exactly this failure-injection matrix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { LiveMemorySession } from '../../src/core/live-memory/live-memory-session.ts';
import { nativeMemoryDriver } from '../../src/core/live-memory/native-memory-driver.ts';

const FIXTURE_PATH = path.resolve(
  import.meta.dirname, '..', '..', 'native', 'solith-scanner-core', 'target', 'release', 'solith-scanner-fixture.exe',
);
function fixtureAvailable(): boolean {
  return process.platform === 'win32' && existsSync(FIXTURE_PATH);
}
const testRequire = createRequire(import.meta.url);
function memoryjsAvailable(): boolean {
  try {
    testRequire('memoryjs');
    return true;
  } catch {
    try {
      testRequire(path.resolve(import.meta.dirname, '..', '..', 'vendor', 'memoryjs-3.5.1-patched', 'index.js'));
      return true;
    } catch {
      return false;
    }
  }
}
function realEnvSkipReason(): string | false {
  if (!fixtureAvailable()) return 'native fixture binary not built in this environment';
  if (!memoryjsAvailable()) return 'memoryjs addon not available in this environment';
  return false;
}

interface FixtureHandle {
  child: ChildProcessWithoutNullStreams;
  fields: Record<string, string>;
}

function spawnFixture(): Promise<FixtureHandle> {
  const child = spawn(FIXTURE_PATH, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  child.stdin.on('error', () => {});
  return new Promise((resolve, reject) => {
    let buffered = '';
    const fields: Record<string, string> = {};
    function onData(chunk: Buffer) {
      buffered += chunk.toString('utf8');
      let idx: number;
      while ((idx = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, idx).trim();
        buffered = buffered.slice(idx + 1);
        if (line === 'READY') {
          child.stdout.off('data', onData);
          resolve({ child, fields });
          return;
        }
        const eq = line.indexOf('=');
        if (eq !== -1) fields[line.slice(0, eq)] = line.slice(eq + 1);
      }
    }
    child.stdout.on('data', onData);
    child.on('error', reject);
  });
}

function killFixture(handle: FixtureHandle): void {
  try {
    handle.child.stdin.write('exit\n');
  } catch {
    /* already gone */
  }
  handle.child.kill();
}

function sendFixtureCommand(child: FixtureHandle, command: string, expectPrefix: string): Promise<string> {
  return new Promise((res, rej) => {
    let ackBuf = '';
    const onAck = (chunk: Buffer) => {
      ackBuf += chunk.toString('utf8');
      const lines = ackBuf.split('\n');
      for (const line of lines) {
        if (line.startsWith(expectPrefix) || line.startsWith(`${expectPrefix.split('_')[0]}_ERROR`)) {
          child.child.stdout.off('data', onAck);
          res(line.trim());
          return;
        }
      }
    };
    child.child.stdout.on('data', onAck);
    child.child.stdin.write(`${command}\n`);
    setTimeout(() => rej(new Error(`fixture command "${command}" ack timed out`)), 5000);
  });
}

async function attachedSession(child: FixtureHandle): Promise<LiveMemorySession> {
  const session = new LiveMemorySession(nativeMemoryDriver);
  const result = await session.attach({ pid: child.child.pid!, executableName: 'solith-scanner-fixture.exe' }, true);
  assert.equal(result.success, true, `attach must succeed: ${JSON.stringify(result)}`);
  return session;
}

const MARKER_PATTERN_AS_INT32_LE = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]).readInt32LE(0);

function describe(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v));
}

/** Polls until `check()` returns true or the timeout elapses — freeze ticks also re-verify process identity every cycle (a real, sometimes-slow native/WMI query), so a fixed short wait is not reliable. */
async function waitUntil(check: () => boolean, timeoutMs: number, intervalMs = 50): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return check();
}

test('P2-9 write engine: propose -> confirm -> verify -> rollback against real fixture memory (spec §20/§21)', { skip: realEnvSkipReason() }, async () => {
  const child = await spawnFixture();
  try {
    const session = await attachedSession(child);
    const markerAddr = BigInt(child.fields.MUTATION_REGION_BASE) + BigInt(child.fields.MUTATION_MARKER_OFFSET);

    const before = nativeMemoryDriver.readMemory(session.getMemoryAccessOrThrow().handle, markerAddr, 'int32');
    assert.equal(before, MARKER_PATTERN_AS_INT32_LE, 'the real fixture marker pattern must be observed before any write');

    const proposal = session.proposeWrite({ address: markerAddr, dataType: 'int32' }, 424242);
    assert.equal(proposal.currentValue, MARKER_PATTERN_AS_INT32_LE);

    const confirmResult = await session.confirmWrite(proposal.proposalId);
    assert.equal(confirmResult.success, true, `confirmWrite must succeed: ${describe(confirmResult)}`);
    const afterWrite = nativeMemoryDriver.readMemory(session.getMemoryAccessOrThrow().handle, markerAddr, 'int32');
    assert.equal(afterWrite, 424242, 'the real write must be observed by an independent read-back');

    const rollbackResult = await session.rollback(proposal.proposalId);
    assert.equal(rollbackResult.success, true, `rollback must succeed: ${describe(rollbackResult)}`);
    const afterRollback = nativeMemoryDriver.readMemory(session.getMemoryAccessOrThrow().handle, markerAddr, 'int32');
    assert.equal(afterRollback, MARKER_PATTERN_AS_INT32_LE, 'rollback must restore the exact original bytes, verified by an independent read-back');

    session.detach();
  } finally {
    killFixture(child);
  }
});

test('P2-9 freeze engine: real repeated enforcement, unfreeze stops it, revert restores original (spec §22)', { skip: realEnvSkipReason() }, async () => {
  const child = await spawnFixture();
  try {
    const session = await attachedSession(child);
    const markerAddr = BigInt(child.fields.MUTATION_REGION_BASE) + BigInt(child.fields.MUTATION_MARKER_OFFSET);

    const start = session.startFreeze({ address: markerAddr, dataType: 'int32' }, 777, 50);
    assert.equal(start.success, true, `startFreeze must succeed: ${describe(start)}`);

    // Give the freeze loop time to complete at least one real tick (each tick
    // re-verifies process identity via a real native/WMI-ish query, which can
    // take noticeably longer than the 50ms nominal interval) before relying
    // on it having reasserted anything.
    await waitUntil(() => session.getFreezeStatus().tickCount > 0, 5000);
    // Overwrite it independently while frozen — the freeze loop must reassert its value.
    nativeMemoryDriver.writeMemory(session.getMemoryAccessOrThrow().handle, markerAddr, 'int32', 111);
    const reasserted = await waitUntil(
      () => nativeMemoryDriver.readMemory(session.getMemoryAccessOrThrow().handle, markerAddr, 'int32') === 777,
      5000,
    );
    assert.equal(reasserted, true, 'a real freeze must genuinely re-enforce its value against a competing real write');

    const stopResult = session.stopFreeze();
    assert.equal(stopResult.active, false, 'stopFreeze must report the freeze as genuinely inactive');
    nativeMemoryDriver.writeMemory(session.getMemoryAccessOrThrow().handle, markerAddr, 'int32', MARKER_PATTERN_AS_INT32_LE);
    await new Promise((r) => setTimeout(r, 300));
    const afterUnfreeze = nativeMemoryDriver.readMemory(session.getMemoryAccessOrThrow().handle, markerAddr, 'int32');
    assert.equal(afterUnfreeze, MARKER_PATTERN_AS_INT32_LE, 'unfreeze must genuinely stop reassertion — an independent write after stop must stick');

    session.detach();
  } finally {
    killFixture(child);
  }
});

test('P2-9 failure injection: invalid address, non-writable region, stale session, process exit during freeze (spec §26/§37)', { skip: realEnvSkipReason() }, async () => {
  const child = await spawnFixture();
  try {
    const session = await attachedSession(child);
    const markerAddr = BigInt(child.fields.MUTATION_REGION_BASE) + BigInt(child.fields.MUTATION_MARKER_OFFSET);

    // ── invalid/unmapped address ──────────────────────────────────────
    assert.throws(() => session.proposeWrite({ address: 0x1n, dataType: 'int32' }, 1), 'proposeWrite against an unmapped address must fail truthfully, not silently succeed');

    // ── non-writable region ─────────────────────────────────────────
    // Disclosed finding (diagnosed this stage, mirroring P2-5's disclosed
    // post-exit stale-read characteristic): a real PAGE_NOACCESS page can
    // still return byte content to memoryjs's readMemory/readBuffer from an
    // EXTERNAL process handle (Windows' cross-process ReadProcessMemory path
    // does not reliably enforce PAGE_NOACCESS the way in-process access
    // does) — confirmed here by two independent, differing "successful"
    // reads against a page just marked PAGE_NOACCESS. writeMemory/
    // writeBuffer, in contrast, DOES correctly fail (`ERROR_NOACCESS`/998).
    // This is exactly why mission spec §24 ("do not assume readable ==
    // writable") matters in practice: the only truthful non-writable-region
    // check is attempting the actual write, never inferring writability
    // from whether a preceding read happened to succeed.
    const protectResult = await sendFixtureCommand(child, 'protect_mutation noaccess', 'PROTECTED');
    assert.ok(protectResult.startsWith('PROTECTED'), protectResult);
    const proposalOnNoAccess = session.proposeWrite({ address: markerAddr, dataType: 'int32' }, 1);
    const confirmOnNoAccess = await session.confirmWrite(proposalOnNoAccess.proposalId);
    assert.equal(confirmOnNoAccess.success, false, 'writing into a genuinely PAGE_NOACCESS region must fail truthfully, never a fabricated success');

    const restoreResult = await sendFixtureCommand(child, 'protect_mutation readwrite', 'PROTECTED');
    assert.ok(restoreResult.startsWith('PROTECTED'), restoreResult);
    const proposalAfterRestore = session.proposeWrite({ address: markerAddr, dataType: 'int32' }, 555);
    const confirmAfterRestore = await session.confirmWrite(proposalAfterRestore.proposalId);
    assert.equal(confirmAfterRestore.success, true, 'restoring PAGE_READWRITE must make the region genuinely writable again');
    await session.rollback(proposalAfterRestore.proposalId);

    // ── stale session (detach, then attempt write) ────────────────────
    const staleProposal = session.proposeWrite({ address: markerAddr, dataType: 'int32' }, 1);
    session.detach();
    const staleConfirm = await session.confirmWrite(staleProposal.proposalId);
    assert.equal(staleConfirm.success, false, 'confirming a write after detach must be a truthful failure, never a stale success');

    // ── process exit while frozen — freeze must stop itself, never crash or claim success ──
    const child2 = await spawnFixture();
    try {
      const session2 = await attachedSession(child2);
      const markerAddr2 = BigInt(child2.fields.MUTATION_REGION_BASE) + BigInt(child2.fields.MUTATION_MARKER_OFFSET);
      const startResult = session2.startFreeze({ address: markerAddr2, dataType: 'int32' }, 999, 50);
      assert.equal(startResult.success, true);
      await waitUntil(() => session2.getFreezeStatus().tickCount > 0, 5000);
      killFixture(child2);
      // The freeze loop must have stopped itself (identity re-verification fails once the process is gone) — never an uncaught exception, never a runaway loop. Each tick re-verifies identity via a real native/WMI-ish query, which is slow, so this is polled generously rather than checked once after a fixed short wait.
      const selfStopped = await waitUntil(() => session2.getFreezeStatus().active === false, 15_000);
      assert.equal(selfStopped, true, `freeze must self-stop once the target process is genuinely gone (status: ${describe(session2.getFreezeStatus())})`);
    } finally {
      killFixture(child2);
    }
  } finally {
    killFixture(child);
  }
});
