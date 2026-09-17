import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import { scanForPointerPath } from '../../src/core/live-memory/pointer-scanner.js';
import { resolvePointerPath } from '../../src/core/live-memory/pointer-resolver.js';

const HANDLE = { pid: 1234, opaque: { fake: true } };

test('finds a direct (depth 1) module -> heap pointer path, and resolvePointerPath reconstructs the target', () => {
  const driver = new FakeMemoryDriver();

  // Module data section: a static pointer at module+0x2000 pointing to the start of a heap object.
  const moduleRegion = Buffer.alloc(0x3000, 0);
  const heapBase = 0x10000000n;
  moduleRegion.writeBigUInt64LE(heapBase, 0x2000);
  driver.addRegion(0x400000n, moduleRegion, true);
  driver.addModule('game.exe', 0x400000n, 0x100000);

  // Heap object: the actual value lives 16 bytes into it.
  const heapRegion = Buffer.alloc(64, 0);
  heapRegion.writeInt32LE(999999, 16);
  driver.addRegion(heapBase, heapRegion, true);

  const targetAddress = heapBase + 16n;
  const result = scanForPointerPath(driver, HANDLE, targetAddress);

  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.moduleName, 'game.exe');
  assert.equal(candidate.moduleOffset, 0x2000);
  assert.deepEqual(candidate.offsets, [16]);
  assert.equal(candidate.depth, 1);

  const resolved = resolvePointerPath(driver, HANDLE, candidate);
  assert.equal(resolved, targetAddress);
});

test('finds a two-level (depth 2) pointer chain through an intermediate heap object', () => {
  const driver = new FakeMemoryDriver();

  const moduleRegion = Buffer.alloc(0x3000, 0);
  const intermediateBase = 0x10000000n;
  moduleRegion.writeBigUInt64LE(intermediateBase, 0x2000);
  driver.addRegion(0x400000n, moduleRegion, true);
  driver.addModule('game.exe', 0x400000n, 0x100000);

  const intermediateRegion = Buffer.alloc(64, 0);
  const finalBase = 0x20000000n;
  intermediateRegion.writeBigUInt64LE(finalBase, 8); // pointer to the final object, at +8 in the intermediate object
  driver.addRegion(intermediateBase, intermediateRegion, true);

  const finalRegion = Buffer.alloc(64, 0);
  finalRegion.writeInt32LE(42, 24);
  driver.addRegion(finalBase, finalRegion, true);

  const targetAddress = finalBase + 24n;
  const result = scanForPointerPath(driver, HANDLE, targetAddress);

  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.moduleName, 'game.exe');
  assert.equal(candidate.moduleOffset, 0x2000);
  assert.deepEqual(candidate.offsets, [8, 24]);
  assert.equal(candidate.depth, 2);

  const resolved = resolvePointerPath(driver, HANDLE, candidate);
  assert.equal(resolved, targetAddress);
});

test('does not find a path when maxDepth is too shallow to reach the module', () => {
  const driver = new FakeMemoryDriver();

  const moduleRegion = Buffer.alloc(0x3000, 0);
  const intermediateBase = 0x10000000n;
  moduleRegion.writeBigUInt64LE(intermediateBase, 0x2000);
  driver.addRegion(0x400000n, moduleRegion, true);
  driver.addModule('game.exe', 0x400000n, 0x100000);

  const intermediateRegion = Buffer.alloc(64, 0);
  const finalBase = 0x20000000n;
  intermediateRegion.writeBigUInt64LE(finalBase, 8);
  driver.addRegion(intermediateBase, intermediateRegion, true);

  const finalRegion = Buffer.alloc(64, 0);
  finalRegion.writeInt32LE(42, 24);
  driver.addRegion(finalBase, finalRegion, true);

  const targetAddress = finalBase + 24n;
  const result = scanForPointerPath(driver, HANDLE, targetAddress, { maxDepth: 1 });

  assert.equal(result.candidates.length, 0);
  assert.equal(result.levelsSearched, 1);
  // D05: finding nothing because the search was capped is not the same answer
  // as finding nothing because there is nothing to find.
  assert.equal(result.termination, 'depth_limit_reached');
  assert.equal(result.truncated, true);
  assert.equal(result.isAuthoritativeAbsence, false);
});

