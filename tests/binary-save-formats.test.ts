import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBinarySaveProfile, listBinarySaveProfiles } from '../src/core/saves/binary-formats/index.ts';

describe('binary save format registry', () => {
  test('lists scaffold profiles', () => {
    const profiles = listBinarySaveProfiles();
    assert.ok(profiles.length >= 1);
    assert.ok(profiles.some((p) => p.id === 'demo-binary-fixture'));
  });

  test('detects demo fixture by magic bytes', () => {
    const header = new Uint8Array([0x52, 0x46, 0x53, 0x41, 0, 0, 0, 0]);
    const profile = detectBinarySaveProfile('save/demo.sav', header);
    assert.ok(profile);
    assert.equal(profile?.id, 'demo-binary-fixture');
  });
});
