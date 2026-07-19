import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  aobHammingDistance,
  findBestFuzzyAobInBuffer,
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

  test('resolveSignatureInBuffer prefers exact over fuzzy', () => {
    const haystack = Buffer.from([0xaa, 0x48, 0x8b, 0x05, 0x01, 0x02, 0x03, 0x04]);
    const hit = resolveSignatureInBuffer(haystack, '48 8B 05 ? ? ? ?', 2);
    assert.deepEqual(hit, { offset: 1, mode: 'exact', distance: 0 });
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
    });
    assert.ok(match);
    assert.equal(match!.mode, 'fuzzy');
    assert.equal(match!.distance, 1);
    assert.equal(match!.address, moduleBase + 8n);
  });

  test('resolveSignature returns exact when available', () => {
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
    const match = resolveSignature(driver, handle, 'DE AD BE EF', { moduleName: 'Demo.exe' });
    assert.ok(match);
    assert.equal(match!.mode, 'exact');
    assert.equal(match!.distance, 0);
  });
});
