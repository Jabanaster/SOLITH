import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import { scanFirst, scanFirstAutoMatrix, scanFirstRange, scanNext } from '../../src/core/live-memory/memory-scanner.js';

const HANDLE = { pid: 1234, opaque: { fake: true } };

function filledBuffer(size: number, fill = 0xaa): Buffer {
  return Buffer.alloc(size, fill);
}

test('scanFirst finds a value at an aligned offset within a single writable region', () => {
  const driver = new FakeMemoryDriver();
  const region = filledBuffer(64);
  region.writeInt32LE(500, 8);
  driver.addRegion(0x1000n, region, true);

  const result = scanFirst(driver, HANDLE, 'int32', 500);

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].address, 0x1008n);
  assert.equal(result.matches[0].value, 500);
  assert.equal(result.truncated, false);
  assert.equal(result.regionsScanned, 1);
});

test('scanFirst finds matches across multiple regions', () => {
  const driver = new FakeMemoryDriver();
  const regionA = filledBuffer(32);
  regionA.writeInt32LE(9999, 0);
  const regionB = filledBuffer(32);
  regionB.writeInt32LE(9999, 16);
  driver.addRegion(0x2000n, regionA, true);
  driver.addRegion(0x3000n, regionB, true);

  const result = scanFirst(driver, HANDLE, 'int32', 9999);

  const addresses = result.matches.map((m) => m.address).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert.deepEqual(addresses, [0x2000n, 0x3010n]);
  assert.equal(result.regionsScanned, 2);
});

test('scanFirst excludes non-writable regions entirely', () => {
  const driver = new FakeMemoryDriver();
  const readOnly = filledBuffer(32);
  readOnly.writeInt32LE(777, 4);
  driver.addRegion(0x4000n, readOnly, false);

  const result = scanFirst(driver, HANDLE, 'int32', 777);

  assert.equal(result.matches.length, 0);
  assert.equal(result.regionsScanned, 0);
});

test('scanFirst only counts occurrences aligned to the value size, not raw byte matches', () => {
  const driver = new FakeMemoryDriver();
  const region = filledBuffer(64);
  region.writeInt32LE(500, 8); // aligned: offset 8 % 4 === 0
  region.writeInt32LE(500, 21); // unaligned: offset 21 % 4 !== 0, non-overlapping with the aligned write above
  driver.addRegion(0x5000n, region, true);

  const result = scanFirst(driver, HANDLE, 'int32', 500);

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].address, 0x5008n);
});

test('scanFirst skips a region larger than maxRegionBytes', () => {
  const driver = new FakeMemoryDriver();
  const region = filledBuffer(128);
  region.writeInt32LE(42, 0);
  driver.addRegion(0x6000n, region, true);

  const result = scanFirst(driver, HANDLE, 'int32', 42, { maxRegionBytes: 64 });

  assert.equal(result.matches.length, 0);
  assert.equal(result.regionsScanned, 0);
});

test('scanFirst stops and reports truncated when maxTotalBytes is exceeded', () => {
  const driver = new FakeMemoryDriver();
  const regionA = filledBuffer(64);
  regionA.writeInt32LE(1, 0);
  const regionB = filledBuffer(64);
  regionB.writeInt32LE(1, 0);
  driver.addRegion(0x7000n, regionA, true);
  driver.addRegion(0x8000n, regionB, true);

  const result = scanFirst(driver, HANDLE, 'int32', 1, { maxTotalBytes: 64 });

  assert.equal(result.truncated, true);
  assert.equal(result.regionsScanned, 1);
  assert.equal(result.matches.length, 1);
});

test('scanFirst stops and reports truncated when maxMatches is reached', () => {
  const driver = new FakeMemoryDriver();
  const region = filledBuffer(64);
  for (let offset = 0; offset < 64; offset += 4) {
    region.writeInt32LE(7, offset);
  }
  driver.addRegion(0x9000n, region, true);

  const result = scanFirst(driver, HANDLE, 'int32', 7, { maxMatches: 3 });

  assert.equal(result.matches.length, 3);
  assert.equal(result.truncated, true);
});

test('scanFirst skips a region that becomes unreadable without aborting the whole scan', () => {
  const driver = new FakeMemoryDriver();
  const good = filledBuffer(32);
  good.writeInt32LE(55, 0);
  driver.addRegion(0xa000n, good, true);
  // Appears in getRegions() but readBuffer() throws for it — simulates a region freed
  // or reprotected between enumeration and read.
  driver.addUnreadableRegion(0xb000n, 32, true);

  const result = scanFirst(driver, HANDLE, 'int32', 55);

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].address, 0xa000n);
  // The unreadable region was skipped, not counted as scanned, and did not abort the scan.
  assert.equal(result.regionsScanned, 1);
});

