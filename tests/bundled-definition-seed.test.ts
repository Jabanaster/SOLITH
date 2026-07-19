import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { bundledDefinitionsForTests } from '../src/core/trainer-catalog/bundled-definition-seed.js';
import { BUNDLED_COMMUNITY_GAME_COUNT } from '../src/core/trainer-catalog/bundled-community-games.js';
import { parseSolithDefinitionV1 } from '../src/core/definitions/schema.v1.js';

const CURATED_IDS = [
  'atomfall',
  'avowed',
  'crimson-desert',
  'dredge',
  'palworld',
  'stardew-valley',
  'undisputed',
];

test('bundled definitions include 50 mod-pack games (7 curated + 43 community)', () => {
  const defs = bundledDefinitionsForTests();
  assert.equal(defs.length, 7 + BUNDLED_COMMUNITY_GAME_COUNT);
  for (const id of CURATED_IDS) {
    assert.ok(defs.some((d) => d.id === id), `missing curated game ${id}`);
  }
});

test('every bundled definition validates against schema.v1', () => {
  for (const definition of bundledDefinitionsForTests()) {
    parseSolithDefinitionV1(definition);
  }
});

test('stardew ships save-field controls only', () => {
  const stardew = bundledDefinitionsForTests().find((d) => d.id === 'stardew-valley');
  assert.ok(stardew?.saveEditor);
  assert.equal(stardew?.saveEditor?.saveFields.length, 4);
  assert.equal(stardew?.memoryFeatures?.length ?? 0, 0);
});

test('memory games ship pinned scan_unknown features', () => {
  const palworld = bundledDefinitionsForTests().find((d) => d.id === 'palworld');
  assert.equal(palworld?.memoryFeatures?.length, 3);
  assert.equal(palworld?.memoryFeatures?.[0]?.type, 'scan_unknown');
  assert.equal(palworld?.connectionBaseline, 4);
});

test('Phase 3: Atomfall seed mirrors verified live-control pointer as executable feature', () => {
  const atomfall = bundledDefinitionsForTests().find((d) => d.id === 'atomfall');
  assert.ok(atomfall);
  const ammo = atomfall?.memoryFeatures?.find((f) => f.id === 'atomfall-current-weapon-ammo');
  assert.ok(ammo, 'verified ammo feature must be present');
  assert.equal(ammo?.type, 'write_once');
  assert.equal(ammo?.resolution.moduleName, 'atomfall_dx12.exe');
  assert.equal(ammo?.resolution.baseOffset, '0x1959a28');
  assert.deepEqual(ammo?.resolution.pointerChain, [24]);
  // scan_unknown pins remain for Discovery L0 surface
  assert.ok((atomfall?.memoryFeatures?.length ?? 0) >= 4);
});

test('community bundled games are community tier with scan_unknown features', () => {
  const elden = bundledDefinitionsForTests().find((d) => d.id === 'elden-ring');
  assert.ok(elden);
  assert.equal(elden?.safety.verificationStatus, 'community');
  assert.equal(elden?.memoryFeatures?.length, 3);
  assert.equal(elden?.memoryFeatures?.[0]?.type, 'scan_unknown');
});

test('Avowed L0 scaffold: WinGDK exe + scan_unknown features with empty resolution paths', () => {
  const avowed = bundledDefinitionsForTests().find((d) => d.id === 'avowed');
  assert.ok(avowed);
  assert.deepEqual(avowed?.target.executables, ['Avowed.exe', 'Avowed-WinGDK-Shipping.exe']);
  assert.equal(avowed?.safety.requiresApproval, true);
  assert.equal(avowed?.safety.requiresOfflineConfirm, true);
  assert.equal(avowed?.safety.verificationStatus, 'unverified');
  assert.equal(avowed?.certificationLevel, 'L0');
  assert.equal(avowed?.memoryFeatures?.length, 3);

  const ids = (avowed?.memoryFeatures ?? []).map((f) => f.id).sort();
  assert.deepEqual(ids, ['infinite-essence', 'infinite-health', 'infinite-stamina']);

  for (const feature of avowed?.memoryFeatures ?? []) {
    assert.equal(feature.type, 'scan_unknown');
    assert.equal(feature.certificationLevel, 'L0');
    assert.equal(feature.resolution.signature, undefined);
    assert.equal(feature.resolution.baseOffset, undefined);
    assert.equal(feature.resolution.pointerChain, undefined);
    assert.ok(feature.resolution.moduleName.length > 0);
  }
});
