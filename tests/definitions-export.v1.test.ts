import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  discoveryResultToDefinition,
  discoveryResultToSaveField,
  inferSaveDirectoryHint,
} from '../src/core/definitions/discovery-export.js';
import { memoryContextToDefinition } from '../src/core/definitions/memory-export.js';
import {
  exportDiscoveryCandidateToYaml,
  exportMemoryFeatureToYaml,
} from '../src/core/definitions/export-definition.js';
import { serializeDefinitionToYaml } from '../src/core/definitions/export-yaml.v1.js';
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
  evidence: 'Stable scalar at known save path',
};

describe('discovery export', () => {
  test('maps discovery candidate to save field', () => {
    const field = discoveryResultToSaveField(SAMPLE_CANDIDATE);
    assert.equal(field.id, 'money');
    assert.equal(field.mapping.searchKey, 'SaveGame.player.0.money');
    assert.equal(field.category, 'CURRENCY');
  });

  test('builds save-editor definition', () => {
    const definition = discoveryResultToDefinition({
      gameId: 'stardew',
      gameName: 'Stardew Valley',
      executables: ['Stardew Valley.exe'],
      saveFilePath: 'C:/Users/me/AppData/Roaming/StardewValley/Saves/Slot_1/SaveGameInfo',
      candidate: SAMPLE_CANDIDATE,
    });
    assert.equal(definition.schemaVersion, 1);
    assert.equal(definition.id, 'custom_stardew');
    assert.equal(definition.saveEditor?.format, 'binary');
    assert.equal(definition.saveEditor?.saveFields.length, 1);
    parseSolithDefinitionV1(definition);
  });

  test('infers APPDATA directory hint', () => {
    const hint = inferSaveDirectoryHint('C:/Users/me/AppData/Roaming/StardewValley/Saves/foo.xml');
    assert.match(hint, /%APPDATA%/);
    assert.match(hint, /StardewValley/);
  });
});

describe('memory export', () => {
  test('exports scan_first when only session address is known', () => {
    const definition = memoryContextToDefinition({
      gameName: 'Demo Game',
      executableName: 'Demo.exe',
      featureName: 'Health',
      dataType: 'int32',
      sessionAddress: '0x1a2b3c40',
    });
    assert.equal(definition.memoryFeatures?.[0]?.type, 'scan_first');
    assert.equal(definition.target.executables[0], 'Demo.exe');
  });
});

describe('yaml export', () => {
  test('discovery yaml bundle contains schema and save field path', () => {
    const bundle = exportDiscoveryCandidateToYaml({
      gameId: 'demo',
      gameName: 'Demo Game',
      saveFilePath: 'C:/games/demo/save.xml',
      candidate: SAMPLE_CANDIDATE,
    });
    assert.equal(bundle.filename, 'custom_demo.yml');
    assert.match(bundle.yaml, /schemaVersion: 1/);
    assert.match(bundle.yaml, /SaveGame\.player\.0\.money/);
    assert.match(bundle.yaml, /saveEditor:/);
    assert.match(bundle.yaml, /# Exported from Discovery Lab/);
  });

  test('memory yaml includes session address review comment', () => {
    const bundle = exportMemoryFeatureToYaml({
      gameName: 'Demo Game',
      executableName: 'Demo.exe',
      featureName: 'Ammo',
      dataType: 'int32',
      sessionAddress: '0xdeadbeef',
    });
    assert.match(bundle.yaml, /memoryFeatures:/);
    assert.match(bundle.yaml, /session-only address captured during export: 0xdeadbeef/);
    assert.match(bundle.yaml, /scan_first/);
  });

  test('serializeDefinitionToYaml validates after export', () => {
    const definition = discoveryResultToDefinition({
      gameId: 'x',
      gameName: 'X',
      saveFilePath: 'C:/save.json',
      candidate: SAMPLE_CANDIDATE,
    });
    const yaml = serializeDefinitionToYaml(definition);
    assert.match(yaml, /verificationStatus: community/);
    parseSolithDefinitionV1(definition);
  });
});
