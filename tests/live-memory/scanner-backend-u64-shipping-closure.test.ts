// Phase 1 / Stage 7.4 §2/§4 — proves exact u64 transport end-to-end through
// the real production IPC path (application/preload shape -> IPC validation
// -> main handler -> scanner facade -> NativeScannerBackend -> napi -> Rust
// -> result -> IPC -> preload consumer shape), for mission §2's exact 5
// required values, plus u64::MAX (mission §4). Each value is written at
// runtime into REFINE_REGION (64 KiB, legacy-reachable, real Windows memory)
// via the fixture's real `write <offset> <hex_le_bytes>` stdin protocol —
// these are arbitrary mission-specified values, not values the fixture
// happens to already have planted at build time.
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
  import.meta.dirname, '..', '..', 'native', 'solith-scanner-core', 'target', 'release', 'solith-scanner-fixture.exe',
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
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'solith-u64-test-'));
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

function u64ToLeHex(value: bigint): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value, 0);
  return buf.toString('hex');
}

// Mission §2's exact 5 required values, plus mission §4's explicit u64::MAX
// re-emphasis (already covered by the last entry — kept as one list per
// mission's own combined framing of §2/§4).
const REQUIRED_U64_VALUES: bigint[] = [
  9007199254740993n, // 2^53 + 1
  9007199254740995n, // 2^53 + 3
  9223372036854775808n, // 2^63 (i64::MAX + 1 — not representable as i64 at all)
  18446744073709551614n, // u64::MAX - 1
  18446744073709551615n, // u64::MAX
];

let nextRefineOffset = 0;
function allocateRefineOffset(): number {
  const offset = nextRefineOffset;
  nextRefineOffset += 8;
  return offset;
}

for (const value of REQUIRED_U64_VALUES) {
  describeReal(`u64 value ${value} round-trips exactly through the full production shipping path, zero override`, async () => {
    await withAttachedFixture(async ({ event, child }) => {
      const modeResult = await mock.__invoke('live-memory-scanner-routing-mode-get', event, {});
      assert.equal(modeResult.mode, 'NATIVE', 'a fresh session must default to NATIVE with zero override');

      const offset = allocateRefineOffset();
      await child.writeBytes(offset, u64ToLeHex(value));

      const result = await mock.__invoke('live-memory-scan-first', event, {
        dataType: 'u64',
        targetValue: Number(value), // best-effort display value only, deliberately imprecise above 2^53
        targetValueBigint: value.toString(),
      });
      assert.equal(result.success, true, `scan must succeed: ${JSON.stringify(result)}`);
      assert.equal(result.result.backend, 'native');

      const expectedAddress = BigInt(child.fields.REFINE_REGION_BASE) + BigInt(offset);
      const match = result.result.matches.find((m: any) => BigInt(m.address) === expectedAddress);
      assert.ok(
        match,
        `expected an exact u64 match at REFINE_REGION+${offset} (0x${expectedAddress.toString(16)}) for value ${value}; got ${JSON.stringify(result.result.matches).slice(0, 500)}`,
      );
      assert.equal(match.valueBigint, value.toString(), 'no truncation, no overflow, no sign confusion — the exact decimal string must round-trip');
    });
  });
}

// A near-miss value (off by one) must NOT match — proves this isn't a
// scan that finds everything indiscriminately.
describeReal('a u64 value one off from the planted value does not spuriously match', async () => {
  await withAttachedFixture(async ({ event, child }) => {
    const offset = allocateRefineOffset();
    const planted = 18446744073709551615n; // u64::MAX
    await child.writeBytes(offset, u64ToLeHex(planted));

    const result = await mock.__invoke('live-memory-scan-first', event, {
      dataType: 'u64',
      targetValue: Number(planted - 1n),
      targetValueBigint: (planted - 1n).toString(),
    });
    assert.equal(result.success, true);
    const expectedAddress = BigInt(child.fields.REFINE_REGION_BASE) + BigInt(offset);
    const match = result.result.matches.find((m: any) => BigInt(m.address) === expectedAddress);
    assert.equal(match, undefined, 'u64::MAX - 1 must not match a planted u64::MAX');
  });
});
