// Phase 1 / Stage 7.2/7.3 §4/§11 — the complete 8-case rollback matrix,
// proven against the REAL production default (NATIVE, Stage 7.3 §2), all
// through the real registered ipcMain.handle callbacks against a real
// spawned fixture process. Same harness as scanner-backend-ipc-real-path.test.ts
// (Node module-customization-hooks loader redirecting 'electron' to a
// minimal mock) — nothing below the IPC boundary is mocked.
//
// Each case's "prove LEGACY operates normally after rollback" step searches
// for a value freshly planted (via the fixture's real `write <offset> <hex>`
// stdin protocol) inside REFINE_REGION (64 KiB) rather than TYPES_REGION
// (4 MiB): TYPES_REGION exceeds `native-memory-driver.ts`'s real 1 MiB
// `readBuffer` ceiling (native-memory-driver.ts:361), so LEGACY structurally
// cannot read it at all — that IS the real 1 MiB shipping defect this
// migration exists to fix, not a test bug. Using a TYPES_REGION value here
// would make every case wrongly look like a LEGACY rollback failure when it
// is actually LEGACY correctly, honestly exhibiting its own known limit.
// REFINE_REGION is real, genuinely reachable by LEGACY, and lets "legacy
// operates normally" mean "legacy actually finds a real value it is
// structurally capable of finding" rather than merely "does not crash."
//
// Case 8 (native backend/addon failure) is deliberately NOT duplicated
// here: it is already proven, honestly, at the router level in
// scanner-backend-router.test.ts's "rollback after a native error:
// switching to LEGACY immediately stops native from being called again" —
// a real (synthetic-injected) native throw followed by a real
// setMode('LEGACY') and a real subsequent successful call. Re-deriving the
// same evidence with a real corrupted `.node` file is out of scope for this
// pass (doc 96's existing, disclosed limitation) — see
// 103-stage7-complete-rollback-matrix.md for the full 8-row table and citations.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

register(new URL('./fixtures/electron-loader.mjs', import.meta.url));

const mock = await import('./fixtures/electron-ipc-mock.mjs');
const { registerTrustedWindow, _clearTrustedWindowsForTests } = await import(
  '../../src/core/security/trusted-sender-registry.ts'
);
const ipcModule = await import('../../electron/live-memory-ipc.ts');
const { initDatabase } = await import('../../src/core/database/index.ts');

const FIXTURE_PATH = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'native',
  'solith-scanner-core',
  'target',
  'release',
  'solith-scanner-fixture.exe',
);

function fixtureAvailable(): boolean {
  return process.platform === 'win32' && existsSync(FIXTURE_PATH);
}

const testRequire = createRequire(import.meta.url);
function nativeAddonAvailable(): boolean {
  try {
    testRequire('solith-scanner-napi');
    return true;
  } catch {
    return false;
  }
}

interface FixtureHandle {
  child: ChildProcessWithoutNullStreams;
  fields: Record<string, string>;
  /** Writes exact little-endian bytes at `offset` within REFINE_REGION via the fixture's real stdin protocol; resolves once the fixture confirms `WROTE <offset>`. */
  writeBytes: (offset: number, leHex: string) => Promise<void>;
}

