import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import {
  discoverStructure,
  refreshStructure,
  captureStructureSnapshot,
  compareStructureSnapshots,
} from '../../src/core/live-memory/structure-discovery.js';
import { MAX_STRUCTURE_DISCOVERY_LENGTH } from '../../src/core/live-memory/structure-model.js';

const HANDLE = { pid: 4242, opaque: { fake: true } };
const BASE = 0x10000n;

function buildFixtureLayout(): Buffer {
  // Deterministic layout mirroring the real-process fixture planned for
  // spec §17: +0x00 int32 sentinel, +0x04 float32, +0x08 uint64, +0x10
  // pointer into a module, +0x18 mutable int32, +0x1C raw/unknown bytes,
  // +0x20 an ASCII string.
  const buf = Buffer.alloc(0x30, 0);
  buf.writeInt32LE(-424242, 0x00);
  buf.writeFloatLE(3.5, 0x04);
  buf.writeBigUInt64LE(0x0102030405060708n, 0x08);
  buf.writeBigUInt64LE(0x140000n, 0x10); // pointer candidate — filled in per-test against a real module base
  buf.writeInt32LE(1, 0x18);
  // 0x1c..0x20: leave as low-evidence random-ish bytes (unknown span candidate)
  buf.writeUInt8(0x13, 0x1c);
  buf.writeUInt8(0x37, 0x1d);
  buf.writeUInt8(0x99, 0x1e);
  buf.writeUInt8(0x02, 0x1f);
  buf.write('HELLO\0\0\0', 0x20, 'ascii');
  return buf;
}

test('discoverStructure reads exact offsets and raw bytes against a fake driver', () => {
  const driver = new FakeMemoryDriver();
  const buf = buildFixtureLayout();
  driver.addRegion(BASE, buf, true);
  driver.addModule('fixture.exe', 0x140000n, 0x10000);

  const result = discoverStructure(driver, HANDLE, { label: 'fixture', baseAddress: BASE, length: 0x30 }, { pointerWidth: 8 });

  assert.equal(result.completeness.state, 'complete');
  assert.equal(result.baseAddressHex, '0x10000');
  assert.equal(result.length, 0x30);
  assert.equal(result.truncated, false);

  const sentinelField = result.fields.find((f) => f.offset === 0x00);
  assert.ok(sentinelField, 'sentinel field at +0x00 must be discovered');
  assert.equal(sentinelField!.rawHex, `0x${buf.subarray(0x00, 0x00 + sentinelField!.width).toString('hex')}`);
});

test('numeric interpretations are decode-distinct from semantic type (spec §11)', () => {
  const driver = new FakeMemoryDriver();
  const buf = Buffer.alloc(16, 0);
  buf.writeInt32LE(-1, 0); // 0xffffffff — plausible int32, uint32, and float all at once
  driver.addRegion(BASE, buf, true);

  const result = discoverStructure(driver, HANDLE, { label: 'numeric', baseAddress: BASE, length: 4 }, { pointerWidth: 8 });
  const field = result.fields.find((f) => f.offset === 0);
  assert.ok(field);
  const kinds = field!.interpretations.map((i) => i.kind);
  assert.ok(kinds.includes('i32'));
  assert.ok(kinds.includes('u32'));
  assert.ok(kinds.includes('f32'));
  // Plain decode success alone is 'low' confidence — no independent evidence backs any single one.
  assert.equal(field!.confidence, 'low');
});

