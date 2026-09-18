// Phase 2 P2-7 — LiveMemorySession.inferStructureBehavior wiring. Pure
// inference-engine behavior is covered in value-type-inference.test.ts;
// this file covers that the session correctly sources a structure's own
// captured snapshot history (P2-5's structureCaptureSnapshot) and feeds it
// through, in chronological order, without a live read of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveMemorySession } from '../../src/core/live-memory/live-memory-session.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';

function makeAttachedSession(pid = 6161): { session: LiveMemorySession; driver: FakeMemoryDriver } {
  const driver = new FakeMemoryDriver();
  driver.setProcessExecutableName(pid, 'demo.exe');
  const session = new LiveMemorySession(driver);
  return { session, driver };
}

test('inferStructureBehavior throws for an unknown structure id, never fabricates a result', async () => {
  const { session } = makeAttachedSession();
  await session.attach({ pid: 6161, executableName: 'demo.exe' }, true);
  assert.throws(() => session.inferStructureBehavior('missing'));
});

test('a structure with zero or one captured snapshot yields no behavior candidates for any field', async () => {
  const { session, driver } = makeAttachedSession();
  await session.attach({ pid: 6161, executableName: 'demo.exe' }, true);
  driver.addRegion(0x1000n, Buffer.alloc(4, 1), true);
  const structure = session.structureDiscover({ label: 'x', baseAddress: 0x1000n, length: 4 });

  const zeroSnapshots = session.inferStructureBehavior(structure.id);
  assert.ok(zeroSnapshots.every((r) => r.candidates.length === 0));

  session.structureCaptureSnapshot(structure.id);
  const oneSnapshot = session.inferStructureBehavior(structure.id);
  assert.ok(oneSnapshot.every((r) => r.candidates.length === 0), 'a single snapshot is still not enough evidence for any behavior claim');
});

test('a real monotonic counter across captured snapshots is inferred through the full session path', async () => {
  const { session, driver } = makeAttachedSession();
  await session.attach({ pid: 6161, executableName: 'demo.exe' }, true);
  const buf = Buffer.alloc(4, 0);
  buf.writeInt32LE(1, 0);
  driver.addRegion(0x2000n, buf, true);
  const structure = session.structureDiscover({ label: 'counter', baseAddress: 0x2000n, length: 4 });

  session.structureCaptureSnapshot(structure.id);
  buf.writeInt32LE(5, 0);
  session.structureCaptureSnapshot(structure.id);
  buf.writeInt32LE(12, 0);
  session.structureCaptureSnapshot(structure.id);

  const results = session.inferStructureBehavior(structure.id);
  const field = results.find((r) => r.offset === 0);
  assert.ok(field);
  assert.ok(field!.candidates.some((c) => c.behavior === 'monotonic_increasing'));
  assert.equal(field!.evidence.observationCount, 3);
});
