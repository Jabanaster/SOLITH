// Phase 2 P2-6 — Typed memory-view expansion. Pure engine tests against a
// fake driver; real-process/real-game proof lives in
// typed-memory-view-real-process.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import {
  readTypedMemoryView,
  readTypedMemoryViews,
  reinterpretRawHex,
  MAX_TYPED_VIEW_BATCH,
} from '../../src/core/live-memory/typed-memory-view.js';

const HANDLE = { pid: 4242, opaque: { fake: true } };
const BASE = 0x20000n;

test('readTypedMemoryView decodes every width the read bytes support, side by side (spec §6 reinterpretation)', () => {
  const driver = new FakeMemoryDriver();
  const buf = Buffer.alloc(8);
  buf.writeInt32LE(-100, 0);
  buf.writeInt32LE(200, 4);
  driver.addRegion(BASE, buf, true);

  const view = readTypedMemoryView(driver, HANDLE, { address: BASE, length: 8 });

  assert.equal(view.readState, 'complete');
  assert.equal(view.actualLength, 8);
  assert.equal(view.rawHex, `0x${buf.toString('hex')}`);
  // Same leading bytes decoded simultaneously at every supported width.
  assert.ok(view.interpretationsByWidth[1]?.some((i) => i.kind === 'u8'));
  assert.ok(view.interpretationsByWidth[2]?.some((i) => i.kind === 'i16'));
  const width4 = view.interpretationsByWidth[4] ?? [];
  const i32 = width4.find((i) => i.kind === 'i32');
  assert.equal(i32?.value, '-100', 'i32 interpretation must be decode-exact, not semantic inference');
  assert.ok(width4.some((i) => i.kind === 'f32'), 'same 4 bytes must also be offered as float32 simultaneously');
  assert.ok(width4.some((i) => i.kind === 'pointer'), 'same 4 bytes must also be offered as a 32-bit pointer reading simultaneously');
  const width8 = view.interpretationsByWidth[8] ?? [];
  assert.ok(width8.some((i) => i.kind === 'i64'));
  assert.ok(width8.some((i) => i.kind === 'f64'));
});

test('64-bit integers remain exact — no unsafe BigInt-to-Number coercion', () => {
  const driver = new FakeMemoryDriver();
  const buf = Buffer.alloc(8);
  // A value well outside Number.MAX_SAFE_INTEGER — would silently lose
  // precision under any Number() round-trip.
  buf.writeBigUInt64LE(0xffeeddccbbaa9988n, 0);
  driver.addRegion(BASE, buf, true);

  const view = readTypedMemoryView(driver, HANDLE, { address: BASE, length: 8 });
  const u64 = (view.interpretationsByWidth[8] ?? []).find((i) => i.kind === 'u64');
  assert.equal(u64?.value, buf.readBigUInt64LE(0).toString(), 'u64 value must round-trip exactly as a bigint-derived decimal string');
});

test('a short window only reports interpretations for widths it can actually support', () => {
  const driver = new FakeMemoryDriver();
  const buf = Buffer.from([0x11, 0x22]);
  driver.addRegion(BASE, buf, true);

  const view = readTypedMemoryView(driver, HANDLE, { address: BASE, length: 2 });
  assert.equal(view.actualLength, 2);
  assert.ok(view.interpretationsByWidth[1]);
  assert.ok(view.interpretationsByWidth[2]);
  assert.equal(view.interpretationsByWidth[4], undefined, 'must never fabricate a 4-byte interpretation from only 2 real bytes');
  assert.equal(view.interpretationsByWidth[8], undefined);
});

test('an unreadable address is a truthful failure, never a fabricated zero-filled reading', () => {
  const driver = new FakeMemoryDriver();
  const view = readTypedMemoryView(driver, HANDLE, { address: 0xdeadbeefn, length: 4 });
  assert.equal(view.readState, 'failed');
  assert.equal(view.rawHex, null);
  assert.equal(view.actualLength, 0);
  assert.deepEqual(view.interpretationsByWidth, {});
  assert.ok(view.reason && view.reason.length > 0);
});

