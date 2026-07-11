import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { exportDiscoveryCandidateToYaml } from '../src/core/definitions/export-definition.js';
import {
  compileYamlToPayload,
  compileYamlToDefinition,
  compileDefinitionToPayload,
} from '../src/core/definitions/compile-yaml.v1.js';
import { solithDefinitionToModPack, isSolithDefinitionPayload } from '../src/core/definitions/mod-pack-adapter.js';
import { parseSolithDefinitionV1 } from '../src/core/definitions/schema.v1.js';
import type { DiscoveryResult } from '../src/shared/types/index.js';

const SAMPLE_CANDIDATE: DiscoveryResult = {
  path: 'SaveGame.player.0.money',
  oldValue: 500,
  newValue: 9999,
  confidence: 92,
  description: 'Gold changed after purchase',
  suggestedCategory: 'CURRENCY',
  suggestedName: 'Money',
  valueType: 'number',
  risk: 'safe',
};

describe('compile-yaml.v1', () => {
  test('round-trips exported discovery YAML through compiler', () => {
    const bundle = exportDiscoveryCandidateToYaml({
      gameId: 'stardew',
      gameName: 'Stardew Valley',
      executables: ['Stardew Valley.exe'],
      saveFilePath: 'C:/Users/me/AppData/Roaming/StardewValley/Saves/Slot_1/SaveGameInfo',
      candidate: SAMPLE_CANDIDATE,
    });

    const compiled = compileYamlToDefinition(bundle.yaml);
    assert.equal(compiled.success, true);
    if (!compiled.success) return;

    assert.equal(compiled.definition.id, 'custom_stardew');
    assert.equal(compiled.definition.saveEditor?.saveFields[0]?.mapping.searchKey, 'SaveGame.player.0.money');
    assert.equal(compiled.payloadJson, compileDefinitionToPayload(compiled.definition));
    assert.ok(!compiled.payloadJson.includes('\n'));
    parseSolithDefinitionV1(JSON.parse(compiled.payloadJson));
  });

  test('compileYamlToPayload rejects invalid YAML', () => {
    const result = compileYamlToPayload('not: [valid');
    assert.equal(result.success, false);
    if (result.success) return;
    assert.ok(result.errors.length > 0);
  });

  test('compileYamlToPayload rejects inject type', () => {
    const yaml = `
schemaVersion: 1
id: bad
title: Bad
gameVersion: '*'
executableHashPrefixes: []
author: test
safety:
  requiresApproval: true
  requiresOfflineConfirm: true
  verificationStatus: community
target:
  executables: [game.exe]
  arch: x64
memoryFeatures:
  - id: x
    name: X
    category: X
    type: inject
    dataType: int32
    defaultValue: 1
    resolution:
      moduleName: game.exe
`;
    const result = compileYamlToPayload(yaml);
    assert.equal(result.success, false);
  });

  test('solithDefinitionToModPack adapts memory and save fields', () => {
    const bundle = exportDiscoveryCandidateToYaml({
      gameId: 'demo',
      gameName: 'Demo',
      saveFilePath: 'C:/save.xml',
      candidate: SAMPLE_CANDIDATE,
    });
    const compiled = compileYamlToDefinition(bundle.yaml);
    assert.equal(compiled.success, true);
    if (!compiled.success) return;

    const raw = JSON.parse(compiled.payloadJson);
    assert.equal(isSolithDefinitionPayload(raw), true);
    const pack = solithDefinitionToModPack(compiled.definition);
    assert.equal(pack.catalogGameId, 'custom_demo');
    assert.equal(pack.cheats.length, 1);
    assert.equal(pack.cheats[0]?.tags?.[0], 'schema-v1');
  });
});