function spawnFixture(): Promise<FixtureHandle> {
  const child = spawn(FIXTURE_PATH, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    let buffered = '';
    const fields: Record<string, string> = {};
    const pendingWrites: Array<{ offset: number; resolve: () => void; reject: (e: Error) => void }> = [];

    function onData(chunk: Buffer) {
      buffered += chunk.toString('utf8');
      let idx: number;
      // eslint-disable-next-line no-cond-assign
      while ((idx = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, idx).trim();
        buffered = buffered.slice(idx + 1);
        if (line === 'READY') {
          child.stdout.off('data', onData);
          child.stdout.on('data', onWriteAckData);
          resolve({ child, fields, writeBytes });
          return;
        }
        const eq = line.indexOf('=');
        if (eq !== -1) fields[line.slice(0, eq)] = line.slice(eq + 1);
      }
    }

    let ackBuffered = '';
    function onWriteAckData(chunk: Buffer) {
      ackBuffered += chunk.toString('utf8');
      let idx: number;
      // eslint-disable-next-line no-cond-assign
      while ((idx = ackBuffered.indexOf('\n')) !== -1) {
        const line = ackBuffered.slice(0, idx).trim();
        ackBuffered = ackBuffered.slice(idx + 1);
        const wroteMatch = /^WROTE (\d+)$/.exec(line);
        const pending = pendingWrites.shift();
        if (!pending) continue;
        if (wroteMatch && Number(wroteMatch[1]) === pending.offset) {
          pending.resolve();
        } else {
          pending.reject(new Error(`unexpected fixture response to write: ${line}`));
        }
      }
    }

    function writeBytes(offset: number, leHex: string): Promise<void> {
      return new Promise((res, rej) => {
        pendingWrites.push({ offset, resolve: res, reject: rej });
        child.stdin.write(`write ${offset} ${leHex}\n`);
      });
    }

    child.stdout.on('data', onData);
    child.on('error', reject);
  });
}

let nextSenderId = 1;

function makeTrustedEvent() {
  const id = nextSenderId++;
  registerTrustedWindow({ webContentsId: id, windowType: 'main', allowedUrlPrefixes: ['file:///app/dist/index.html'] });
  const mainFrame = { url: 'file:///app/dist/index.html#/trainer' };
  const sender = {
    id,
    isDestroyed: () => false,
    mainFrame,
    once: (_event: string, _listener: () => void) => {},
    on: (_event: string, _listener: (...args: unknown[]) => void) => {},
  };
  return { sender, senderFrame: mainFrame } as any;
}

const describeReal = fixtureAvailable() && nativeAddonAvailable() ? test : test.skip;

/** Plants a fresh, random, non-zero u32 at REFINE_REGION offset 0 and returns its decimal value. */
async function plantLegacyReachableValue(child: FixtureHandle): Promise<number> {
  const value = crypto.randomBytes(4).readUInt32LE(0) || 1;
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value, 0);
  await child.writeBytes(0, buf.toString('hex'));
  return value;
}