test('scanNext (exact): keeps only addresses whose current value matches the target', () => {
  const driver = new FakeMemoryDriver();
  driver.setValue(0x100n, 500);
  driver.setValue(0x200n, 999);

  const previous = [
    { address: 0x100n, value: 500 },
    { address: 0x200n, value: 500 },
  ];

  const result = scanNext(driver, HANDLE, 'int32', { kind: 'exact', value: 500 }, previous);

  assert.equal(result.length, 1);
  assert.equal(result[0].address, 0x100n);
  assert.equal(result[0].value, 500);
});

test('scanNext (changed): keeps addresses whose value differs from the prior scan', () => {
  const driver = new FakeMemoryDriver();
  driver.setValue(0x100n, 500); // unchanged from prior
  driver.setValue(0x200n, 600); // changed from prior (was 500)

  const previous = [
    { address: 0x100n, value: 500 },
    { address: 0x200n, value: 500 },
  ];

  const result = scanNext(driver, HANDLE, 'int32', { kind: 'changed' }, previous);

  assert.equal(result.length, 1);
  assert.equal(result[0].address, 0x200n);
  assert.equal(result[0].value, 600);
});

test('scanNext (unchanged): keeps addresses whose value matches the prior scan', () => {
  const driver = new FakeMemoryDriver();
  driver.setValue(0x100n, 500);
  driver.setValue(0x200n, 600);

  const previous = [
    { address: 0x100n, value: 500 },
    { address: 0x200n, value: 500 },
  ];

  const result = scanNext(driver, HANDLE, 'int32', { kind: 'unchanged' }, previous);

  assert.equal(result.length, 1);
  assert.equal(result[0].address, 0x100n);
});

test('scanNext (increased / decreased): direction-based narrowing, e.g. health went down', () => {
  const driver = new FakeMemoryDriver();
  driver.setValue(0x100n, 80); // was 100 -> decreased
  driver.setValue(0x200n, 120); // was 100 -> increased

  const previous = [
    { address: 0x100n, value: 100 },
    { address: 0x200n, value: 100 },
  ];

  const decreased = scanNext(driver, HANDLE, 'int32', { kind: 'decreased' }, previous);
  assert.equal(decreased.length, 1);
  assert.equal(decreased[0].address, 0x100n);

  const increased = scanNext(driver, HANDLE, 'int32', { kind: 'increased' }, previous);
  assert.equal(increased.length, 1);
  assert.equal(increased[0].address, 0x200n);
});

test('scanNext drops addresses that fail to read instead of throwing', () => {
  const driver = new FakeMemoryDriver();
  driver.setValue(0x100n, 500); // readable
  // 0x999n is never seeded — readMemory will throw for it.

  const previous = [
    { address: 0x100n, value: 500 },
    { address: 0x999n, value: 500 },
  ];

  const result = scanNext(driver, HANDLE, 'int32', { kind: 'exact', value: 500 }, previous);

  assert.equal(result.length, 1);
  assert.equal(result[0].address, 0x100n);
});

test('scanFirstRange keeps aligned floats inside an inclusive window', () => {
  const driver = new FakeMemoryDriver();
  const region = filledBuffer(32);
  region.writeFloatLE(60.7, 0);
  region.writeFloatLE(61.0, 4);
  region.writeFloatLE(62.5, 8);
  driver.addRegion(0x2000n, region, true);

  const result = scanFirstRange(driver, HANDLE, 'float', 60.5, 61.5);

  assert.equal(result.matches.length, 2);
  assert.deepEqual(
    result.matches.map((m) => m.address).sort(),
    [0x2000n, 0x2004n],
  );
});

test('scanFirstRange ignores unaligned values at memory boundaries', () => {
  const driver = new FakeMemoryDriver();
  const region = filledBuffer(9, 0);
  region.writeFloatLE(61.0, 1);
  driver.addRegion(0x3000n, region, true);

  const result = scanFirstRange(driver, HANDLE, 'float', 60.5, 61.5);

  assert.equal(result.matches.length, 0);
  assert.equal(result.regionsScanned, 1);
  assert.equal(result.truncated, false);
});

