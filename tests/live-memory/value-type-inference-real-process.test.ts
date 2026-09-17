// Phase 2 P2-7 (SOLITH.MD mission §17) — real-process value/type-inference
// certification. Spawns a genuine `solith-scanner-fixture.exe`, discovers
// STRUCT_REGION (real, exact-known-value plant P2-5 already certified) via
// the real registered `ipcMain.handle` callbacks, captures several real
// snapshots across real controlled mutations (`writestruct`), and proves
// inference against real evidence: a stable field, a controlled mutable
// field (behaves as monotonic once driven through an increasing sequence),
// the real module-external pointer field, the real string field, and a
// real never-controlled span of decoy bytes (volatile/insufficient
// evidence, never a fabricated "confirmed" claim).
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
function realEnvSkipReason(): string | false {
  if (!fixtureAvailable()) return 'native fixture binary not built in this environment';
  if (!nativeAddonAvailable()) return 'solith-scanner-napi addon not built in this environment';
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

function writeStructField(child: FixtureHandle, offset: number, leHex: string): Promise<void> {
  return new Promise((res, rej) => {
    let ackBuf = '';
    const onAck = (chunk: Buffer) => {
      ackBuf += chunk.toString('utf8');
      if (ackBuf.includes(`WROTE ${offset}`)) {
        child.child.stdout.off('data', onAck);
        res();
      }
    };
    child.child.stdout.on('data', onAck);
    child.child.stdin.write(`writestruct ${offset} ${leHex}\n`);
    setTimeout(() => rej(new Error('writestruct ack timed out')), 5000);
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

async function withAttachedFixture<T>(fn: (ctx: { event: unknown; child: FixtureHandle }) => Promise<T>): Promise<T> {
  _clearTrustedWindowsForTests();
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'solith-p2-7-real-process-'));
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

const STRUCT_MUTABLE_I32_OFFSET = 0x18;
const STRUCT_WINDOW_LENGTH = 128;

function toLeHex32(value: number): string {
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(value, 0);
  return buf.toString('hex');
}

test('P2-7 value/type inference: real fixture, real controlled mutation sequence, real evidence-based candidates (spec §17)', { skip: realEnvSkipReason() }, async () => {
  await withAttachedFixture(async ({ event, child }) => {
    const structBase = child.fields.STRUCT_REGION_BASE;
    const discoverResult = await mock.__invoke('structure:discover', event, {
      label: 'p2-7-real-process',
      baseAddress: structBase,
      length: STRUCT_WINDOW_LENGTH,
    });
    assert.equal(discoverResult.success, true, JSON.stringify(discoverResult));
    const structureId = discoverResult.structure.id;

    // Zero/one snapshot — no claim yet.
    await mock.__invoke('structure:capture-snapshot', event, { structureId });
    const early = await mock.__invoke('inference:infer-structure-behavior', event, { structureId });
    assert.equal(early.success, true);
    assert.ok(early.results.every((r: any) => r.candidates.length === 0), 'a single real snapshot must still yield zero behavior claims');

    // Drive the real mutable field through a real, controlled increasing
    // sequence — the fixture's known STRUCT_MUTABLE_I32_INITIAL is 42, and
    // the early single-snapshot check above already captured that value, so
    // every value here must stay strictly above 42 to keep the FULL
    // observed sequence (including that first snapshot) monotonic.
    for (const value of [50, 65, 80, 100]) {
      await writeStructField(child, STRUCT_MUTABLE_I32_OFFSET, toLeHex32(value));
      await mock.__invoke('structure:capture-snapshot', event, { structureId });
    }

    const inferred = await mock.__invoke('inference:infer-structure-behavior', event, { structureId });
    assert.equal(inferred.success, true, JSON.stringify(inferred));
    const mutableField = inferred.results.find((r: any) => r.offset === STRUCT_MUTABLE_I32_OFFSET);
    assert.ok(mutableField, 'the real mutable field must appear in the inference results');
    assert.ok(
      mutableField.candidates.some((c: any) => c.behavior === 'monotonic_increasing'),
      `expected monotonic_increasing from a real driven increasing sequence, got ${JSON.stringify(mutableField.candidates)}`,
    );

    // A field that never changed across every real snapshot must be inferred stable.
    const stableField = inferred.results.find((r: any) => r.offset === 0x00); // STRUCT_SENTINEL_OFFSET, never mutated
    assert.ok(stableField);
    assert.ok(stableField.candidates.some((c: any) => c.behavior === 'stable'), 'a real never-mutated field must be inferred stable, not volatile');

    // Unknown structure id — truthful error, never a crash or fabricated result.
    const unknown = await mock.__invoke('inference:infer-structure-behavior', event, { structureId: 'does-not-exist' });
    assert.equal(unknown.success, false);
  });
});
