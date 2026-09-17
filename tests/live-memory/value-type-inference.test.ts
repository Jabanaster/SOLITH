// Phase 2 P2-7 — Value/type inference. Pure engine tests: builds an ordered
// series of StructureSnapshots directly (bypassing a live driver, mirroring
// structure-discovery.test.ts's own fake-driver-free style for pure
// data-shape tests) and asserts inferStructureBehavior/inferFieldBehavior
// only ever claim what the evidence actually supports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DiscoveredField, DiscoveredStructure, StructureSnapshot } from '../../src/core/live-memory/structure-model.js';
import { inferFieldBehavior, inferStructureBehavior } from '../../src/core/live-memory/value-type-inference.js';

function makeSnapshot(structureId: string, buf: Buffer, capturedAt: string): StructureSnapshot {
  return {
    id: `snap-${capturedAt}`,
    structureId,
    completeness: { state: 'complete' },
    rawHex: `0x${buf.toString('hex')}`,
    capturedAt,
  };
}

function makeField(offset: number, width: 1 | 2 | 4 | 8): DiscoveredField {
  return {
    offset,
    width,
    aligned: true,
    confidence: 'low',
    rawHex: '0x00',
    interpretations: [],
    evidence: { pointerCandidate: { classified: false }, stringCandidate: { classified: false } },
  };
}

test('fewer than 2 readable observations earns no behavior claim at all (spec §11 — decodable != inferred)', () => {
  const field = makeField(0, 4);
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(1, 0);
  const result = inferFieldBehavior(field, 0, [makeSnapshot('s', buf, 't1')]);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.evidence.observationCount, 1);
});

test('byte-identical bytes across snapshots are inferred stable, with confidence scaling by observation count', () => {
  const field = makeField(0, 4);
  const buf = Buffer.alloc(4, 0xab);
  const snaps = [makeSnapshot('s', buf, 't1'), makeSnapshot('s', buf, 't2')];
  const result = inferFieldBehavior(field, 0, snaps);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].behavior, 'stable');
  assert.equal(result.candidates[0].confidence, 'medium', '2 observations must not claim high confidence');
});

test('stable field with prior discovery-time pointer evidence also earns pointer_stable', () => {
  const field: DiscoveredField = {
    ...makeField(0, 8),
    evidence: {
      pointerCandidate: { classified: true, destinationAddress: '0x1000', destinationRegion: 'module', destinationModuleName: 'x.exe', readable: true },
      stringCandidate: { classified: false },
    },
  };
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(0x1000n, 0);
  const snaps = Array.from({ length: 5 }, (_, i) => makeSnapshot('s', buf, `t${i}`));
  const result = inferFieldBehavior(field, 0, snaps);
  const behaviors = result.candidates.map((c) => c.behavior);
  assert.ok(behaviors.includes('stable'));
  assert.ok(behaviors.includes('pointer_stable'));
  assert.equal(result.candidates.find((c) => c.behavior === 'pointer_stable')?.confidence, 'high', '5 observations of a readable prior pointer must earn high confidence');
});

test('a strictly increasing integer series is inferred monotonic_increasing, never as a decreasing or stable claim', () => {
  const field = makeField(0, 4);
  const snaps = [10, 20, 30, 45].map((v, i) => {
    const buf = Buffer.alloc(4);
    buf.writeInt32LE(v, 0);
    return makeSnapshot('s', buf, `t${i}`);
  });
  const result = inferFieldBehavior(field, 0, snaps);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].behavior, 'monotonic_increasing');
});

test('a strictly decreasing integer series (e.g. a health counter) is inferred monotonic_decreasing', () => {
  const field = makeField(0, 4);
  const snaps = [100, 80, 55, 10].map((v, i) => {
    const buf = Buffer.alloc(4);
    buf.writeInt32LE(v, 0);
    return makeSnapshot('s', buf, `t${i}`);
  });
  const result = inferFieldBehavior(field, 0, snaps);
  assert.equal(result.candidates[0].behavior, 'monotonic_decreasing');
});

test('a repeated tick between real changes is not a monotonicity violation', () => {
  const field = makeField(0, 4);
  const snaps = [10, 10, 20, 20, 30].map((v, i) => {
    const buf = Buffer.alloc(4);
    buf.writeInt32LE(v, 0);
    return makeSnapshot('s', buf, `t${i}`);
  });
  const result = inferFieldBehavior(field, 0, snaps);
  assert.equal(result.candidates[0].behavior, 'monotonic_increasing', 'flat ticks between real increases must not break the monotonic claim');
});

test('a fluctuating (non-monotonic) float32 series is inferred bounded_float, not stable or monotonic', () => {
  const field = makeField(0, 4);
  const snaps = [1.5, 0.2, 3.7, 1.1].map((v, i) => {
    const buf = Buffer.alloc(4);
    buf.writeFloatLE(v, 0);
    return makeSnapshot('s', buf, `t${i}`);
  });
  const result = inferFieldBehavior(field, 0, snaps);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].behavior, 'bounded_float');
});

test('a genuinely printable ASCII byte series at every observation is inferred string_like', () => {
  const field = makeField(0, 4);
  const buf1 = Buffer.from('ABCD', 'ascii');
  const buf2 = Buffer.from('WXYZ', 'ascii');
  const result = inferFieldBehavior(field, 0, [makeSnapshot('s', buf1, 't1'), makeSnapshot('s', buf2, 't2')]);
  assert.ok(result.candidates.some((c) => c.behavior === 'string_like'));
});

test('a non-monotonic, non-float-clean, non-string byte series with no matching evidence is volatile_unknown, never fabricated certainty', () => {
  const field = makeField(0, 1); // 1-byte width never decodes as float
  const snaps = [0x01, 0x50, 0x02, 0x90].map((v, i) => makeSnapshot('s', Buffer.from([v]), `t${i}`));
  const result = inferFieldBehavior(field, 0, snaps);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].behavior, 'volatile_unknown');
  assert.equal(result.candidates[0].confidence, 'low', 'the no-evidence bucket must never claim more than low confidence');
});

test('a snapshot with failed completeness is excluded from evidence, never treated as a zero-byte observation', () => {
  const field = makeField(0, 4);
  const buf = Buffer.alloc(4, 0xcc);
  const failedSnapshot: StructureSnapshot = { id: 'snap-bad', structureId: 's', completeness: { state: 'failed', reason: 'x' }, rawHex: null, capturedAt: 't-bad' };
  const result = inferFieldBehavior(field, 0, [makeSnapshot('s', buf, 't1'), failedSnapshot, makeSnapshot('s', buf, 't2')]);
  assert.equal(result.evidence.observationCount, 2, 'a failed snapshot must never be counted as a real observation');
});

test('inferStructureBehavior produces one result per field, preserving offset/width, never fabricating an extra field', () => {
  const structure: DiscoveredStructure = {
    id: 'struct-1',
    label: 'demo',
    baseAddressHex: '0x1000',
    length: 8,
    truncated: false,
    completeness: { state: 'complete' },
    fields: [makeField(0, 4), makeField(4, 4)],
    unknownSpans: [],
    createdAt: 't0',
  };
  const buf = Buffer.alloc(8, 0x11);
  const snaps = [makeSnapshot('struct-1', buf, 't1'), makeSnapshot('struct-1', buf, 't2')];
  const results = inferStructureBehavior(structure, snaps);
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((r) => r.offset), [0, 4]);
});
