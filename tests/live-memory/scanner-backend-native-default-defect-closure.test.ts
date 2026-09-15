// Phase 1 / Stage 7.3 §4/§5/§6 — proves the 1 MiB, alignment (partial —
// see the u16 gap disclosed below), and int64 shipping defects against the
// REAL PRODUCTION DEFAULT: every scan below is issued with ZERO explicit
// `live-memory-scanner-routing-mode-set` call. If the router's default ever
// regresses back to LEGACY, every assertion in this file fails loudly
// (`scan.result.backend !== 'native'` or a missing match) rather than
// silently passing — this file is the literal proof of mission §2's "no
// environment variable/config trick required."
//
// Disclosed structural gap (unchanged by this pass, not newly introduced):
// `LIVE_VALUE_TYPE` (electron/ipc-validation.ts) has no `uint16`/`int16`/
// `uint64` variant — only byte/int32/uint32/float/double/int64. Mission
// Stage 7.3 §5 asks for an unaligned u16 case and §6 asks for u64::MAX;
// neither is reachable through the real production wire at all, for any
// backend, because the wire schema itself has no such type. This is a real,
// pre-existing (doc 93/94) limitation, not something this test works around
// or hides — the ALIGNMENT and INT64 shipping defects are reported as
// PRODUCT_DEFECT_NOT_YET_CLOSED overall for exactly this reason, even
// though every case the wire CAN express is proven closed below.
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

async function withAttachedFixture<T>(fn: (ctx: { event: unknown; child: FixtureHandle }) => Promise<T>): Promise<T> {
  _clearTrustedWindowsForTests();
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'solith-native-default-test-'));
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

    // The one and only defense against a silent regression: confirm the
    // default really is NATIVE before trusting any assertion below.
    const modeCheck = await mock.__invoke('live-memory-scanner-routing-mode-get', event, undefined);
    assert.equal(modeCheck.mode, 'NATIVE', 'production default must be NATIVE with zero explicit override — Stage 7.3 §2');

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

describeReal('1 MiB shipping defect: default production route finds a real value beyond the legacy 1 MiB ceiling', async () => {
  await withAttachedFixture(async ({ event, child }) => {
    const value = parseInt(child.fields.U32_VALUE, 10);
    const scan = await mock.__invoke('live-memory-scan-first', event, { dataType: 'uint32', targetValue: value });
    assert.equal(scan.success, true, JSON.stringify(scan));
    assert.equal(scan.result.backend, 'native', 'the default production route must reach NativeScannerBackend with no override');
    assert.ok(scan.result.matches.length >= 1, 'the default route must find a value planted beyond the 1 MiB legacy readBuffer ceiling');

    // Zero-match case in the same >1 MiB region, per mission §4. A fresh
    // random value, not a memorable constant — TYPES_REGION is filled with
    // deterministic decoy noise (a wrapping-multiply formula), so a fixed
    // "nice" constant like 0x7F7F7F7F can coincidentally recur as noise.
    const absent = crypto.randomBytes(4).readUInt32LE(0);
    const noMatch = await mock.__invoke('live-memory-scan-first', event, { dataType: 'uint32', targetValue: absent });
    assert.equal(noMatch.success, true);
    assert.equal(noMatch.result.matches.length, 0, `absent value ${absent} must genuinely not be found`);
  });
});

describeReal('alignment shipping defect (u32 dimension): default production route finds a real unaligned u32 boundary value', async () => {
  await withAttachedFixture(async ({ event, child }) => {
    const value = parseInt(child.fields.BOUNDARY_U32_VALUE, 16);
    const scan = await mock.__invoke('live-memory-scan-first', event, { dataType: 'uint32', targetValue: value });
    assert.equal(scan.success, true, JSON.stringify(scan));
    assert.equal(scan.result.backend, 'native');
    assert.ok(
      scan.result.matches.length >= 1,
      'the default route must find a u32 value planted at an unaligned, chunk-boundary-straddling offset',
    );
  });
});

describeReal('alignment shipping defect (i64 dimension): default production route finds a real unaligned i64 boundary value', async () => {
  await withAttachedFixture(async ({ event, child }) => {
    // BOUNDARY_U64_VALUE = 0x0123456789ABCDEF is positive and well within
    // i64 range, so it round-trips exactly through the 'int64' wire type —
    // this is a real test of an unaligned 8-byte value via the only 8-byte
    // integer type the wire actually supports.
    const valueBigint = BigInt(child.fields.BOUNDARY_U64_VALUE).toString();
    const scan = await mock.__invoke('live-memory-scan-first', event, {
      dataType: 'int64',
      targetValue: Number(valueBigint),
      targetValueBigint: valueBigint,
    });
    assert.equal(scan.success, true, JSON.stringify(scan));
    assert.equal(scan.result.backend, 'native');
    const exact = scan.result.matches.find((m: { valueBigint?: string }) => m.valueBigint === valueBigint);
    assert.ok(exact, `the default route must find an i64 value planted at an unaligned, chunk-boundary-straddling offset: ${JSON.stringify(scan.result.matches)}`);
  });
});

describeReal('int64 shipping defect: default production route preserves exact fidelity for every mission-required i64 value', async () => {
  await withAttachedFixture(async ({ event, child }) => {
    const cases: Array<[string, bigint]> = [
      ['2^53+1', 9_007_199_254_740_993n],
      ['2^53+3', 9_007_199_254_740_995n],
      ['i64::MAX', 9_223_372_036_854_775_807n],
      ['i64::MIN', -9_223_372_036_854_775_808n],
    ];
    for (const [label, value] of cases) {
      const buf = Buffer.alloc(8);
      buf.writeBigInt64LE(value, 0);
      // Plant it fresh via the real fixture write protocol so this test is
      // self-contained and does not depend on a specific pre-planted offset.
      // eslint-disable-next-line no-await-in-loop
      await child.writeBytes(0, buf.toString('hex'));

      // eslint-disable-next-line no-await-in-loop
      const scan = await mock.__invoke('live-memory-scan-first', event, {
        dataType: 'int64',
        targetValue: Number(value),
        targetValueBigint: value.toString(),
      });
      assert.equal(scan.success, true, `${label}: ${JSON.stringify(scan)}`);
      assert.equal(scan.result.backend, 'native', `${label} must go through the default NATIVE route`);
      const exact = scan.result.matches.find((m: { valueBigint?: string }) => m.valueBigint === value.toString());
      assert.ok(exact, `${label} must be found with exact fidelity through the default production route: ${JSON.stringify(scan.result.matches)}`);
    }
  });
});
