// Phase 2 P2-6 (SOLITH.MD mission §9) — real-process typed-memory-view
// certification. Spawns a genuine `solith-scanner-fixture.exe`, attaches
// and reads through the real registered `ipcMain.handle` callbacks (same
// harness as structure-discovery-real-process.test.ts — nothing below the
// IPC boundary is mocked), against the same STRUCT_REGION plant P2-5
// already certified byte-for-byte: it already has an exact known value for
// every type this stage supports (int32 sentinel, float32, u64, a real
// module-external pointer, mutable int32, raw bytes, ASCII string, an
// unaligned field) — no fixture.rs change was needed for this stage.
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
const { registerTrustedWindow, _clearTrustedWindowsForTests } = await import('../../src/core/security/trusted-sender-registry.ts');
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

async function withAttachedFixture<T>(fn: (ctx: { event: unknown; child: FixtureHandle }) => Promise<T>): Promise<T> {
  _clearTrustedWindowsForTests();
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'solith-p2-6-real-process-'));
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
    killFixture(child);
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

function realEnvSkipReason(): string | false {
  if (!fixtureAvailable()) return 'native fixture binary not built in this environment';
  if (!nativeAddonAvailable()) return 'solith-scanner-napi addon not built in this environment';
  return false;
}

const STRUCT_SENTINEL_OFFSET = 0x00;
const STRUCT_FLOAT_OFFSET = 0x04;
const STRUCT_U64_OFFSET = 0x08;
const STRUCT_POINTER_OFFSET = 0x10;
const STRUCT_MUTABLE_I32_OFFSET = 0x18;
const STRUCT_RAW_BYTES_OFFSET = 0x1c;
const STRUCT_STRING_OFFSET = 0x20;
const STRUCT_UNALIGNED_OFFSET = 0x31;