test('scanFirstRange does not read past short region ends', () => {
  const driver = new FakeMemoryDriver();
  const region = filledBuffer(6, 0);
  region.writeInt32LE(100, 0);
  driver.addRegion(0x4000n, region, true);

  const result = scanFirstRange(driver, HANDLE, 'double', 99, 101);

  assert.equal(result.matches.length, 0);
  assert.equal(result.regionsScanned, 1);
  assert.equal(result.truncated, false);
});

test('scanFirstRange includes exact min and max edge values', () => {
  const driver = new FakeMemoryDriver();
  const region = filledBuffer(24, 0);
  region.writeInt32LE(10, 0);
  region.writeInt32LE(15, 4);
  region.writeInt32LE(20, 8);
  region.writeInt32LE(21, 12);
  driver.addRegion(0x5000n, region, true);

  const result = scanFirstRange(driver, HANDLE, 'int32', 10, 20);

  assert.deepEqual(
    result.matches.map((m) => m.address),
    [0x5000n, 0x5004n, 0x5008n],
  );
});

test('scanFirstRange rejects inverted ranges before reading memory', () => {
  const driver = new FakeMemoryDriver();
  const region = filledBuffer(16);
  driver.addRegion(0x6000n, region, true);

  assert.throws(
    () => scanFirstRange(driver, HANDLE, 'int32', 20, 10),
    /scanFirstRange requires min <= max/,
  );
});

test('scanFirstRange stops and reports truncated when total byte budget is exceeded', () => {
  const driver = new FakeMemoryDriver();
  const regionA = filledBuffer(16, 0);
  const regionB = filledBuffer(16, 0);
  regionA.writeInt32LE(7, 0);
  regionB.writeInt32LE(7, 0);
  driver.addRegion(0x7000n, regionA, true);
  driver.addRegion(0x8000n, regionB, true);

  const result = scanFirstRange(driver, HANDLE, 'int32', 7, 7, { maxTotalBytes: 16 });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].address, 0x7000n);
  assert.equal(result.regionsScanned, 1);
  assert.equal(result.truncated, true);
});

test('scanFirstRange stops and reports truncated when maxMatches is reached', () => {
  const driver = new FakeMemoryDriver();
  const region = filledBuffer(32, 0);
  for (let offset = 0; offset < 32; offset += 4) {
    region.writeInt32LE(3, offset);
  }
  driver.addRegion(0x9000n, region, true);

  const result = scanFirstRange(driver, HANDLE, 'int32', 3, 3, { maxMatches: 2 });

  assert.equal(result.matches.length, 2);
  assert.deepEqual(result.matches.map((m) => m.address), [0x9000n, 0x9004n]);
  assert.equal(result.truncated, true);
});

test('scanFirstRange skips unreadable regions without aborting later matches', () => {
  const driver = new FakeMemoryDriver();
  const good = filledBuffer(16, 0);
  good.writeFloatLE(61.0, 0);
  driver.addUnreadableRegion(0xa000n, 16, true);
  driver.addRegion(0xb000n, good, true);

  const result = scanFirstRange(driver, HANDLE, 'float', 60.5, 61.5);

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].address, 0xb000n);
  assert.equal(result.regionsScanned, 1);
  // A region was skipped because it was unreadable, so the scan did not
  // cover the full address space it was asked to cover. Reporting
  // truncated: false here would certify a false completeness claim.
  assert.equal(result.truncated, true);
});

test('scanFirstRange continues past an unreadable middle region and still finds a later match', () => {
  const driver = new FakeMemoryDriver();
  const before = filledBuffer(16, 0);
  before.writeFloatLE(61.0, 0);
  const after = filledBuffer(16, 0);
  after.writeFloatLE(61.0, 0);
  driver.addRegion(0x11000n, before, true);
  driver.addUnreadableRegion(0x12000n, 16, true);
  driver.addRegion(0x13000n, after, true);

  const result = scanFirstRange(driver, HANDLE, 'float', 60.5, 61.5);

  assert.deepEqual(
    result.matches.map((m) => m.address),
    [0x11000n, 0x13000n],
  );
  assert.equal(result.regionsScanned, 2);
  assert.equal(result.truncated, true);
});

test('scanFirstRange preserves earlier matches when the final region is unreadable', () => {
  const driver = new FakeMemoryDriver();
  const good = filledBuffer(16, 0);
  good.writeFloatLE(61.0, 0);
  driver.addRegion(0x14000n, good, true);
  driver.addUnreadableRegion(0x15000n, 16, true);

  const result = scanFirstRange(driver, HANDLE, 'float', 60.5, 61.5);

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].address, 0x14000n);
  assert.equal(result.regionsScanned, 1);
  assert.equal(result.truncated, true);
});

