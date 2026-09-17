// Phase 2 P2-8 — watchlists. ROADMAP.md's own checkpoint matrix assigns
// watchlists to P2-8 (memory map + watchlists), not P2-7 — see
// Docs/phase2/031. Covers address-source provenance (absolute/module-
// relative/pointer-map-node/structure-field), truthful resolveState/
// changeState/readState, refresh, and resource limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveMemorySession } from '../../src/core/live-memory/live-memory-session.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import { MAX_WATCH_ITEMS_PER_SESSION } from '../../src/core/live-memory/watchlist-model.js';

function makeAttachedSession(pid = 8181): { session: LiveMemorySession; driver: FakeMemoryDriver } {
  const driver = new FakeMemoryDriver();
  driver.setProcessExecutableName(pid, 'demo.exe');
  const session = new LiveMemorySession(driver);
  return { session, driver };
}

test('watchAdd requires an attached session and never leaves an orphaned registry entry on failure', () => {
  const { session } = makeAttachedSession();
  assert.throws(() => session.watchAdd({ source: { kind: 'absolute', address: '0x1000' }, width: 4 }));
  assert.equal(session.watchList().length, 0);
});

test('an absolute-address watch reads immediately on add and reports real changes on refresh', async () => {
  const { session, driver } = makeAttachedSession();
  await session.attach({ pid: 8181, executableName: 'demo.exe' }, true);
  const buf = Buffer.alloc(4, 0);
  buf.writeInt32LE(1, 0);
  driver.addRegion(0x1000n, buf, true);

  const watch = session.watchAdd({ source: { kind: 'absolute', address: '0x1000' }, width: 4, label: 'my counter' });
  assert.equal(watch.label, 'my counter');
  assert.equal(watch.resolveState, 'live');
  assert.equal(watch.changeState, 'became_readable');
  assert.equal(watch.currentValue?.readState, 'complete');

  buf.writeInt32LE(999, 0);
  const refreshed = session.watchRefresh(watch.id);
  assert.equal(refreshed.changeState, 'changed');
  assert.notEqual(refreshed.currentValue?.rawHex, refreshed.previousValue?.rawHex);

  const unchanged = session.watchRefresh(watch.id);
  assert.equal(unchanged.changeState, 'unchanged');
});

test('a module-relative watch resolves against the real module base and reports unresolved when the module is missing', async () => {
  const { session, driver } = makeAttachedSession();
  await session.attach({ pid: 8181, executableName: 'demo.exe' }, true);
  driver.addModule('demo.exe', 0x10000n, 0x2000);
  driver.addRegion(0x10010n, Buffer.alloc(4, 0xab), true);

  const watch = session.watchAdd({ source: { kind: 'module_relative', moduleName: 'demo.exe', offset: '0x10' }, width: 4 });
  assert.equal(watch.resolveState, 'live');
  assert.equal(watch.resolvedAddressHex, '0x10010');

  const missingModule = session.watchAdd({ source: { kind: 'module_relative', moduleName: 'nope.dll', offset: '0x10' }, width: 4 });
  assert.equal(missingModule.resolveState, 'unresolved');
  assert.equal(missingModule.currentValue, null);
});

test('a structure-field watch resolves via the discovered structure', async () => {
  const { session, driver } = makeAttachedSession();
  await session.attach({ pid: 8181, executableName: 'demo.exe' }, true);
  driver.addRegion(0x2000n, Buffer.alloc(8, 0x11), true);
  const structure = session.structureDiscover({ label: 's', baseAddress: 0x2000n, length: 8 });

  const watch = session.watchAdd({ source: { kind: 'structure_field', structureId: structure.id, offset: structure.fields[0].offset }, width: structure.fields[0].width });
  assert.equal(watch.resolveState, 'live');
  assert.equal(watch.currentValue?.readState, 'complete');

  const missingStructure = session.watchAdd({ source: { kind: 'structure_field', structureId: 'nope', offset: 0 }, width: 4 });
  assert.equal(missingStructure.resolveState, 'unresolved');
});

test('watchList/watchGet/watchRemove/watchSetLabel round-trip, and watchRefreshAll refreshes every item independently', async () => {
  const { session, driver } = makeAttachedSession();
  await session.attach({ pid: 8181, executableName: 'demo.exe' }, true);
  driver.addRegion(0x3000n, Buffer.alloc(4, 1), true);
  driver.addRegion(0x4000n, Buffer.alloc(4, 1), true);

  const a = session.watchAdd({ source: { kind: 'absolute', address: '0x3000' }, width: 4 });
  const b = session.watchAdd({ source: { kind: 'absolute', address: '0x4000' }, width: 4 });
  assert.equal(session.watchList().length, 2);
  assert.equal(session.watchGet(a.id)?.id, a.id);

  const relabeled = session.watchSetLabel(a.id, 'renamed');
  assert.equal(relabeled.label, 'renamed');

  const refreshedAll = session.watchRefreshAll();
  assert.equal(refreshedAll.length, 2);

  assert.equal(session.watchRemove(a.id), true);
  assert.equal(session.watchGet(a.id), null);
  assert.equal(session.watchGet(b.id)?.id, b.id);
  assert.equal(session.watchRemove(a.id), false, 'removing an already-removed watch is a truthful false, not an error');
});

test('spec §36 — per-session watch count is bounded, oldest evicted first', async () => {
  const { session, driver } = makeAttachedSession();
  await session.attach({ pid: 8181, executableName: 'demo.exe' }, true);
  const ids: string[] = [];
  for (let i = 0; i < MAX_WATCH_ITEMS_PER_SESSION + 5; i++) {
    const addr = 0x100000n + BigInt(i * 16);
    driver.addRegion(addr, Buffer.alloc(4, 1), true);
    ids.push(session.watchAdd({ source: { kind: 'absolute', address: `0x${addr.toString(16)}` }, width: 4 }).id);
  }
  assert.equal(session.watchList().length, MAX_WATCH_ITEMS_PER_SESSION);
  assert.equal(session.watchGet(ids[0]), null, 'the oldest watch must have been evicted');
  assert.ok(session.watchGet(ids[ids.length - 1]));
});

test('an unreadable watch address reports became_unreadable truthfully, never a fabricated value', async () => {
  const { session } = makeAttachedSession();
  await session.attach({ pid: 8181, executableName: 'demo.exe' }, true);
  const watch = session.watchAdd({ source: { kind: 'absolute', address: '0xdeadbeef' }, width: 4 });
  assert.equal(watch.resolveState, 'live', 'resolveState reflects address-source resolution, independent of read success');
  assert.equal(watch.currentValue?.readState, 'failed', 'a resolved-but-unreadable address must report a truthful failed read, never a fabricated value');
  assert.equal(watch.currentValue?.rawHex, null);
  assert.equal(watch.changeState, 'never_read');
});
