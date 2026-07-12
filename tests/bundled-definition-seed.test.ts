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

test('community bundled games are community tier with scan_unknown features', () => {
  const elden = bundledDefinitionsForTests().find((d) => d.id === 'elden-ring');
  assert.ok(elden);
  assert.equal(elden?.safety.verificationStatus, 'community');
  assert.equal(elden?.memoryFeatures?.length, 3);
  assert.equal(elden?.memoryFeatures?.[0]?.type, 'scan_unknown');
});