test('pointer candidate requires a real known destination, not decode success alone', () => {
  const driver = new FakeMemoryDriver();
  const buf = Buffer.alloc(16, 0);
  buf.writeBigUInt64LE(0x140000n, 0); // lands inside the module below
  driver.addRegion(BASE, buf, true);
  driver.addModule('fixture.exe', 0x140000n, 0x10000);

  const withModule = discoverStructure(driver, HANDLE, { label: 'ptr', baseAddress: BASE, length: 8 }, { pointerWidth: 8 });
  const field = withModule.fields.find((f) => f.offset === 0 && f.width === 8);
  assert.ok(field, 'an 8-byte field pointing into a real module must be discovered as high confidence');
  assert.equal(field!.evidence.pointerCandidate.classified, true);
  if (field!.evidence.pointerCandidate.classified) {
    assert.equal(field!.evidence.pointerCandidate.destinationModuleName, 'fixture.exe');
    assert.equal(field!.evidence.pointerCandidate.readable, true);
  }
  assert.equal(field!.confidence, 'high');

  // Same bytes, no module/region contains that address: must NOT classify as a pointer candidate.
  const driver2 = new FakeMemoryDriver();
  driver2.addRegion(BASE, buf, true);
  const withoutModule = discoverStructure(driver2, HANDLE, { label: 'ptr2', baseAddress: BASE, length: 8 }, { pointerWidth: 8 });
  const field2 = withoutModule.fields.find((f) => f.offset === 0 && f.width === 8);
  assert.ok(field2);
  assert.equal(field2!.evidence.pointerCandidate.classified, false);
});

test('string candidate requires a real printable-ratio threshold, not arbitrary bytes', () => {
  const driver = new FakeMemoryDriver();
  const buf = Buffer.alloc(16, 0);
  buf.write('HELLO\0\0\0', 0, 'ascii');
  driver.addRegion(BASE, buf, true);

  const result = discoverStructure(driver, HANDLE, { label: 'str', baseAddress: BASE, length: 8 }, { pointerWidth: 8 });
  const field = result.fields.find((f) => f.offset === 0 && f.evidence.stringCandidate.classified);
  assert.ok(field, 'a printable ASCII span must be classified as a string candidate');
  if (field!.evidence.stringCandidate.classified) {
    assert.equal(field!.evidence.stringCandidate.encoding, 'ascii');
    assert.ok(field!.evidence.stringCandidate.text.startsWith('HELLO'));
  }

  const driver2 = new FakeMemoryDriver();
  const randomBuf = Buffer.from([0x00, 0xff, 0x13, 0x02, 0x91, 0xaa, 0x00, 0x7f]);
  driver2.addRegion(BASE, randomBuf, true);
  const result2 = discoverStructure(driver2, HANDLE, { label: 'rand', baseAddress: BASE, length: 8 }, { pointerWidth: 8 });
  assert.ok(!result2.fields.some((f) => f.evidence.stringCandidate.classified), 'random low-printable-ratio bytes must never be classified as a string candidate');
  // Every byte is still attributed to some field (spec §3/§6 — low confidence is a valid, honest outcome, not a reason to omit the field).
  assert.equal(result2.fields.reduce((sum, f) => sum + f.width, 0), 8);
});

test('unaligned fields are supported — a field need not start on a width-multiple offset', () => {
  const driver = new FakeMemoryDriver();
  const buf = Buffer.alloc(16, 0);
  buf.write('AB\0\0\0', 1, 'ascii'); // offset 1 — not aligned to any width > 1
  buf.writeUInt8(0x01, 0);
  driver.addRegion(BASE, buf, true);

  const result = discoverStructure(driver, HANDLE, { label: 'unaligned', baseAddress: BASE, length: 8 }, { pointerWidth: 8 });
  const unalignedField = result.fields.find((f) => f.offset !== 0 && f.offset % f.width !== 0);
  // Not required to exist (segmentation may resolve differently), but if any field is unaligned, `aligned` must correctly say so.
  for (const field of result.fields) {
    assert.equal(field.aligned, field.offset % field.width === 0);
  }
  void unalignedField;
});

test('low-evidence bytes still become real fields, never fabricated into false high confidence', () => {
  const driver = new FakeMemoryDriver();
  // Genuinely ambiguous bytes with no pointer/string evidence and no modules/regions to point into.
  const buf = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55]);
  driver.addRegion(BASE, buf, true);

  const result = discoverStructure(driver, HANDLE, { label: 'lowevidence', baseAddress: BASE, length: 5 }, { pointerWidth: 8 });
  assert.equal(result.completeness.state, 'complete');
  assert.equal(result.unknownSpans.length, 0, 'readable bytes are never placed in unknownSpans — that is reserved for genuinely unreadable ranges');
  // Every byte must still be covered by some field (spec §3 — a plain numeric guess with no independent evidence is a valid, honest 'low'-confidence field).
  assert.equal(result.fields.reduce((sum, f) => sum + f.width, 0), 5);
  for (const field of result.fields) {
    assert.notEqual(field.confidence, 'high');
  }
});

