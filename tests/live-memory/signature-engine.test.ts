import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  aobHammingDistance,
  aobBoundedEditDistance,
  findBestFuzzyAobInBuffer,
  findBestDriftAobInBuffer,
  resolveSignatureInBuffer,
  scanFuzzySignature,
  resolveSignature,
} from '../../src/core/live-memory/signature-engine.js';
import { parseAobSignature } from '../../src/core/live-memory/aob-resolver.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';

describe('signature-engine', () => {
  test('aobHammingDistance counts non-wildcard mismatches', () => {
    const pattern = parseAobSignature('48 8B 05 ? ? ? ?');
    const haystack = Buffer.from([0x48, 0x8b, 0x05, 0x11, 0x22, 0x33, 0x44]);
    assert.equal(aobHammingDistance(haystack, pattern, 0), 0);

    const drifted = Buffer.from([0x48, 0x8c, 0x05, 0x11, 0x22, 0x33, 0x44]);
    assert.equal(aobHammingDistance(drifted, pattern, 0), 1);
  });

  test('findBestFuzzyAobInBuffer finds closest match within maxDistance', () => {
    const pattern = parseAobSignature('DE AD BE EF');
    const haystack = Buffer.from([0x00, 0xde, 0xad, 0xbf, 0xef, 0x00]);
    const hit = findBestFuzzyAobInBuffer(haystack, pattern, 1);
    assert.ok(hit);
    assert.equal(hit!.offset, 1);
    assert.equal(hit!.distance, 1);
  });

  test('aobBoundedEditDistance tolerates a one-byte insert (byte-shift)', () => {
    const pattern = parseAobSignature('DE AD BE EF');
    // Inserted 0x00 between AD and BE
    const haystack = Buffer.from([0xde, 0xad, 0x00, 0xbe, 0xef]);
    const hit = aobBoundedEditDistance(haystack, pattern, 0, 1);
    assert.ok(hit);
    assert.equal(hit!.edits, 1);
    assert.equal(hit!.consumed, 5);
  });

  test('edit matching tolerates a one-byte deletion at the buffer boundary', () => {
    const pattern = parseAobSignature('DE AD BE EF');
    const haystack = Buffer.from([0xde, 0xad, 0xef]);
    const hit = findBestDriftAobInBuffer(haystack, pattern, {
      maxDistance: 0,
      maxEdits: 1,
    });
    assert.ok(hit);
    assert.equal(hit!.offset, 0);
    assert.equal(hit!.driftKind, 'edit');
    assert.equal(hit!.distance, 1);
  });

  test('findBestDriftAobInBuffer recovers inserted-byte drift via edit kind', () => {
    const pattern = parseAobSignature('11 22 33 44');
    const haystack = Buffer.from([0xff, 0x11, 0x22, 0x99, 0x33, 0x44, 0x00]);
    const hit = findBestDriftAobInBuffer(haystack, pattern, { maxDistance: 0, maxEdits: 1 });
    assert.ok(hit);
    assert.equal(hit!.driftKind, 'edit');
    assert.equal(hit!.offset, 1);
    assert.equal(hit!.distance, 1);
  });

  test('resolveSignatureInBuffer prefers exact over fuzzy', () => {
    const haystack = Buffer.from([0xaa, 0x48, 0x8b, 0x05, 0x01, 0x02, 0x03, 0x04]);
    const hit = resolveSignatureInBuffer(haystack, '48 8B 05 ? ? ? ?', 2, 1);
    assert.deepEqual(hit, { offset: 1, mode: 'exact', distance: 0, driftKind: 'hamming' });
  });

  test('scanFuzzySignature finds drifted pattern in process region', () => {
    const driver = new FakeMemoryDriver();
    const moduleBase = 0x400000n;
    driver.addModule('Demo.exe', moduleBase, 0x1000);
    const region = Buffer.alloc(64, 0);
    // Exact would be 48 8B 05 AA BB CC DD — drift one fixed byte (8B -> 8C)
    region.writeUInt8(0x48, 8);
    region.writeUInt8(0x8c, 9);
    region.writeUInt8(0x05, 10);
    region.writeUInt8(0xaa, 11);
    region.writeUInt8(0xbb, 12);
    region.writeUInt8(0xcc, 13);
    region.writeUInt8(0xdd, 14);
    driver.addRegion(moduleBase, region);

    const handle = driver.openProcess(1);
    const match = scanFuzzySignature(driver, handle, '48 8B 05 ? ? ? ?', {
      moduleName: 'Demo.exe',
      maxDistance: 1,
      maxEdits: 0,
    });
    assert.ok(match);
    assert.equal(match!.mode, 'fuzzy');
    assert.equal(match!.distance, 1);
    assert.equal(match!.driftKind, 'hamming');
    assert.equal(match!.address, moduleBase + 8n);
  });

  test('scanFuzzySignature respects hintAddress shift window', () => {
    const driver = new FakeMemoryDriver();
    const moduleBase = 0x400000n;
    driver.addModule('Demo.exe', moduleBase, 0x1000);
    const region = Buffer.alloc(256, 0);
    // Pattern only at offset 200 — far from a wrong hint near 0
    region.writeUInt8(0xde, 200);
    region.writeUInt8(0xad, 201);
    region.writeUInt8(0xbe, 202);
    region.writeUInt8(0xef, 203);
    driver.addRegion(moduleBase, region);
    const handle = driver.openProcess(1);

    const miss = scanFuzzySignature(driver, handle, 'DE AD BE EF', {
      moduleName: 'Demo.exe',
      hintAddress: moduleBase + 8n,
      maxShiftBytes: 16,
      maxDistance: 0,
      maxEdits: 0,
    });
    assert.equal(miss, null);

    const hit = scanFuzzySignature(driver, handle, 'DE AD BE EF', {
      moduleName: 'Demo.exe',
      hintAddress: moduleBase + 190n,
      maxShiftBytes: 32,
      maxDistance: 0,
      maxEdits: 0,
    });
    assert.ok(hit);
    assert.equal(hit!.address, moduleBase + 200n);
    assert.equal(hit!.shiftBytes, 10);
  });

  test('hint window includes a match exactly at maxShiftBytes', () => {
    const driver = new FakeMemoryDriver();
    const moduleBase = 0x410000n;
    driver.addModule('Demo.exe', moduleBase, 0x1000);
    const region = Buffer.alloc(64, 0);
    region.set([0xde, 0xad, 0xbe, 0xef], 24);
    driver.addRegion(moduleBase, region);
    const handle = driver.openProcess(1);

    const hit = scanFuzzySignature(driver, handle, 'DE AD BE EF', {
      moduleName: 'Demo.exe',
      hintAddress: moduleBase + 8n,
      maxShiftBytes: 16,
      maxDistance: 0,
      maxEdits: 0,
    });
    assert.ok(hit);
    assert.equal(hit!.address, moduleBase + 24n);
    assert.equal(hit!.shiftBytes, 16);
  });

  test('module-scoped resolution fails closed when module is absent', async () => {
    const driver = new FakeMemoryDriver();
    const regionBase = 0x420000n;
    const region = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    driver.addRegion(regionBase, region);
    const handle = driver.openProcess(1);

    assert.equal(
      await resolveSignature(driver, handle, 'DE AD BE EF', { moduleName: 'Missing.exe' }),
      null,
    );
  });

  test('module-scoped resolution does not match bytes outside module bounds', async () => {
    const driver = new FakeMemoryDriver();
    const moduleBase = 0x430004n;
    driver.addModule('Demo.exe', moduleBase, 4);
    driver.addRegion(
      moduleBase - 4n,
      Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x00, 0x00, 0x00]),
    );
    const handle = driver.openProcess(1);

    assert.equal(
      await resolveSignature(driver, handle, 'DE AD BE EF', { moduleName: 'Demo.exe' }),
      null,
    );
  });

  test('resolveSignature returns exact when available', async () => {
    const driver = new FakeMemoryDriver();
    const moduleBase = 0x500000n;
    driver.addModule('Demo.exe', moduleBase, 0x1000);
    const region = Buffer.alloc(32, 0);
    region.writeUInt8(0xde, 4);
    region.writeUInt8(0xad, 5);
    region.writeUInt8(0xbe, 6);
    region.writeUInt8(0xef, 7);
    driver.addRegion(moduleBase, region);
    const handle = driver.openProcess(1);
    const match = await resolveSignature(driver, handle, 'DE AD BE EF', { moduleName: 'Demo.exe' });
    assert.ok(match);
    assert.equal(match!.mode, 'exact');
    assert.equal(match!.distance, 0);
  });

  test('resolveSignature routes the exact sub-path through a bound resolver when supplied', async () => {
    // Stage 7.4 §7 — with a resolver bound, the exact sub-path never calls
    // `scanExactSignature`/`driver.readBuffer` at all; the resolver's
    // result is used directly. A driver with no matching bytes anywhere
    // proves this: `scanExactSignature` would find nothing, but the bound
    // resolver "finds" an address anyway, and that's what comes back.
    const driver = new FakeMemoryDriver();
    driver.addModule('Demo.exe', 0x600000n, 0x1000);
    const handle = driver.openProcess(1);
    let calledWith: { signature: string; moduleName: string | undefined } | undefined;
    const resolver = async (signature: string, moduleName: string | undefined) => {
      calledWith = { signature, moduleName };
      return { address: 0x600040n, isAuthoritativeAbsence: false };
    };

    const match = await resolveSignature(
      driver,
      handle,
      'DE AD BE EF',
      { moduleName: 'Demo.exe' },
      resolver,
    );
    assert.ok(match);
    assert.equal(match!.mode, 'exact');
    assert.equal(match!.address, 0x600040n);
    assert.deepEqual(calledWith, { signature: 'DE AD BE EF', moduleName: 'Demo.exe' });
  });

  test('resolveSignature falls back to fuzzy when the bound resolver reports no exact match', async () => {
    const driver = new FakeMemoryDriver();
    const moduleBase = 0x610000n;
    driver.addModule('Demo.exe', moduleBase, 0x1000);
    const region = Buffer.alloc(32, 0);
    // Drifted by one byte (8B -> 8C) so only fuzzy matching finds it.
    region.set([0x48, 0x8c, 0x05, 0xaa, 0xbb, 0xcc, 0xdd], 4);
    driver.addRegion(moduleBase, region);
    const handle = driver.openProcess(1);
    const resolver = async () => ({ address: null, isAuthoritativeAbsence: true });

    const match = await resolveSignature(
      driver,
      handle,
      '48 8B 05 ? ? ? ?',
      { moduleName: 'Demo.exe', maxDistance: 1, maxEdits: 0 },
      resolver,
    );
    assert.ok(match);
    assert.equal(match!.mode, 'fuzzy');
    assert.equal(match!.address, moduleBase + 4n);
  });
});
