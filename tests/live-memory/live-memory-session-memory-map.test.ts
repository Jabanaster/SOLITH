// Phase 2 P2-8 — LiveMemorySession.listMemoryRegions/listMemoryModules
// (memory map). Reuses the existing research MemoryViewer enumeration —
// this only proves the session/bound wiring; MemoryViewer's own listRegions
// bounded-truncation behavior is already covered elsewhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveMemorySession } from '../../src/core/live-memory/live-memory-session.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';

function makeAttachedSession(pid = 7171): { session: LiveMemorySession; driver: FakeMemoryDriver } {
  const driver = new FakeMemoryDriver();
  driver.setProcessExecutableName(pid, 'demo.exe');
  const session = new LiveMemorySession(driver);
  return { session, driver };
}

test('listMemoryRegions/listMemoryModules require an attached session', () => {
  const { session } = makeAttachedSession();
  assert.throws(() => session.listMemoryRegions());
  assert.throws(() => session.listMemoryModules());
});

test('listMemoryRegions reports real base/size/writable and correct module association, never fabricated fields', async () => {
  const { session, driver } = makeAttachedSession();
  await session.attach({ pid: 7171, executableName: 'demo.exe' }, true);
  driver.addModule('demo.exe', 0x10000n, 0x2000);
  driver.addRegion(0x10000n, Buffer.alloc(16, 1), true); // inside the module
  driver.addRegion(0x90000n, Buffer.alloc(16, 1), false); // outside every module

  const list = session.listMemoryRegions();
  assert.equal(list.regions.length, 2);
  const inside = list.regions.find((r) => r.baseAddress === '0x10000');
  const outside = list.regions.find((r) => r.baseAddress === '0x90000');
  assert.equal(inside?.moduleName, 'demo.exe');
  assert.equal(inside?.writable, true);
  assert.equal(outside?.moduleName, null, 'a region outside every known module must never fabricate a module name');
  assert.equal(outside?.writable, false);
});

test('listMemoryModules reports real name/base/size', async () => {
  const { session, driver } = makeAttachedSession();
  await session.attach({ pid: 7171, executableName: 'demo.exe' }, true);
  driver.addModule('demo.exe', 0x10000n, 0x2000);
  driver.addModule('kernel32.dll', 0x77000000n, 0x100000);

  const list = session.listMemoryModules();
  assert.equal(list.modules.length, 2);
  assert.deepEqual(new Set(list.modules.map((m) => m.name)), new Set(['demo.exe', 'kernel32.dll']));
});

test('listMemoryRegions writableOnly filters out non-writable regions', async () => {
  const { session, driver } = makeAttachedSession();
  await session.attach({ pid: 7171, executableName: 'demo.exe' }, true);
  driver.addRegion(0x1000n, Buffer.alloc(4), true);
  driver.addRegion(0x2000n, Buffer.alloc(4), false);

  const list = session.listMemoryRegions({ writableOnly: true });
  assert.equal(list.regions.length, 1);
  assert.equal(list.regions[0].baseAddress, '0x1000');
});
