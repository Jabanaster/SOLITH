import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundledDefinitionsForTests } from '../src/core/trainer-catalog/bundled-definition-seed.js';
import { parseSolithDefinitionV1 } from '../src/core/definitions/schema.v1.js';

test('bundled definitions cover all seven curated games', () => {
  const ids = bundledDefinitionsForTests().map((d) => d.id).sort();
  assert.deepEqual(ids, [
    'atomfall',
    'avowed',
    'crimson-desert',
    'dredge',
    'palworld',
    'stardew-valley',
    'undisputed',
  ]);
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