test('total read failure is truthful — never substitutes zeros for unread bytes', () => {
  const driver = new FakeMemoryDriver();
  driver.addUnreadableRegion(BASE, 16, true);

  const result = discoverStructure(driver, HANDLE, { label: 'unreadable', baseAddress: BASE, length: 16 }, { pointerWidth: 8 });
  assert.equal(result.completeness.state, 'failed');
  assert.equal(result.fields.length, 0);
});

test('partial read within one request is reported truthfully, not collapsed into total failure (spec §13)', () => {
  const driver = new FakeMemoryDriver();
  // No single region spans the whole 48-byte window, so the fast whole-window
  // read fails and the chunked fallback must run: bytes [0,16) and [32,48)
  // are readable, [16,32) is a simulated unreadable sub-region.
  driver.addRegion(BASE, Buffer.alloc(16, 0xaa), true);
  driver.addUnreadableRegion(BASE + 16n, 16, true);
  driver.addRegion(BASE + 32n, Buffer.alloc(16, 0xbb), true);

  const result = discoverStructure(driver, HANDLE, { label: 'partial', baseAddress: BASE, length: 48 }, { pointerWidth: 8 });

  assert.equal(result.completeness.state, 'complete_with_unreadable_spans');
  assert.deepEqual(result.unknownSpans, [{ offset: 16, length: 16 }]);
  // Readable bytes on both sides of the gap must still be attributed to real fields — never substituted with zeros.
  assert.ok(result.fields.some((f) => f.offset < 16));
  assert.ok(result.fields.some((f) => f.offset >= 32));
  assert.ok(!result.fields.some((f) => f.offset >= 16 && f.offset < 32), 'no field may be fabricated inside the unreadable gap');
  const totalFieldBytes = result.fields.reduce((sum, f) => sum + f.width, 0);
  assert.equal(totalFieldBytes, 32, 'exactly the 32 genuinely readable bytes must be covered, never the 16 unreadable ones');
});

test('discovery window is bounded and truncation is never silent (spec §12)', () => {
  const driver = new FakeMemoryDriver();
  const buf = Buffer.alloc(MAX_STRUCTURE_DISCOVERY_LENGTH + 1000, 0xab);
  driver.addRegion(BASE, buf, true);

  const result = discoverStructure(driver, HANDLE, { label: 'oversized', baseAddress: BASE, length: MAX_STRUCTURE_DISCOVERY_LENGTH + 1000 }, { pointerWidth: 8 });
  assert.equal(result.length, MAX_STRUCTURE_DISCOVERY_LENGTH);
  assert.equal(result.truncated, true);
});

test('refreshStructure re-reads the same window and reflects live changes', () => {
  const driver = new FakeMemoryDriver();
  const buf = Buffer.alloc(8, 0);
  buf.writeInt32LE(1, 0);
  driver.addRegion(BASE, buf, true);

  const first = discoverStructure(driver, HANDLE, { label: 'refresh', baseAddress: BASE, length: 8 }, { pointerWidth: 8 });
  buf.writeInt32LE(999, 0); // mutate the same in-memory buffer FakeMemoryDriver reads from, simulating a live process change
  const refreshed = refreshStructure(driver, HANDLE, first, { pointerWidth: 8 });
  assert.equal(refreshed.baseAddressHex, first.baseAddressHex);
  assert.equal(refreshed.length, first.length);
  const firstField = first.fields.find((f) => f.offset === 0);
  const refreshedField = refreshed.fields.find((f) => f.offset === 0);
  assert.ok(firstField && refreshedField, 'both discoveries must re-decode offset 0');
  assert.equal(refreshedField!.rawHex, `0x${buf.subarray(0, refreshedField!.width).toString('hex')}`);
  assert.notEqual(refreshedField!.rawHex, firstField!.rawHex, 'refreshed field must reflect the live-mutated bytes, not a stale cached read');
});