test('moduleName is populated only when the address genuinely falls inside a known module', () => {
  const driver = new FakeMemoryDriver();
  const buf = Buffer.alloc(4, 0xab);
  driver.addRegion(BASE, buf, true);
  driver.addModule('fixture.exe', BASE - 0x1000n, 0x2000);

  const inside = readTypedMemoryView(driver, HANDLE, { address: BASE, length: 4 });
  assert.equal(inside.moduleName, 'fixture.exe');

  driver.addRegion(0x90000n, Buffer.alloc(4, 0xcd), true);
  const outside = readTypedMemoryView(driver, HANDLE, { address: 0x90000n, length: 4 });
  assert.equal(outside.moduleName, null, 'an address outside every known module must never fabricate a module name');
});

test('readTypedMemoryViews processes each request independently — one bad address never hides the rest', () => {
  const driver = new FakeMemoryDriver();
  driver.addRegion(BASE, Buffer.alloc(4, 1), true);

  const results = readTypedMemoryViews(driver, HANDLE, [
    { address: BASE, length: 4 },
    { address: 0xbaadf00dn, length: 4 },
    { address: BASE, length: 2 },
  ]);
  assert.equal(results.length, 3);
  assert.equal(results[0].readState, 'complete');
  assert.equal(results[1].readState, 'failed');
  assert.equal(results[2].readState, 'complete');
});

test('readTypedMemoryViews is bounded — a request exceeding MAX_TYPED_VIEW_BATCH is clamped, never silently unbounded', () => {
  const driver = new FakeMemoryDriver();
  driver.addRegion(BASE, Buffer.alloc(4, 1), true);
  const oversized = Array.from({ length: MAX_TYPED_VIEW_BATCH + 25 }, () => ({ address: BASE, length: 4 as const }));
  const results = readTypedMemoryViews(driver, HANDLE, oversized);
  assert.equal(results.length, MAX_TYPED_VIEW_BATCH);
});

test('reinterpretRawHex recomputes every width from already-known bytes with no I/O (spec §6)', () => {
  const buf = Buffer.alloc(8);
  buf.writeInt32LE(-1, 0);
  buf.writeInt32LE(1, 4);
  const rawHex = `0x${buf.toString('hex')}`;

  const byWidth = reinterpretRawHex(rawHex);
  assert.ok(byWidth[1] && byWidth[2] && byWidth[4] && byWidth[8]);
  const i32 = (byWidth[4] ?? []).find((i) => i.kind === 'i32');
  assert.equal(i32?.value, '-1');
});

test('a valid multi-byte UTF-8 sequence is offered as a distinct utf8 reading alongside ascii/utf16', () => {
  const driver = new FakeMemoryDriver();
  // "café" — 'é' is U+00E9, encoded as 0xC3 0xA9 in UTF-8: genuinely
  // multi-byte, not representable identically as printable ASCII.
  const buf = Buffer.from('café', 'utf8');
  const padded = Buffer.concat([buf, Buffer.alloc(8 - buf.length, 0)]).subarray(0, 8);
  driver.addRegion(BASE, padded, true);

  const view = readTypedMemoryView(driver, HANDLE, { address: BASE, length: 8 });
  const width8 = view.interpretationsByWidth[8] ?? [];
  const utf8Reading = width8.find((i) => i.kind === 'utf8');
  assert.ok(utf8Reading, 'a genuinely multi-byte-encoded UTF-8 string must be offered as its own kind');
  assert.ok(utf8Reading!.value.includes('caf'), 'the decoded UTF-8 text must reflect the real bytes');
});

test('pure ASCII bytes are never duplicated as a redundant utf8 reading', () => {
  const driver = new FakeMemoryDriver();
  const buf = Buffer.alloc(8, 0);
  buf.write('HELLO', 0, 'ascii');
  driver.addRegion(BASE, buf, true);

  const view = readTypedMemoryView(driver, HANDLE, { address: BASE, length: 8 });
  const width8 = view.interpretationsByWidth[8] ?? [];
  assert.ok(!width8.some((i) => i.kind === 'utf8'), 'pure ASCII already has an ascii reading — a duplicate utf8 entry would add no information');
});
