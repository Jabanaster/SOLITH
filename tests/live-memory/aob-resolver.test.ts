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
    const outcome = scanAobInProcess(driver, handle, '48 8B 05 ? ? ? ?', { moduleName: 'Demo.exe' });
    assert.equal(outcome.address, moduleBase + 8n);
    assert.equal(outcome.completeness.state, 'complete');
    assert.deepEqual(outcome.skippedRegions, []);
  });

  test('scanAobInProcess reports a miss over fully-read regions as an authoritative absence', () => {
    const driver = new FakeMemoryDriver();
    driver.addModule('Demo.exe', 0x1000n, 0x100);
    driver.addRegion(0x1000n, Buffer.alloc(32, 0));
    const handle = driver.openProcess(1);
    const outcome = scanAobInProcess(driver, handle, 'DE AD BE EF', { moduleName: 'Demo.exe' });
    assert.equal(outcome.address, null);
    assert.equal(outcome.completeness.state, 'complete');
    assert.equal(outcome.isAuthoritativeAbsence, true);
    assert.equal(outcome.regionsRead, 1);
  });

  // D01/D03 closure: the case that used to be indistinguishable from the one
  // above. A signature that is not found because a region could not be read is
  // never an authoritative absence.
  test('scanAobInProcess never claims absence when an eligible region could not be read', () => {
    const driver = new FakeMemoryDriver();
    driver.addModule('Demo.exe', 0x1000n, 0x200);
    driver.addRegion(0x1000n, Buffer.alloc(32, 0));
    driver.addRegion(0x1100n, Buffer.alloc(32, 0));
    const handle = driver.openProcess(1);

    const realRead = driver.readBuffer.bind(driver);
    driver.readBuffer = ((h: unknown, base: bigint, size: number) => {
      if (base === 0x1100n) throw new Error('read failed: region too large');
      return realRead(h as never, base, size);
    }) as typeof driver.readBuffer;

    const outcome = scanAobInProcess(driver, handle, 'DE AD BE EF', { moduleName: 'Demo.exe' });
    assert.equal(outcome.address, null);
    assert.equal(outcome.isAuthoritativeAbsence, false);
    assert.equal(outcome.completeness.state, 'complete_with_skipped_regions');
    assert.equal(outcome.skippedRegions.length, 1);
    assert.equal(outcome.skippedRegions[0].baseAddress, 0x1100n);
    assert.match(outcome.skippedRegions[0].reason, /region_read_failed/);
  });
});
