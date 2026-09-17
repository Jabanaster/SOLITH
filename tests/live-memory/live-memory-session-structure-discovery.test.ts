// Phase 2 P2-5 — LiveMemorySession's structure-discovery service seam. Pure
// engine logic is covered in structure-discovery.test.ts; this file covers
// the session wiring: attach-required access, id-preserving refresh, field
// inspection, snapshot capture/list/compare against a fake attached
// process, and the spec §18 per-session/per-structure resource limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveMemorySession } from '../../src/core/live-memory/live-memory-session.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import { MAX_DISCOVERED_STRUCTURES_PER_SESSION, MAX_SNAPSHOTS_PER_STRUCTURE } from '../../src/core/live-memory/structure-model.js';

function makeAttachedSession(pid = 4242): { session: LiveMemorySession; driver: FakeMemoryDriver } {
  const driver = new FakeMemoryDriver();
  driver.setProcessExecutableName(pid, 'demo.exe');
  const session = new LiveMemorySession(driver);
  return { session, driver };
}

test('structureDiscover requires an attached session', () => {
  const { session } = makeAttachedSession();
  assert.throws(() => session.structureDiscover({ label: 'x', baseAddress: 0x1000n, length: 8 }));
});

test('structureDiscover/Get/List/Delete round-trip against a fake attached process', async () => {
  const { session, driver } = makeAttachedSession();
  await session.attach({ pid: 4242, executableName: 'demo.exe' }, true);
  driver.addRegion(0x1000n, Buffer.alloc(16, 0xab), true);

  const structure = session.structureDiscover({ label: 'demo', baseAddress: 0x1000n, length: 16 });
  assert.equal(session.structureGet(structure.id)?.id, structure.id);
  assert.equal(session.structureList().length, 1);
  assert.equal(session.structureGet('missing'), null);

  assert.equal(session.structureDelete(structure.id), true);
  assert.equal(session.structureGet(structure.id), null);
  assert.equal(session.structureDelete(structure.id), false, 'deleting an already-deleted id is a truthful false, not an error');
});

test('structureRefresh preserves the original id while reflecting live changes', async () => {
  const { session, driver } = makeAttachedSession();
  await session.attach({ pid: 4242, executableName: 'demo.exe' }, true);
  const buf = Buffer.alloc(8, 0);
  buf.writeInt32LE(1, 0);
  driver.addRegion(0x2000n, buf, true);

  const first = session.structureDiscover({ label: 'refresh', baseAddress: 0x2000n, length: 8 });
  buf.writeInt32LE(999, 0);
  const refreshed = session.structureRefresh(first.id);

  assert.equal(refreshed.id, first.id, 'refresh must keep the session-visible id stable');
  assert.notEqual(refreshed.fields[0]?.rawHex, first.fields[0]?.rawHex, 'refresh must reflect the live-mutated bytes');
  assert.equal(session.structureGet(first.id)?.fields[0]?.rawHex, refreshed.fields[0]?.rawHex, 'the session registry must hold the refreshed content, not the stale first read');
});

test('structureRefresh/structureInspectField/structureCaptureSnapshot throw truthfully for an unknown id', async () => {
  const { session } = makeAttachedSession();
  await session.attach({ pid: 4242, executableName: 'demo.exe' }, true);
  assert.throws(() => session.structureRefresh('missing'));
  assert.throws(() => session.structureInspectField('missing', 0));
  assert.throws(() => session.structureCaptureSnapshot('missing'));
});

test('structureInspectField returns the exact field row, never a fabricated one', async () => {
  const { session, driver } = makeAttachedSession();
  await session.attach({ pid: 4242, executableName: 'demo.exe' }, true);
  driver.addRegion(0x3000n, Buffer.alloc(8, 0), true);
  const structure = session.structureDiscover({ label: 'inspect', baseAddress: 0x3000n, length: 8 });
  const field = session.structureInspectField(structure.id, structure.fields[0].offset);
  assert.equal(field.offset, structure.fields[0].offset);
  assert.throws(() => session.structureInspectField(structure.id, 99999), 'an offset with no discovered field must throw, never fabricate one');
});

