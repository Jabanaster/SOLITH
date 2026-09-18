// Phase 2 P2-6 — LiveMemorySession's typed-value-view service seam. Pure
// engine logic is covered in typed-memory-view.test.ts; this file covers
// the session wiring: attach-required access, live read, batch read,
// live refresh, and pure (no-I/O) reinterpretation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveMemorySession } from '../../src/core/live-memory/live-memory-session.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';

function makeAttachedSession(pid = 5252): { session: LiveMemorySession; driver: FakeMemoryDriver } {
  const driver = new FakeMemoryDriver();
  driver.setProcessExecutableName(pid, 'demo.exe');
  const session = new LiveMemorySession(driver);
  return { session, driver };
}

test('readTypedValue requires an attached session', () => {
  const { session } = makeAttachedSession();
  assert.throws(() => session.readTypedValue({ address: 0x1000n, length: 4 }));
});

test('readTypedValue/readTypedValues against a fake attached process', async () => {
  const { session, driver } = makeAttachedSession();
  await session.attach({ pid: 5252, executableName: 'demo.exe' }, true);
  driver.addRegion(0x1000n, Buffer.alloc(8, 0xab), true);

  const view = session.readTypedValue({ address: 0x1000n, length: 8 });
  assert.equal(view.readState, 'complete');
  assert.ok(view.interpretationsByWidth[8]);

  const batch = session.readTypedValues([
    { address: 0x1000n, length: 4 },
    { address: 0x1000n, length: 8 },
  ]);
  assert.equal(batch.length, 2);
  assert.equal(batch[0].actualLength, 4);
  assert.equal(batch[1].actualLength, 8);
});

test('refreshTypedValue re-reads live and reflects a real mutation between calls', async () => {
  const { session, driver } = makeAttachedSession();
  await session.attach({ pid: 5252, executableName: 'demo.exe' }, true);
  const buf = Buffer.alloc(4, 0);
  buf.writeInt32LE(1, 0);
  driver.addRegion(0x2000n, buf, true);

  const first = session.readTypedValue({ address: 0x2000n, length: 4 });
  buf.writeInt32LE(999, 0);
  const refreshed = session.refreshTypedValue({ address: 0x2000n, length: 4 });

  assert.notEqual(refreshed.rawHex, first.rawHex, 'refresh must perform a fresh live read, not return cached bytes');
  const i32 = (refreshed.interpretationsByWidth[4] ?? []).find((i) => i.kind === 'i32');
  assert.equal(i32?.value, '999');
});

test('reinterpretValue needs no attached session and performs no I/O', () => {
  const { session } = makeAttachedSession();
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(-5, 0);
  const byWidth = session.reinterpretValue(`0x${buf.toString('hex')}`);
  const i32 = (byWidth[4] ?? []).find((i) => i.kind === 'i32');
  assert.equal(i32?.value, '-5');
});

test('a genuinely unreadable address is a truthful failure through the session, never a thrown crash', async () => {
  const { session } = makeAttachedSession();
  await session.attach({ pid: 5252, executableName: 'demo.exe' }, true);
  const view = session.readTypedValue({ address: 0xdeadbeefn, length: 4 });
  assert.equal(view.readState, 'failed');
});