test('does not find a path when the real offset exceeds maxOffsetPerLevel', () => {
  const driver = new FakeMemoryDriver();

  const moduleRegion = Buffer.alloc(0x3000, 0);
  const heapBase = 0x10000000n;
  moduleRegion.writeBigUInt64LE(heapBase, 0x2000);
  driver.addRegion(0x400000n, moduleRegion, true);
  driver.addModule('game.exe', 0x400000n, 0x100000);

  const heapRegion = Buffer.alloc(64, 0);
  heapRegion.writeInt32LE(999999, 16); // real offset is 16
  driver.addRegion(heapBase, heapRegion, true);

  const targetAddress = heapBase + 16n;
  const result = scanForPointerPath(driver, HANDLE, targetAddress, { maxOffsetPerLevel: 8 });

  assert.equal(result.candidates.length, 0);
});

test('a pointer stored in a region larger than maxRegionBytes is not found (region skipped)', () => {
  const driver = new FakeMemoryDriver();

  const moduleRegion = Buffer.alloc(1024, 0);
  const heapBase = 0x10000000n;
  moduleRegion.writeBigUInt64LE(heapBase, 512);
  driver.addRegion(0x400000n, moduleRegion, true);
  driver.addModule('game.exe', 0x400000n, 0x100000);

  const heapRegion = Buffer.alloc(64, 0);
  heapRegion.writeInt32LE(1, 16);
  driver.addRegion(heapBase, heapRegion, true);

  const targetAddress = heapBase + 16n;
  const result = scanForPointerPath(driver, HANDLE, targetAddress, { maxRegionBytes: 512 });

  assert.equal(result.candidates.length, 0);
  // D05/D01: a region excluded purely for exceeding maxRegionBytes is a region
  // that was never examined, so the empty result must not claim completeness.
  assert.ok(
    result.skippedRegions.some((r) => r.baseAddress === 0x400000n),
    'the oversized region must be recorded as skipped',
  );
  assert.equal(result.completeness.state, 'complete_with_skipped_regions');
  assert.equal(result.truncated, true);
  assert.equal(result.isAuthoritativeAbsence, false);
});

test('resolvePointerPath throws a clear error when the module is not loaded', () => {
  const driver = new FakeMemoryDriver();
  assert.throws(
    () => resolvePointerPath(driver, HANDLE, { moduleName: 'missing.dll', moduleOffset: 0, offsets: [0] }),
    /not currently loaded/i,
  );
});

test('resolvePointerPath re-resolves correctly against a moved module base (simulating ASLR across a restart)', () => {
  // Same pointer path, but the module now loads at a different base address — the offset chain
  // must still resolve correctly, since that is the entire point of a module-relative path.
  const driver = new FakeMemoryDriver();

  const moduleRegion = Buffer.alloc(0x3000, 0);
  const heapBase = 0x50000000n;
  moduleRegion.writeBigUInt64LE(heapBase, 0x2000);
  const newModuleBase = 0x7ff600000000n; // a different ASLR-style base than earlier tests
  driver.addRegion(newModuleBase, moduleRegion, true);
  driver.addModule('game.exe', newModuleBase, 0x100000);

  const heapRegion = Buffer.alloc(64, 0);
  heapRegion.writeInt32LE(12345, 16);
  driver.addRegion(heapBase, heapRegion, true);

  const path = { moduleName: 'game.exe', moduleOffset: 0x2000, offsets: [16] };
  const resolved = resolvePointerPath(driver, HANDLE, path);

  assert.equal(resolved, heapBase + 16n);
});
