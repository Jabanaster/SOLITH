import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseAobSignature, findAobInBuffer, scanAobInProcess } from '../../src/core/live-memory/aob-resolver.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';

describe('aob-resolver', () => {
  test('parseAobSignature handles wildcards', () => {
    const pattern = parseAobSignature('48 8B 05 ? ? ? ?');
    assert.deepEqual(pattern.bytes, [0x48, 0x8b, 0x05, null, null, null, null]);
  });

  test('findAobInBuffer finds first match', () => {
    const haystack = Buffer.from([0x00, 0x48, 0x8b, 0x05, 0x11, 0x22, 0x33, 0x44, 0x00]);
    const pattern = parseAobSignature('48 8B 05 ? ? ? ?');
    assert.equal(findAobInBuffer(haystack, pattern), 1);
  });

  test('scanAobInProcess searches module-overlapping regions', () => {
    const driver = new FakeMemoryDriver();
    const moduleBase = 0x400000n;
    driver.addModule('Demo.exe', moduleBase, 0x1000);
    const region = Buffer.alloc(64, 0);
    region.writeUInt8(0x48, 8);
    region.writeUInt8(0x8b, 9);
    region.writeUInt8(0x05, 10);
    region.writeUInt8(0xaa, 11);
    region.writeUInt8(0xbb, 12);
    region.writeUInt8(0xcc, 13);
    region.writeUInt8(0xdd, 14);
    driver.addRegion(moduleBase, region);

    const handle = driver.openProcess(1);
    const match = scanAobInProcess(driver, handle, '48 8B 05 ? ? ? ?', { moduleName: 'Demo.exe' });
    assert.equal(match, moduleBase + 8n);
  });

  test('scanAobInProcess returns null on miss', () => {
    const driver = new FakeMemoryDriver();
    driver.addModule('Demo.exe', 0x1000n, 0x100);
    driver.addRegion(0x1000n, Buffer.alloc(32, 0));
    const handle = driver.openProcess(1);
    const match = scanAobInProcess(driver, handle, 'DE AD BE EF', { moduleName: 'Demo.exe' });
    assert.equal(match, null);
  });
});
