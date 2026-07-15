import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { discoveryResultToDefinition } from '../src/core/definitions/discovery-export.js';
import {
  solithDefinitionToTrainerControls,
  saveFieldToTrainerControl,
  CATALOG_SAVE_FILE_PLACEHOLDER,
  resolveCatalogControlFilePath,
} from '../src/core/definitions/definition-to-trainer-controls.js';
import { catalogDefinitionCapabilities } from '../src/core/definitions/load-catalog-definition.js';
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

describe('definition-to-trainer-controls', () => {
  test('maps saveEditor fields to save_field TrainerControls', () => {
    const definition = discoveryResultToDefinition({
      gameId: 'stardew',
      gameName: 'Stardew Valley',
      executables: ['Stardew Valley.exe'],
      saveFilePath: 'C:/Users/me/AppData/Roaming/StardewValley/Saves/Slot_1/SaveGameInfo',
      candidate: SAMPLE_CANDIDATE,
    });

    const controls = solithDefinitionToTrainerControls(definition);
    assert.equal(controls.length, 1);
    assert.equal(controls[0]?.backend, 'save_field');
    assert.equal(controls[0]?.safetyStatus, 'requires_approval');
    assert.equal(controls[0]?.saveField?.fieldPath, 'SaveGame.player.0.money');
    assert.equal(controls[0]?.saveField?.filePath, CATALOG_SAVE_FILE_PLACEHOLDER);
    assert.equal(controls[0]?.saveField?.gameId, 'custom_stardew');
  });

  test('skips hex-only save fields without searchKey', () => {
    const definition = discoveryResultToDefinition({
      gameId: 'demo',
      gameName: 'Demo',
      saveFilePath: 'C:/save.bin',
      candidate: SAMPLE_CANDIDATE,
    });
    definition.saveEditor!.saveFields.push({
      id: 'binary-patch',
      name: 'Binary patch',
      category: 'RAW',
      dataType: 'byte',
      mapping: { hexOffset: '0x10' },
    });

    const controls = solithDefinitionToTrainerControls(definition);
    assert.equal(controls.length, 1);
    assert.equal(saveFieldToTrainerControl(definition.saveEditor!.saveFields[1]!, definition), null);
  });

  test('resolveCatalogControlFilePath substitutes user-selected save path', () => {
    const definition = discoveryResultToDefinition({
      gameId: 'demo',
      gameName: 'Demo',
      saveFilePath: 'C:/save.xml',
      candidate: SAMPLE_CANDIDATE,
    });
    const control = solithDefinitionToTrainerControls(definition)[0]!;
    const resolved = resolveCatalogControlFilePath(control, 'C:/real/save.xml');
    assert.equal(resolved.saveField?.filePath, 'C:/real/save.xml');
  });

  test('catalogDefinitionCapabilities counts memory vs save features and lanes', () => {
    const definition = discoveryResultToDefinition({
      gameId: 'demo',
      gameName: 'Demo',
      saveFilePath: 'C:/save.xml',
      candidate: SAMPLE_CANDIDATE,
    });
    definition.memoryFeatures = [
      {
        id: 'hp',
        name: 'HP',
        category: 'Player',
        type: 'freeze',
        dataType: 'float',
        defaultValue: 999,
        resolution: { moduleName: 'game.exe', baseOffset: '0x100' },
      },
    ];

    const caps = catalogDefinitionCapabilities(definition);
    assert.equal(caps.saveControlCount, 1);
    assert.equal(caps.memoryCheatCount, 1);
    assert.equal(caps.saveEdit, 'executable');
    assert.equal(caps.liveMemory, 'executable');
    assert.equal(caps.injection, 'forbidden');
    assert.ok(caps.saveDirectoryHint?.includes('C:'));
  });
});
