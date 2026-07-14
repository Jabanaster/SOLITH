import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase, resetForTesting } from '../src/core/database/index.ts';
import { upsertCatalogEntry } from '../src/core/trainer-catalog/store.ts';
import { upsertDefinitionPayload } from '../src/core/trainer-catalog/store.ts';
import { upsertInstalledGames } from '../src/core/install-discovery/store.ts';
import { computeTrainerHealth, runOfflineCertify } from '../src/core/trainer-health/index.ts';
import type { SolithDefinitionV1 } from '../src/core/definitions/schema.v1.ts';

const DEFINITION: SolithDefinitionV1 = {
  schemaVersion: 1,
  id: 'health-test-game',
  title: 'Health Test',
  gameVersion: '1.0',
  executableHashPrefixes: ['deadbeef'],
  author: 'test',
  safety: {
    requiresApproval: true,
    requiresOfflineConfirm: true,
    verificationStatus: 'verified',
  },
  target: { executables: ['HealthTest.exe'], arch: 'x64' },
  memoryFeatures: [
    {
      id: 'hp',
      name: 'HP',
      category: 'Player',
      type: 'freeze',
      dataType: 'int32',
      defaultValue: 100,
      resolution: { moduleName: 'HealthTest.exe', baseOffset: '0x1' },
    },
  ],
};

describe('trainer-health', () => {
  before(async () => {
    await resetForTesting();
    await initDatabase();
    upsertCatalogEntry({
      catalogGameId: 'health-test-game',
      displayName: 'Health Test',
      executables: ['HealthTest.exe'],
      categories: ['Action'],
      verificationStatus: 'verified',
      sources: [{ provider: 'bundled', url: 'bundled://test' }],
      hasModPack: true,
      cheatCount: 1,
      searchableText: 'health test',
    });
    upsertDefinitionPayload(
      'health-test-game-pack',
      'health-test-game',
      JSON.stringify(DEFINITION),
      'verified',
      'test',
      new Date().toISOString(),
    );
  });

  test('unknown when no installed executable', () => {
    const health = computeTrainerHealth('health-test-game');
    assert.equal(health.status, 'unknown');
  });

  test('offline certify passes valid definition', () => {
    const result = runOfflineCertify('health-test-game');
    assert.equal(result.success, true);
    assert.equal(result.schemaValid, true);
  });
});
