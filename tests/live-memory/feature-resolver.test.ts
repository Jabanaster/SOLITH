import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMemoryFeatureAddress, SessionAddressCache } from '../../src/core/live-memory/feature-resolver.js';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import type { MemoryFeatureV1 } from '../../src/core/definitions/schema.v1.js';

function makeFreezeFeature(overrides: Partial<MemoryFeatureV1> = {}): MemoryFeatureV1 {
  return {
    id: 'health',
    name: 'Health',
    category: 'Player',
    type: 'freeze',
    dataType: 'int32',
    defaultValue: 999,
    resolution: {
      moduleName: 'Demo.exe',
      baseOffset: '0x10',
      pointerChain: [],
    },
    ...overrides,
  };
}

describe('feature-resolver', () => {
  test('resolves static pointer path', () => {
    const driver = new FakeMemoryDriver({ '4194320': 100 });
    driver.addModule('Demo.exe', 0x400000n, 0x2000);
    const handle = driver.openProcess(1);
    const cache = new SessionAddressCache();

    const address = resolveMemoryFeatureAddress(driver, handle, makeFreezeFeature(), cache);
    assert.equal(address.address, 0x400010n);
    assert.equal(address.dataType, 'int32');
    assert.equal(cache.size, 1);
  });

  test('resolves AOB then caches for second call', () => {
    const driver = new FakeMemoryDriver();
    const moduleBase = 0x400000n;
    driver.addModule('Demo.exe', moduleBase, 0x2000);
    const region = Buffer.alloc(128, 0);
    region.writeUInt8(0x48, 32);
    region.writeUInt8(0x8b, 33);
    region.writeUInt8(0x05, 34);
    region.writeUInt8(0x01, 35);
    region.writeUInt8(0x02, 36);
    region.writeUInt8(0x03, 37);
    region.writeUInt8(0x04, 38);
    driver.addRegion(moduleBase, region);
    driver.setValue(moduleBase + 0x42n, 777);

    const handle = driver.openProcess(1);
    const cache = new SessionAddressCache();
    const feature = makeFreezeFeature({
      resolution: {
        moduleName: 'Demo.exe',
        signature: '48 8B 05 ? ? ? ?',
        baseOffset: '0x10',
      },
    });

    const first = resolveMemoryFeatureAddress(driver, handle, feature, cache);
    const second = resolveMemoryFeatureAddress(driver, handle, feature, cache);
    assert.equal(first.address, moduleBase + 32n + 0x10n);
    assert.equal(second.address, first.address);
  });

  test('falls back to pointer path when AOB misses', () => {
    const driver = new FakeMemoryDriver({ '4194320': 50 });
    driver.addModule('Demo.exe', 0x400000n, 0x2000);
    const handle = driver.openProcess(1);
    const cache = new SessionAddressCache();

    const feature = makeFreezeFeature({
      resolution: {
        moduleName: 'Demo.exe',
        signature: 'DE AD BE EF',
        baseOffset: '0x10',
      },
    });

    const address = resolveMemoryFeatureAddress(driver, handle, feature, cache);
    assert.equal(address.address, 0x400010n);
  });

  test('scan_unknown features cannot be resolved upfront', () => {
    const driver = new FakeMemoryDriver();
    const handle = driver.openProcess(1);
    const cache = new SessionAddressCache();
    const feature = makeFreezeFeature({ type: 'scan_unknown' });

    assert.throws(
      () => resolveMemoryFeatureAddress(driver, handle, feature, cache),
      /requires discovery scanning/,
    );
  });
});