test('structureCaptureSnapshot/ListSnapshots/CompareSnapshots against a fake attached process', async () => {
  const { session, driver } = makeAttachedSession();
  await session.attach({ pid: 4242, executableName: 'demo.exe' }, true);
  const buf = Buffer.alloc(4, 0);
  driver.addRegion(0x4000n, buf, true);
  const structure = session.structureDiscover({ label: 'snap', baseAddress: 0x4000n, length: 4 });

  const snapA = session.structureCaptureSnapshot(structure.id);
  buf.writeUInt8(0xff, 0);
  const snapB = session.structureCaptureSnapshot(structure.id);

  const listed = session.structureListSnapshots(structure.id);
  assert.equal(listed.length, 2);
  assert.deepEqual(new Set(listed.map((s) => s.id)), new Set([snapA.id, snapB.id]));

  const diff = session.structureCompareSnapshots(snapA.id, snapB.id);
  assert.ok(diff.changes.some((c) => c.state === 'changed'));

  assert.throws(() => session.structureCompareSnapshots('missing-a', snapB.id));
  assert.throws(() => session.structureCompareSnapshots(snapA.id, 'missing-b'));
});

test('structureDelete cascades to that structure\'s own snapshots, never another structure\'s', async () => {
  const { session, driver } = makeAttachedSession();
  await session.attach({ pid: 4242, executableName: 'demo.exe' }, true);
  driver.addRegion(0x5000n, Buffer.alloc(4, 0), true);
  driver.addRegion(0x6000n, Buffer.alloc(4, 0), true);
  const a = session.structureDiscover({ label: 'a', baseAddress: 0x5000n, length: 4 });
  const b = session.structureDiscover({ label: 'b', baseAddress: 0x6000n, length: 4 });
  const snapA = session.structureCaptureSnapshot(a.id);
  const snapB = session.structureCaptureSnapshot(b.id);

  session.structureDelete(a.id);

  assert.equal(session.structureListSnapshots(a.id).length, 0, 'deleted structure\'s own snapshots must be gone');
  assert.equal(session.structureListSnapshots(b.id).length, 1, 'the other structure\'s snapshot must survive untouched');
  assert.equal(session.structureGet(b.id)?.id, b.id);
  void snapA;
  void snapB;
});

test('spec §18 — per-session discovered-structure count is bounded, oldest evicted first', async () => {
  const { session, driver } = makeAttachedSession();
  await session.attach({ pid: 4242, executableName: 'demo.exe' }, true);
  const ids: string[] = [];
  for (let i = 0; i < MAX_DISCOVERED_STRUCTURES_PER_SESSION + 5; i++) {
    const addr = 0x100000n + BigInt(i * 16);
    driver.addRegion(addr, Buffer.alloc(4, 0), true);
    const structure = session.structureDiscover({ label: `s${i}`, baseAddress: addr, length: 4 });
    ids.push(structure.id);
  }
  assert.equal(session.structureList().length, MAX_DISCOVERED_STRUCTURES_PER_SESSION, 'the registry must never exceed the configured cap');
  assert.equal(session.structureGet(ids[0]), null, 'the oldest structure must have been evicted');
  assert.ok(session.structureGet(ids[ids.length - 1]), 'the most recently discovered structure must survive');
});

test('spec §18 — per-structure snapshot count is bounded, oldest evicted first, never another structure\'s snapshots', async () => {
  const { session, driver } = makeAttachedSession();
  await session.attach({ pid: 4242, executableName: 'demo.exe' }, true);
  const buf = Buffer.alloc(4, 0);
  driver.addRegion(0x7000n, buf, true);
  const structure = session.structureDiscover({ label: 'capped', baseAddress: 0x7000n, length: 4 });

  const otherBuf = Buffer.alloc(4, 0);
  driver.addRegion(0x8000n, otherBuf, true);
  const other = session.structureDiscover({ label: 'other', baseAddress: 0x8000n, length: 4 });
  const otherSnapshot = session.structureCaptureSnapshot(other.id);

  const snapshotIds: string[] = [];
  for (let i = 0; i < MAX_SNAPSHOTS_PER_STRUCTURE + 5; i++) {
    buf.writeUInt8(i & 0xff, 0);
    snapshotIds.push(session.structureCaptureSnapshot(structure.id).id);
  }

  const remaining = session.structureListSnapshots(structure.id);
  assert.equal(remaining.length, MAX_SNAPSHOTS_PER_STRUCTURE, 'this structure\'s snapshots must never exceed the configured cap');
  assert.ok(!remaining.some((s) => s.id === snapshotIds[0]), 'the oldest snapshot must have been evicted');
  assert.ok(remaining.some((s) => s.id === snapshotIds[snapshotIds.length - 1]), 'the most recent snapshot must survive');
  assert.equal(session.structureGet(other.id)?.id, other.id);
  assert.deepEqual(session.structureListSnapshots(other.id).map((s) => s.id), [otherSnapshot.id], 'eviction must never touch another structure\'s snapshots');
});
