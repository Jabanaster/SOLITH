// Phase 2 P2-8 (SOLITH.MD mission §26-equivalent real-fixture proof,
// applied per ROADMAP's actual checkpoint assignment) — real-process
// memory-map and watchlist certification. Spawns a genuine
// `solith-scanner-fixture.exe`, attaches through the real registered
// `ipcMain.handle` callbacks (nothing below the IPC boundary is mocked).
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
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'solith-p2-8-real-process-'));
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
function toLeHex32(value: number): string {
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(value, 0);
  return buf.toString('hex');
}

test('P2-8 memory map: real fixture region/module enumeration, real protection/type fields, no fabrication', { skip: realEnvSkipReason() }, async () => {
  await withAttachedFixture(async ({ event, child }) => {
    const modulesResult = await mock.__invoke('memory-map:list-modules', event, {});
    assert.equal(modulesResult.success, true, JSON.stringify(modulesResult));
    const fixtureModule = modulesResult.list.modules.find((m: any) => m.name.toLowerCase().includes('solith-scanner-fixture'));
    assert.ok(fixtureModule, 'the real fixture module must appear in the module list');
    assert.ok(fixtureModule.path?.toLowerCase().includes('solith-scanner-fixture'), 'the real on-disk path must be reported');

    const regionsResult = await mock.__invoke('memory-map:list-regions', event, {});
    assert.equal(regionsResult.success, true, JSON.stringify(regionsResult));
    assert.ok(regionsResult.list.regions.length > 0, 'a real live process must have real committed regions');
    const structRegionBase = `0x${BigInt(child.fields.STRUCT_REGION_BASE).toString(16)}`;
    const structRegion = regionsResult.list.regions.find((r: any) => r.baseAddress === structRegionBase);
    assert.ok(structRegion, 'the real STRUCT_REGION VirtualAlloc must appear as its own committed region');
    assert.equal(structRegion.writable, true, 'the fixture explicitly allocates STRUCT_REGION as read/write');
    assert.equal(typeof structRegion.rawProtect, 'number', 'a real protection value must be reported, not fabricated');
  });
});

test('P2-8 watchlist: real fixture, absolute + module-relative + structure-field sources, real refresh detects a real mutation', { skip: realEnvSkipReason() }, async () => {
  await withAttachedFixture(async ({ event, child }) => {
    const structBase = BigInt(child.fields.STRUCT_REGION_BASE);
    const mutableAddrHex = `0x${(structBase + BigInt(STRUCT_MUTABLE_I32_OFFSET)).toString(16)}`;

    // ── absolute source ──────────────────────────────────────────────
    const added = await mock.__invoke('watchlist:add', event, {
      source: { kind: 'absolute', address: mutableAddrHex },
      width: 4,
      label: 'mutable field',
    });
    assert.equal(added.success, true, JSON.stringify(added));
    assert.equal(added.watch.resolveState, 'live');
    assert.equal(added.watch.currentValue.readState, 'complete');
    const initial = added.watch.currentValue.interpretationsByWidth[4].find((i: any) => i.kind === 'i32');
    assert.equal(initial.value, '42', 'the real fixture default STRUCT_MUTABLE_I32_INITIAL must be observed');

    await writeStructField(child, STRUCT_MUTABLE_I32_OFFSET, toLeHex32(777));
    const refreshed = await mock.__invoke('watchlist:refresh', event, { watchId: added.watch.id });
    assert.equal(refreshed.success, true);
    assert.equal(refreshed.watch.changeState, 'changed', 'a real live mutation must be detected on refresh');
    const afterI32 = refreshed.watch.currentValue.interpretationsByWidth[4].find((i: any) => i.kind === 'i32');
    assert.equal(afterI32.value, '777');

    // ── module-relative source — the module's own PE header at offset 0,
    // a real, always-known-readable address inside the module's own image
    // (STRUCT_REGION is a separate heap VirtualAlloc, not module-relative
    // in any meaningful sense, so it is not reused for this source kind).
    const modulesResult = await mock.__invoke('memory-map:list-modules', event, {});
    const fixtureModule = modulesResult.list.modules.find((m: any) => m.name.toLowerCase().includes('solith-scanner-fixture'));
    assert.ok(fixtureModule, 'the real fixture module must be listed');
    const moduleRelative = await mock.__invoke('watchlist:add', event, {
      source: { kind: 'module_relative', moduleName: fixtureModule.name, offset: '0x0' },
      width: 2,
    });
    assert.equal(moduleRelative.success, true, JSON.stringify(moduleRelative));
    assert.equal(moduleRelative.watch.resolveState, 'live');
    assert.equal(moduleRelative.watch.resolvedAddressHex, fixtureModule.baseAddress, 'module-relative offset 0 must resolve to the exact real module base');
    const magic = moduleRelative.watch.currentValue.interpretationsByWidth[2].find((i: any) => i.kind === 'u16');
    assert.equal(Number(magic.value), 0x5a4d, 'the real PE DOS-header magic "MZ" must be observed at the resolved address');

    // ── structure-field source ───────────────────────────────────────
    const discoverResult = await mock.__invoke('structure:discover', event, {
      label: 'p2-8-watch',
      baseAddress: `0x${structBase.toString(16)}`,
      length: 64,
    });
    const mutableField = discoverResult.structure.fields.find((f: any) => f.offset === STRUCT_MUTABLE_I32_OFFSET);
    assert.ok(mutableField, 'the mutable field must be its own discovered field (aligned to the pointer field boundary at 0x18)');
    const structureField = await mock.__invoke('watchlist:add', event, {
      source: { kind: 'structure_field', structureId: discoverResult.structure.id, offset: STRUCT_MUTABLE_I32_OFFSET },
      width: mutableField.width,
    });
    assert.equal(structureField.success, true, JSON.stringify(structureField));
    assert.equal(structureField.watch.resolveState, 'live');

    // ── listing, label, removal, refresh-all ────────────────────────
    const list = await mock.__invoke('watchlist:list', event);
    assert.equal(list.watches.length, 3);
    const relabeled = await mock.__invoke('watchlist:set-label', event, { watchId: added.watch.id, label: 'renamed' });
    assert.equal(relabeled.watch.label, 'renamed');
    const refreshAll = await mock.__invoke('watchlist:refresh-all', event);
    assert.equal(refreshAll.watches.length, 3);
    const removed = await mock.__invoke('watchlist:remove', event, { watchId: added.watch.id });
    assert.equal(removed.removed, true);

    // ── failure injection: unmapped absolute address, unknown module ─
    const unmapped = await mock.__invoke('watchlist:add', event, { source: { kind: 'absolute', address: '0x1' }, width: 4 });
    assert.equal(unmapped.success, true);
    assert.equal(unmapped.watch.currentValue.readState, 'failed');
    const unknownModule = await mock.__invoke('watchlist:add', event, {
      source: { kind: 'module_relative', moduleName: 'does-not-exist.dll', offset: '0x0' },
      width: 4,
    });
    assert.equal(unknownModule.watch.resolveState, 'unresolved');
  });
});
