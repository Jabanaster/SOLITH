// Phase 1 / Stage 7.2/7.3 §5/§22 — closes 3 of the previously-disclosed
// failure-injection gaps (doc 96 §13: invalid int64/u64 wire transport,
// closed-session reuse, double close) with real, dedicated tests through
// the real registered ipcMain.handle callbacks, rather than leaving them as
// "true by construction, not separately tested." Same harness as
// scanner-backend-ipc-real-path.test.ts.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
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

async function withAttachedFixture<T>(fn: (ctx: { event: unknown; child: FixtureHandle }) => Promise<T>): Promise<T> {
  _clearTrustedWindowsForTests();
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'solith-failinj-test-'));
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

describeReal('9 — invalid int64/u64 wire transport is rejected, structured, no crash', async () => {
  await withAttachedFixture(async ({ event }) => {
    const notADecimalString = await mock.__invoke('live-memory-scan-first', event, {
      dataType: 'int64',
      targetValue: 1,
      targetValueBigint: 'not-a-number',
    });
    assert.equal(notADecimalString.success, false, 'a non-decimal targetValueBigint must be rejected by the wire schema');

    const tooLong = await mock.__invoke('live-memory-scan-first', event, {
      dataType: 'int64',
      targetValue: 1,
      targetValueBigint: '1'.repeat(30),
    });
    assert.equal(tooLong.success, false, 'an implausibly long targetValueBigint (beyond any real i64/u64) must be rejected');

    // Session must be unharmed: a valid scan immediately afterward still works.
    const valid = await mock.__invoke('live-memory-scan-first', event, { dataType: 'uint32', targetValue: 1 });
    assert.equal(valid.success, true, 'rejected malformed int64 transport must not corrupt session state for the next valid request');
  });
});

describeReal('13 — closed-session reuse: a scan after detach is rejected, structured, no crash', async () => {
  await withAttachedFixture(async ({ event }) => {
    const detachResult = await mock.__invoke('live-memory-detach', event, undefined);
    assert.equal(detachResult.success, true);

    const afterDetach = await mock.__invoke('live-memory-scan-first', event, { dataType: 'uint32', targetValue: 1 });
    assert.equal(afterDetach.success, false, 'a scan request against a detached (closed) session must be rejected, not crash the handler');
    assert.ok(typeof afterDetach.error === 'string' && afterDetach.error.length > 0, 'the rejection must be a structured error, not a bare throw');
  });
});

describeReal('14 — double close (detach called twice) is idempotent, no crash', async () => {
  await withAttachedFixture(async ({ event }) => {
    const first = await mock.__invoke('live-memory-detach', event, undefined);
    const second = await mock.__invoke('live-memory-detach', event, undefined);
    assert.equal(first.success, true);
    assert.equal(second.success, true, 'a second detach on an already-detached session must still succeed (idempotent), not throw');
  });
});
