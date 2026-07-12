import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBinarySaveProfile, listBinarySaveProfiles } from '../src/core/saves/binary-formats/index.ts';

describe('binary save format registry', () => {
  test('lists five writable demo binary profiles', () => {
    const profiles = listBinarySaveProfiles();
    for (const id of ['rfsa-v1', 'slth-v1', 'rsav-v1', 'bpkg-v1', 'gdat-v1']) {
      assert.ok(profiles.some((p) => p.id === id && p.canWrite), `missing writable profile ${id}`);
    }
    assert.ok(profiles.some((p) => p.id === 'demo-binary-fixture'));
  });

  test('detects slth profile by magic', () => {
    const header = new Uint8Array([0x53, 0x4c, 0x54, 0x48, 1, 0, 0, 0]);
    const profile = detectBinarySaveProfile('save/player.slth', header);
    assert.equal(profile?.id, 'slth-v1');
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