test('scanFirstRange reports truncated: false when every requested region is readable', () => {
  const driver = new FakeMemoryDriver();
  const region = filledBuffer(16, 0);
  region.writeFloatLE(61.0, 0);
  driver.addRegion(0x16000n, region, true);

  const result = scanFirstRange(driver, HANDLE, 'float', 60.5, 61.5);

  assert.equal(result.matches.length, 1);
  assert.equal(result.truncated, false);
});

test('scanFirstRange reports truncated: true with zero matches when the only region is unreadable', () => {
  const driver = new FakeMemoryDriver();
  driver.addUnreadableRegion(0x17000n, 16, true);

  const result = scanFirstRange(driver, HANDLE, 'float', 60.5, 61.5);

  assert.equal(result.matches.length, 0);
  assert.equal(result.regionsScanned, 0);
  assert.equal(result.truncated, true);
});

test('scanFirstRange keeps scanning after multiple unreadable regions and still reports truncated', () => {
  const driver = new FakeMemoryDriver();
  const good = filledBuffer(16, 0);
  good.writeFloatLE(61.0, 0);
  driver.addUnreadableRegion(0x18000n, 16, true);
  driver.addRegion(0x19000n, good, true);
  driver.addUnreadableRegion(0x1a000n, 16, true);

  const result = scanFirstRange(driver, HANDLE, 'float', 60.5, 61.5);

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].address, 0x19000n);
  assert.equal(result.regionsScanned, 1);
  assert.equal(result.truncated, true);
});

test('scanFirstAutoMatrix scans all requested modes and value types in one read-only matrix', () => {
  const driver = new FakeMemoryDriver();
  const region = filledBuffer(64, 0);
  region.writeInt32LE(125, 0);
  region.writeFloatLE(125, 4);
  region.writeInt32LE(200, 8);
  region.writeFloatLE(50.5, 12);
  driver.addRegion(0xc000n, region, true);

  const result = scanFirstAutoMatrix(driver, HANDLE, {
    value: 125,
    min: 120,
    max: 130,
    dataTypes: ['int32', 'float'],
    modes: ['exact', 'between', 'greaterThan', 'lessThan'],
    bounds: { maxMatches: 20 },
    includeUnknown: true,
  });

  assert.equal(result.readOnly, true);
  assert.equal(result.executable, false);
  assert.equal(result.totals.buckets, 8);
  assert.equal(result.totals.skippedBuckets, 0);
  assert.equal(result.totals.unknownCaptured, true);
  assert.ok(result.unknown);

  const exactInt = result.buckets.find((bucket) => bucket.mode === 'exact' && bucket.dataType === 'int32');
  assert.ok(exactInt);
  assert.ok(exactInt.matches.some((match) => match.address === 0xc000n && match.dataType === 'int32'));

  const exactFloat = result.buckets.find((bucket) => bucket.mode === 'exact' && bucket.dataType === 'float');
  assert.ok(exactFloat);
  assert.ok(exactFloat.matches.some((match) => match.address === 0xc004n && match.dataType === 'float'));

  const greaterInt = result.buckets.find((bucket) => bucket.mode === 'greaterThan' && bucket.dataType === 'int32');
  assert.ok(greaterInt);
  assert.ok(greaterInt.matches.some((match) => match.address === 0xc008n && match.value === 200));

  const lessFloat = result.buckets.find((bucket) => bucket.mode === 'lessThan' && bucket.dataType === 'float');
  assert.ok(lessFloat);
  assert.ok(lessFloat.matches.some((match) => match.address === 0xc00cn && match.dataType === 'float'));
});

test('scanFirstAutoMatrix marks incompatible buckets skipped instead of guessing missing values', () => {
  const driver = new FakeMemoryDriver();
  driver.addRegion(0xd000n, filledBuffer(16, 0), true);

  const result = scanFirstAutoMatrix(driver, HANDLE, {
    dataTypes: ['int32', 'float'],
    modes: ['exact', 'between'],
    includeUnknown: false,
  });

  assert.equal(result.totals.buckets, 4);
  assert.equal(result.totals.skippedBuckets, 4);
  assert.ok(result.buckets.every((bucket) => bucket.skipped));
  assert.equal(result.totals.unknownCaptured, false);
});