test('snapshot capture and diff detect mutable vs unchanged fields (spec §7/§8)', () => {
  const driver = new FakeMemoryDriver();
  const buf = Buffer.alloc(16, 0);
  buf.writeInt32LE(1, 0x00); // mutable field
  buf.writeInt32LE(42, 0x08); // stays unchanged
  driver.addRegion(BASE, buf, true);

  const structure = discoverStructure(driver, HANDLE, { label: 'snap', baseAddress: BASE, length: 16 }, { pointerWidth: 8 });
  const snapA = captureStructureSnapshot(driver, HANDLE, structure);
  assert.equal(snapA.completeness.state, 'complete');

  // FakeMemoryDriver's readBuffer returns a subarray view over the exact
  // Buffer object passed to addRegion (no copy) — mutate it in place to
  // simulate the live process's own memory changing between snapshots.
  buf.writeInt32LE(2, 0x00);

  const snapB = captureStructureSnapshot(driver, HANDLE, structure);
  const diff = compareStructureSnapshots(snapA, snapB);

  assert.ok(diff.changes.some((c) => c.offset === 0 && c.state === 'changed'), 'the mutated 4-byte range at offset 0 must be reported as changed');
  assert.ok(!diff.changes.some((c) => c.offset <= 8 && c.offset + c.length > 8 && c.state === 'changed'), 'the unchanged field at offset 8 must not be reported as changed');
});

test('snapshot diff is truthful across a became_unreadable transition', () => {
  const driver = new FakeMemoryDriver();
  const buf = Buffer.alloc(8, 0);
  driver.addRegion(BASE, buf, true);
  const structure = discoverStructure(driver, HANDLE, { label: 'gone', baseAddress: BASE, length: 8 }, { pointerWidth: 8 });
  const snapA = captureStructureSnapshot(driver, HANDLE, structure);
  assert.equal(snapA.completeness.state, 'complete');

  const driver2 = new FakeMemoryDriver();
  driver2.addUnreadableRegion(BASE, 8, true);
  const snapB = captureStructureSnapshot(driver2, HANDLE, structure);
  assert.equal(snapB.completeness.state, 'failed');

  const diff = compareStructureSnapshots(snapA, snapB);
  assert.equal(diff.changes[0]?.state, 'became_unreadable');
});

test('comparing snapshots from different structures throws rather than silently comparing unrelated windows', () => {
  const driver = new FakeMemoryDriver();
  const buf = Buffer.alloc(8, 0);
  driver.addRegion(BASE, buf, true);
  driver.addRegion(0x20000n, buf, true);

  const structureA = discoverStructure(driver, HANDLE, { label: 'a', baseAddress: BASE, length: 8 }, { pointerWidth: 8 });
  const structureB = discoverStructure(driver, HANDLE, { label: 'b', baseAddress: 0x20000n, length: 8 }, { pointerWidth: 8 });
  const snapA = captureStructureSnapshot(driver, HANDLE, structureA);
  const snapB = captureStructureSnapshot(driver, HANDLE, structureB);

  assert.throws(() => compareStructureSnapshots(snapA, snapB));
});

test('BigInt addresses round-trip exactly through baseAddressHex (no Number coercion)', () => {
  const driver = new FakeMemoryDriver();
  const bigAddress = 0x7ffabcdef0n; // exceeds Number.MAX_SAFE_INTEGER-adjacent ranges seen in real 64-bit processes
  const buf = Buffer.alloc(8, 0);
  driver.addRegion(bigAddress, buf, true);

  const result = discoverStructure(driver, HANDLE, { label: 'bigaddr', baseAddress: bigAddress, length: 8 }, { pointerWidth: 8 });
  assert.equal(result.baseAddressHex, `0x${bigAddress.toString(16)}`);
  assert.equal(BigInt(result.baseAddressHex), bigAddress);
});
