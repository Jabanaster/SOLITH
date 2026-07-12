import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBinarySaveProfile, listBinarySaveProfiles } from '../src/core/saves/binary-formats/index.ts';

describe('binary save format registry', () => {
  test('lists rfsa and legacy profiles', () => {
    const profiles = listBinarySaveProfiles();
    assert.ok(profiles.some((p) => p.id === 'rfsa-v1'));
    assert.ok(profiles.some((p) => p.id === 'demo-binary-fixture'));
  });

  test('detects rfsa profile by extension and magic', () => {
    const header = new Uint8Array([0x52, 0x46, 0x53, 0x41, 1, 0, 0, 0]);
    const profile = detectBinarySaveProfile('save/player.rfsa', header);
    assert.equal(profile?.id, 'rfsa-v1');
  });

  test('detects legacy demo fixture on .sav', () => {
    const header = new Uint8Array([0x52, 0x46, 0x53, 0x41, 0, 0, 0, 0]);
    const profile = detectBinarySaveProfile('save/demo.sav', header);
    assert.ok(profile);
    assert.equal(profile?.id, 'demo-binary-fixture');
  });
});