async function withAttachedFixture<T>(fn: (ctx: { event: unknown; child: FixtureHandle }) => Promise<T>): Promise<T> {
  _clearTrustedWindowsForTests();
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'solith-rollback-test-'));
  mock.__setUserDataDir(userDataDir);
  await initDatabase();
  ipcModule.registerLiveMemoryIpc();
  const child = await spawnFixture();
  try {
    const event = makeTrustedEvent();
    const attachResult = await mock.__invoke('live-memory-attach', event, {
      pid: child.child.pid!,
      executableName: 'solith-scanner-fixture.exe',
      userConfirmedOffline: true,
    });
    assert.equal(attachResult.success, true, `attach must succeed: ${JSON.stringify(attachResult)}`);
    return await fn({ event, child });
  } finally {
    try {
      child.child.stdin.write('exit\n');
    } catch {
      /* already gone */
    }
    child.child.kill();
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function assertLegacyRollbackWorks(event: unknown, legacyReachableValue: number): Promise<void> {
  const setLegacy = await mock.__invoke('live-memory-scanner-routing-mode-set', event, { mode: 'LEGACY' });
  assert.equal(setLegacy.success, true);
  assert.equal(setLegacy.mode, 'LEGACY');
  const legacyScan = await mock.__invoke('live-memory-scan-first', event, { dataType: 'uint32', targetValue: legacyReachableValue });
  assert.equal(legacyScan.success, true, `a new scan must succeed under LEGACY after rollback: ${JSON.stringify(legacyScan)}`);
  assert.equal(legacyScan.result.backend, 'legacy');
  assert.ok(
    legacyScan.result.matches.length >= 1,
    `legacy must find its own genuinely-reachable planted value normally after rollback: ${JSON.stringify(legacyScan.result)}`,
  );

  const setNativeAgain = await mock.__invoke('live-memory-scanner-routing-mode-set', event, { mode: 'NATIVE' });
  assert.equal(setNativeAgain.success, true);
  assert.equal(setNativeAgain.mode, 'NATIVE', 'switching back to NATIVE after rollback must also work — no corrupted routing state');
}

describeReal('1 — successful native exact scan, then rollback to LEGACY, then back to NATIVE', async () => {
  await withAttachedFixture(async ({ event, child }) => {
    // Default mode is NATIVE (Stage 7.3 §2) — no explicit set needed.
    // U32_VALUE lives in TYPES_REGION (4 MiB) — beyond LEGACY's structural
    // reach, so only NATIVE is expected to find it here.
    const value = parseInt(child.fields.U32_VALUE, 10);
    const scan = await mock.__invoke('live-memory-scan-first', event, { dataType: 'uint32', targetValue: value });
    assert.equal(scan.success, true, JSON.stringify(scan));
    assert.equal(scan.result.backend, 'native');
    assert.ok(scan.result.matches.length >= 1, 'NATIVE must find the real planted aligned u32 value beyond LEGACY\'s 1 MiB reach');

    const legacyValue = await plantLegacyReachableValue(child);
    await assertLegacyRollbackWorks(event, legacyValue);
  });
});

describeReal('2 — successful native AOB scan, then rollback to LEGACY, then back to NATIVE', async () => {
  await withAttachedFixture(async ({ event, child }) => {
    const aob = await mock.__invoke('live-memory-scan-aob', event, { signature: 'DE AD C0 DE 42' });
    assert.equal(aob.success, true, JSON.stringify(aob));
    assert.equal(aob.found, true);
    assert.equal(aob.backend, 'native');

    const legacyValue = await plantLegacyReachableValue(child);
    await assertLegacyRollbackWorks(event, legacyValue);
  });
});

describeReal('3 — invalid primitive input under NATIVE, session survives, rollback to LEGACY still works', async () => {
  await withAttachedFixture(async ({ event, child }) => {
    const invalid = await mock.__invoke('live-memory-scan-first', event, { dataType: 'not_a_real_type', targetValue: 1 });
    assert.equal(invalid.success, false, 'an invalid primitive type must be rejected, not silently coerced or crash the handler');

    // Session must be unharmed: a valid NATIVE scan immediately afterward still works.
    const value = parseInt(child.fields.U32_VALUE, 10);
    const validScan = await mock.__invoke('live-memory-scan-first', event, { dataType: 'uint32', targetValue: value });
    assert.equal(validScan.success, true, 'a rejected invalid-type request must not corrupt session state for the next valid request');
    assert.equal(validScan.result.backend, 'native');

    const legacyValue = await plantLegacyReachableValue(child);
    await assertLegacyRollbackWorks(event, legacyValue);
  });
});

describeReal('4 — malformed AOB under NATIVE, session survives, rollback to LEGACY still works', async () => {
  await withAttachedFixture(async ({ event, child }) => {
    const malformed = await mock.__invoke('live-memory-scan-aob', event, { signature: 'ZZ' });
    assert.equal(malformed.success, false, 'a malformed AOB signature must be rejected');

    const aobAfter = await mock.__invoke('live-memory-scan-aob', event, { signature: 'DE AD C0 DE 42' });
    assert.equal(aobAfter.success, true, 'session must survive a rejected malformed AOB request unharmed');
    assert.equal(aobAfter.found, true);

    const legacyValue = await plantLegacyReachableValue(child);
    await assertLegacyRollbackWorks(event, legacyValue);
  });
});

describeReal('5 — cancelled scan under NATIVE, then rollback to LEGACY, then back to NATIVE', async () => {
  await withAttachedFixture(async ({ event, child }) => {
    const start = await mock.__invoke('live-memory-scan-first-start', event, { dataType: 'uint32', targetValue: 0 });
    assert.equal(start.success, true);
    const cancelResult = await mock.__invoke('live-memory-scan-cancel', event, { operationId: start.operationId });
    assert.equal(cancelResult.success, true);
    assert.equal(cancelResult.found, true);

    // Drain to terminal before touching routing mode, so the cancelled
    // operation's own async tail cannot race with the rollback below.
    for (let i = 0; i < 400; i += 1) {
      const status = await mock.__invoke('live-memory-scan-poll', event, { operationId: start.operationId });
      if (status.status !== 'pending') break;
      await new Promise((r) => setTimeout(r, 5));
    }

    const legacyValue = await plantLegacyReachableValue(child);
    await assertLegacyRollbackWorks(event, legacyValue);
  });
});

describeReal('6 — target process exits mid-NATIVE-scan; a freshly attached process then proves LEGACY operates normally', async () => {
  // A dead process cannot be scanned again under any backend, so "prove
  // LEGACY operates normally after this scenario" is proven against a
  // second, freshly spawned process rather than the one that just exited —
  // an explicit, disclosed adaptation of the literal 8-case template to
  // physical reality, not a weakened proof (doc 103 documents this).
  const dying = await spawnFixture();
  _clearTrustedWindowsForTests();
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'solith-rollback-exit-test-'));
  mock.__setUserDataDir(userDataDir);
  await initDatabase();
  ipcModule.registerLiveMemoryIpc();
  const event = makeTrustedEvent();
  try {
    const attach = await mock.__invoke('live-memory-attach', event, {
      pid: dying.child.pid!,
      executableName: 'solith-scanner-fixture.exe',
      userConfirmedOffline: true,
    });
    assert.equal(attach.success, true);

    const start = await mock.__invoke('live-memory-scan-first-start', event, { dataType: 'uint32', targetValue: 0 });
    assert.equal(start.success, true);
    dying.child.kill();
    let terminalStatus: any;
    for (let i = 0; i < 400; i += 1) {
      terminalStatus = await mock.__invoke('live-memory-scan-poll', event, { operationId: start.operationId });
      if (terminalStatus.status !== 'pending') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.notEqual(terminalStatus.status, 'pending', 'a process-exit mid-scan must reach a terminal state, never hang');

    await mock.__invoke('live-memory-detach', event, undefined);
  } finally {
    try {
      dying.child.stdin.write('exit\n');
    } catch {
      /* already gone */
    }
    dying.child.kill();
  }

  const fresh = await spawnFixture();
  try {
    const attach2 = await mock.__invoke('live-memory-attach', event, {
      pid: fresh.child.pid!,
      executableName: 'solith-scanner-fixture.exe',
      userConfirmedOffline: true,
    });
    assert.equal(attach2.success, true, 'a fresh attach after a prior target-exit scenario must succeed cleanly');

    const legacyValue = await plantLegacyReachableValue(fresh);
    await assertLegacyRollbackWorks(event, legacyValue);
  } finally {
    try {
      fresh.child.stdin.write('exit\n');
    } catch {
      /* already gone */
    }
    fresh.child.kill();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

describeReal('7 — resource limit under NATIVE, then rollback to LEGACY, then back to NATIVE', async () => {
  await withAttachedFixture(async ({ event, child }) => {
    const bounded = await mock.__invoke('live-memory-scan-first', event, { dataType: 'uint32', targetValue: 0, maxMatches: 1 });
    assert.equal(bounded.success, true, JSON.stringify(bounded));
    assert.equal(bounded.result.backend, 'native');
    assert.equal(bounded.result.matches.length, 1, 'an explicit maxMatches:1 request against a densely-matching value must be capped at exactly 1');
    assert.equal(bounded.result.truncated, true, 'hitting an explicit result cap must be honestly reported as truncated (resource_limit)');

    const legacyValue = await plantLegacyReachableValue(child);
    await assertLegacyRollbackWorks(event, legacyValue);
  });
});
