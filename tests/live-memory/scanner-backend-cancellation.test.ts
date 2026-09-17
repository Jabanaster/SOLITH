// Phase 1 / Stage 7.2/7.3 §2/§3/§9/§12 — real production scan cancellation,
// exercised through the actual registered `ipcMain.handle` callbacks
// (`live-memory-scan-first-start`/`live-memory-scan-aob-start`/
// `live-memory-scan-cancel`/`live-memory-scan-poll`), a real spawned
// fixture process, and the real native addon. Same harness as
// scanner-backend-ipc-real-path.test.ts (Node module-customization-hooks
// loader redirecting 'electron' to a minimal mock) — nothing below the IPC
// boundary is mocked. Skips cleanly if the fixture binary or native addon
// has not been built.
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
}

function spawnFixture(): Promise<FixtureHandle> {
  const child = spawn(FIXTURE_PATH, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  // Case H deliberately kills `child` mid-test, before the outer cleanup's
  // own `stdin.write('exit\n')` attempt — that write's EPIPE is delivered
  // asynchronously via an 'error' event, which a synchronous try/catch
  // around the write cannot catch, and previously surfaced as an uncaught
  // exception after the test had already completed. Real, expected,
  // harmless once the process is already gone — swallowed here, once, for
  // the life of this child.
  child.stdin.on('error', () => {});
  return new Promise((resolve, reject) => {
    let buffered = '';
    const fields: Record<string, string> = {};
    function onData(chunk: Buffer) {
      buffered += chunk.toString('utf8');
      let idx: number;
      // eslint-disable-next-line no-cond-assign
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

async function pollUntilTerminal(event: unknown, operationId: string, maxAttempts = 400, delayMs = 5): Promise<any> {
  for (let i = 0; i < maxAttempts; i += 1) {
    const status = await mock.__invoke('live-memory-scan-poll', event, { operationId });
    if (status.status !== 'pending') return status;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`operation ${operationId} never reached a terminal status within ${maxAttempts * delayMs}ms`);
}

async function withAttachedFixture<T>(fn: (ctx: { event: unknown; child: FixtureHandle }) => Promise<T>): Promise<T> {
  _clearTrustedWindowsForTests();
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'solith-cancel-test-'));
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

describeReal(
  'A/C/D — a real high-density exact scan can be genuinely cancelled mid-flight through the real IPC path',
  async (t) => {
    await withAttachedFixture(async ({ event }) => {
      // Default mode is NATIVE (Stage 7.3 §2) — no explicit routing-mode-set needed.
      // u32 value 0 matches extremely densely across real process memory
      // (zero padding). `maxMatches` is deliberately OMITTED here rather
      // than set to the wire's own explicit-request cap (5000, mission §10's
      // WIRE RESPONSE CAP) — an omitted maxMatches lets the BACKEND
      // COMPUTATION CAP (10,000, DEFAULT_MAX_MATCHES) apply instead, which
      // takes real, measurable wall time (proven ~9-14ms end to end through
      // this exact IPC path, doc 92) — enough of a window for a cancel fired
      // immediately after start to land while the native scan is still
      // genuinely in progress, not merely a pre-flight abort. Retried up to
      // 5 times to absorb real machine-timing variance without ever faking
      // the result.
      let observedCancelled = false;
      let lastStatus: any;
      for (let attempt = 0; attempt < 5 && !observedCancelled; attempt += 1) {
        const start = await mock.__invoke('live-memory-scan-first-start', event, {
          dataType: 'uint32',
          targetValue: 0,
        });
        assert.equal(start.success, true, JSON.stringify(start));
        assert.ok(start.operationId, 'a started operation must return a real operationId before the scan finishes');

        const cancelResult = await mock.__invoke('live-memory-scan-cancel', event, { operationId: start.operationId });
        assert.equal(cancelResult.success, true);
        assert.equal(cancelResult.found, true, 'cancelling a just-started, still-registered operation must find it');

        lastStatus = await pollUntilTerminal(event, start.operationId);
        assert.notEqual(lastStatus.status, 'pending', 'operation must reach a terminal state, never hang');
        assert.notEqual(lastStatus.status, 'error', `cancellation must never surface as an unstructured error: ${JSON.stringify(lastStatus)}`);
        if (lastStatus.status === 'cancelled') observedCancelled = true;
      }
      t.diagnostic(`final observed status after retries: ${JSON.stringify(lastStatus)}`);
      assert.ok(
        observedCancelled,
        'at least one of 5 attempts must observe a genuine cancelled terminal state — this proves cancellation reaches the real in-flight native operation, not just a pre-flight check',
      );
    });
  },
);

describeReal('B — an AOB scan can be started and cancelled through the real IPC path, no crash, no hang', async () => {
  await withAttachedFixture(async ({ event }) => {
    const start = await mock.__invoke('live-memory-scan-aob-start', event, { signature: 'DE AD C0 DE 42' });
    assert.equal(start.success, true, JSON.stringify(start));
    assert.ok(start.operationId);

    const cancelResult = await mock.__invoke('live-memory-scan-cancel', event, { operationId: start.operationId });
    assert.equal(cancelResult.success, true);
    assert.equal(cancelResult.found, true);

    const finalStatus = await pollUntilTerminal(event, start.operationId);
    // AOB's first-match search frequently completes before the cancel signal
    // is observed (a single, fast search rather than the exact-scan's
    // multi-region accumulation) — both a genuine 'cancelled' and a genuine
    // 'complete' (the scan simply finished first) are correct, honestly
    // reported outcomes; what matters is no crash, no hang, no 'error'.
    assert.notEqual(finalStatus.status, 'pending');
    assert.notEqual(finalStatus.status, 'error', JSON.stringify(finalStatus));
  });
});

describeReal('E — a duplicate cancel request on the same operation is idempotent, never throws', async () => {
  await withAttachedFixture(async ({ event }) => {
    const start = await mock.__invoke('live-memory-scan-first-start', event, {
      dataType: 'uint32',
      targetValue: 0,
    });
    assert.equal(start.success, true);

    const first = await mock.__invoke('live-memory-scan-cancel', event, { operationId: start.operationId });
    const second = await mock.__invoke('live-memory-scan-cancel', event, { operationId: start.operationId });
    assert.equal(first.success, true);
    assert.equal(second.success, true);
    assert.equal(first.found, true);
    assert.equal(second.found, true, 'a second cancel on the same ID must still find the operation, not error');

    const finalStatus = await pollUntilTerminal(event, start.operationId);
    assert.notEqual(finalStatus.status, 'pending');
    assert.notEqual(finalStatus.status, 'error');
  });
});

describeReal('F — cancelling an unknown operation ID returns found:false, does not crash the handler', async () => {
  await withAttachedFixture(async ({ event }) => {
    const unknownId = crypto.randomUUID();
    const cancelResult = await mock.__invoke('live-memory-scan-cancel', event, { operationId: unknownId });
    assert.equal(cancelResult.success, true);
    assert.equal(cancelResult.found, false, 'an operation ID this session has never issued must not be found');
  });
});

describeReal('G — cancelling an already-complete operation is safe and reports alreadyTerminal:true', async () => {
  await withAttachedFixture(async ({ event, child }) => {
    const sentinelValue = Number(child.fields.SENTINEL_VALUE);
    const start = await mock.__invoke('live-memory-scan-first-start', event, {
      dataType: 'uint32',
      targetValue: sentinelValue,
      maxMatches: 1,
    });
    assert.equal(start.success, true);

    const completed = await pollUntilTerminal(event, start.operationId);
    assert.equal(completed.status, 'complete', JSON.stringify(completed));

    const cancelResult = await mock.__invoke('live-memory-scan-cancel', event, { operationId: start.operationId });
    assert.equal(cancelResult.success, true);
    assert.equal(cancelResult.found, true, 'the operation record still exists and must be found');
    assert.equal(cancelResult.alreadyTerminal, true, 'cancelling a completed operation must report alreadyTerminal, not silently no-op unreported');
  });
});

describeReal('H — cancelling after the target process exits mid-scan does not crash or hang', async () => {
  await withAttachedFixture(async ({ event, child }) => {
    const start = await mock.__invoke('live-memory-scan-first-start', event, {
      dataType: 'uint32',
      targetValue: 0,
    });
    assert.equal(start.success, true);

    // Race: kill the real process while the scan is plausibly still running,
    // then immediately request cancellation against the same operation ID.
    child.child.kill();
    const cancelResult = await mock.__invoke('live-memory-scan-cancel', event, { operationId: start.operationId });
    assert.equal(cancelResult.success, true, 'cancelling after a process-exit race must not throw');

    const finalStatus = await pollUntilTerminal(event, start.operationId, 400, 10);
    assert.notEqual(finalStatus.status, 'pending', 'a process-exit race must still reach a terminal state, never hang forever');
  });
});
