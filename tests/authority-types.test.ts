import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITIES, isKnownCapability } from '../src/core/authority/capabilities.js';

describe('authority capabilities', () => {
  test('closed union has no duplicate members', () => {
    assert.equal(new Set(CAPABILITIES).size, CAPABILITIES.length);
  });

  test('isKnownCapability recognizes every declared capability', () => {
    for (const capability of CAPABILITIES) {
      assert.equal(isKnownCapability(capability), true, capability);
    }
  });

  test('isKnownCapability rejects unknown strings and non-strings', () => {
    assert.equal(isKnownCapability('capability.does.not.exist'), false);
    assert.equal(isKnownCapability(''), false);
    assert.equal(isKnownCapability(undefined), false);
    assert.equal(isKnownCapability(null), false);
    assert.equal(isKnownCapability(42), false);
    assert.equal(isKnownCapability({}), false);
  });

  test('includes required core capabilities from MASTER_ROADMAP.md', () => {
    const required = [
      'filesystem.read', 'filesystem.write',
      'process.observe', 'process.attach', 'process.launch', 'process.kill',
      'memory.read', 'memory.write',
      'input.keyboard', 'input.mouse',
      'window.observe', 'window.modify',
      'network.request', 'credential.use', 'software.install', 'system.settings',
      'registry.read', 'registry.write', 'destructive.delete',
    ];
    for (const capability of required) {
      assert.equal(isKnownCapability(capability), true, capability);
    }
  });

  test('includes SOLITH-specific capabilities', () => {
    const specific = [
      'trainer.patch.register', 'trainer.patch.enable', 'trainer.patch.disable',
      'savefile.modify', 'overlay.activate', 'hotkey.register', 'catalog.update', 'artwork.cache.write',
    ];
    for (const capability of specific) {
      assert.equal(isKnownCapability(capability), true, capability);
    }
  });

  test('browser.* remains defined for vocabulary stability but is not a live capability', () => {
    assert.equal(isKnownCapability('browser.navigate'), true);
    assert.equal(isKnownCapability('browser.submit'), true);
  });
});