/** One full read-every-supported-type cycle against a single real, freshly-attached fixture process. */
async function runOneCycle({ event, child }: { event: unknown; child: FixtureHandle }): Promise<void> {
  const structBase = BigInt(child.fields.STRUCT_REGION_BASE);
  const secondaryBase = BigInt(child.fields.STRUCT_SECONDARY_REGION_BASE);

  // ── int32 sentinel, exact known value, signed decode ──────────────────
  const sentinelAddr = `0x${(structBase + BigInt(STRUCT_SENTINEL_OFFSET)).toString(16)}`;
  const sentinel = await mock.__invoke('typed-view:read', event, { address: sentinelAddr, length: 4 });
  assert.equal(sentinel.success, true, JSON.stringify(sentinel));
  assert.equal(sentinel.view.readState, 'complete');
  const sentinelI32 = sentinel.view.interpretationsByWidth[4].find((i: any) => i.kind === 'i32');
  assert.equal(sentinelI32.value, '-777000111', 'i32 decode must be exact against the fixture\'s known sentinel');
  const sentinelU32 = sentinel.view.interpretationsByWidth[4].find((i: any) => i.kind === 'u32');
  assert.equal(sentinelU32.value, String(0x100000000 - 777_000_111), 'the same bytes must also decode as the correct unsigned reading');

  // ── float32, exact known value ─────────────────────────────────────────
  const floatAddr = `0x${(structBase + BigInt(STRUCT_FLOAT_OFFSET)).toString(16)}`;
  const floatResult = await mock.__invoke('typed-view:read', event, { address: floatAddr, length: 4 });
  const f32 = floatResult.view.interpretationsByWidth[4].find((i: any) => i.kind === 'f32');
  assert.ok(Math.abs(Number(f32.value) - 98.6) < 0.001, `float32 decode must match the fixture's known 98.6 value, got ${f32.value}`);

  // ── u64, exact known value, no BigInt precision loss ───────────────────
  const u64Addr = `0x${(structBase + BigInt(STRUCT_U64_OFFSET)).toString(16)}`;
  const u64Result = await mock.__invoke('typed-view:read', event, { address: u64Addr, length: 8 });
  const u64 = u64Result.view.interpretationsByWidth[8].find((i: any) => i.kind === 'u64');
  assert.equal(u64.value, (0x1122_3344_5566_7788n).toString(), 'u64 must round-trip exactly, no Number() precision loss');
  const i64 = u64Result.view.interpretationsByWidth[8].find((i: any) => i.kind === 'i64');
  assert.equal(i64.value, (0x1122_3344_5566_7788n).toString(), 'this value is positive as i64 too — same exact bigint decimal string');

  // ── pointer width, exact known destination ─────────────────────────────
  const ptrAddr = `0x${(structBase + BigInt(STRUCT_POINTER_OFFSET)).toString(16)}`;
  const ptrResult = await mock.__invoke('typed-view:read', event, { address: ptrAddr, length: 8 });
  const ptr = ptrResult.view.interpretationsByWidth[8].find((i: any) => i.kind === 'pointer');
  assert.equal(BigInt(ptr.value), secondaryBase, 'the pointer reading must decode to the real secondary allocation address');

  // ── ASCII string payload, exact known text ─────────────────────────────
  const strAddr = `0x${(structBase + BigInt(STRUCT_STRING_OFFSET)).toString(16)}`;
  const strResult = await mock.__invoke('typed-view:read', event, { address: strAddr, length: 8 });
  const ascii = strResult.view.interpretationsByWidth[8].find((i: any) => i.kind === 'ascii');
  assert.ok(ascii, 'the real ASCII payload must be offered as an ascii reading');
  assert.ok(ascii.value.startsWith('StructPa'), `expected the fixture's known string text, got ${JSON.stringify(ascii.value)}`);

  // ── raw bytes, exact known pattern, hex fidelity ───────────────────────
  const rawAddr = `0x${(structBase + BigInt(STRUCT_RAW_BYTES_OFFSET)).toString(16)}`;
  const rawResult = await mock.__invoke('typed-view:read', event, { address: rawAddr, length: 4 });
  assert.equal(rawResult.view.rawHex, '0xdeadbeef', 'raw bytes must be preserved exactly, matching the fixture\'s known DEADBEEF plant');

  // ── unaligned field, exact known value ──────────────────────────────────
  const unalignedAddr = `0x${(structBase + BigInt(STRUCT_UNALIGNED_OFFSET)).toString(16)}`;
  const unalignedResult = await mock.__invoke('typed-view:read', event, { address: unalignedAddr, length: 4 });
  assert.equal(unalignedResult.view.readState, 'complete', 'an unaligned address must still read correctly');
  const unalignedI32 = unalignedResult.view.interpretationsByWidth[4].find((i: any) => i.kind === 'i32');
  assert.equal(unalignedI32.value, '-12345', 'unaligned i32 decode must be exact');

  // ── mutable field via refresh — a real live change must be observed ────
  const mutAddr = `0x${(structBase + BigInt(STRUCT_MUTABLE_I32_OFFSET)).toString(16)}`;
  const before = await mock.__invoke('typed-view:read', event, { address: mutAddr, length: 4 });
  assert.equal(before.view.interpretationsByWidth[4].find((i: any) => i.kind === 'i32').value, '42');
  const wroteAck = await new Promise<void>((res, rej) => {
    let ackBuf = '';
    const onAck = (chunk: Buffer) => {
      ackBuf += chunk.toString('utf8');
      if (/^WROTE \d+\n/.test(ackBuf) || ackBuf.includes('WROTE')) {
        child.child.stdout.off('data', onAck);
        res();
      }
    };
    child.child.stdout.on('data', onAck);
    child.child.stdin.write(`writestruct ${STRUCT_MUTABLE_I32_OFFSET} 44332211\n`);
    setTimeout(() => rej(new Error('writestruct ack timed out')), 5000);
  });
  void wroteAck;
  const after = await mock.__invoke('typed-view:refresh', event, { address: mutAddr, length: 4 });
  const afterI32 = after.view.interpretationsByWidth[4].find((i: any) => i.kind === 'i32');
  assert.equal(afterI32.value, String(0x11223344), 'refreshTypedValue must observe the real live-mutated bytes, not stale cached ones');

  // ── pure reinterpretation — no I/O, derived from already-known bytes ──
  const reinterpret = await mock.__invoke('typed-view:reinterpret', event, { rawHex: sentinel.view.rawHex });
  assert.equal(reinterpret.success, true);
  assert.equal(reinterpret.interpretationsByWidth[4].find((i: any) => i.kind === 'i32').value, '-777000111');

  // ── batch read ───────────────────────────────────────────────────────
  const batch = await mock.__invoke('typed-view:read-many', event, {
    requests: [{ address: sentinelAddr, length: 4 }, { address: floatAddr, length: 4 }],
  });
  assert.equal(batch.success, true);
  assert.equal(batch.views.length, 2);
}

test(
  'P2-6 typed memory view: real fixture, real values, every supported type, 10-restart stress (spec §9)',
  { skip: realEnvSkipReason() },
  async () => {
    const RESTARTS = 10;
    for (let restart = 1; restart <= RESTARTS; restart++) {
      await withAttachedFixture(async (ctx) => {
        await runOneCycle(ctx);
      });
    }
  },
);

test('P2-6 typed memory view: failure injection — unmapped address, oversized batch, malformed rawHex', { skip: realEnvSkipReason() }, async () => {
  await withAttachedFixture(async ({ event }) => {
    const unmapped = await mock.__invoke('typed-view:read', event, { address: '0x1', length: 4 });
    assert.equal(unmapped.success, true);
    assert.equal(unmapped.view.readState, 'failed', 'an unmapped address must be a truthful failed read state, never a fabricated value');

    const oversizedBatch = await mock.__invoke('typed-view:read-many', event, {
      requests: Array.from({ length: 200 }, () => ({ address: '0x1', length: 4 })),
    });
    assert.equal(oversizedBatch.success, false, 'a batch exceeding the schema max must be rejected, not silently truncated by the handler');

    const malformed = await mock.__invoke('typed-view:reinterpret', event, { rawHex: 'not-hex' });
    assert.equal(malformed.success, false, 'malformed raw hex must be rejected by schema validation');

    const oddLength = await mock.__invoke('typed-view:read', event, { address: '0x1000', length: 3 });
    assert.equal(oddLength.success, false, 'a length outside {1,2,4,8} must be rejected, never silently rounded');
  });
});
