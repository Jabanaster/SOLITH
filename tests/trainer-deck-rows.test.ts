import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrainerDeckRows } from '../src/core/trainer-deck/build-deck-rows.ts';
import type { SolithDefinitionV1 } from '../src/core/definitions/schema.v1.ts';

const SAMPLE: SolithDefinitionV1 = {
  schemaVersion: 1,
  id: 'demo-game',
  title: 'Demo Game',
  gameVersion: '1.0',
  executableHashPrefixes: ['abc'],
  author: 'test',
  safety: {
    requiresApproval: true,
    requiresOfflineConfirm: true,
    verificationStatus: 'community',
  },
  target: { executables: ['Demo.exe'], arch: 'x64' },
  memoryFeatures: [
    {
      id: 'hp',
      name: 'Health',
      category: 'Player',
      type: 'freeze',
      dataType: 'int32',
      defaultValue: 999,
      certificationLevel: 'L1',
      resolution: { moduleName: 'Demo.exe', baseOffset: '0x10', pointerChain: [0x20] },
    },
  ],
  saveEditor: {
    defaultDirectory: '%USERPROFILE%/Saves',
    extension: '.sav',
    format: 'json',
    saveFields: [
      {
        id: 'gold',
        name: 'Gold',
        category: 'Currency',
        dataType: 'int32',
        mapping: { searchKey: 'player.gold' },
      },
    ],
  },
};

describe('trainer-deck rows', () => {
  test('builds memory and save rows', () => {
    const rows = buildTrainerDeckRows(SAMPLE);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].kind, 'memory');
    assert.equal(rows[0].certificationLevel, 'L1');
    assert.equal(rows[0].requiresSession, true);
    assert.equal(rows[1].kind, 'save');
    assert.equal(rows[1].requiresSession, false);
  });
});
