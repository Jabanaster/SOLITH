/**
 * Phase 1 — schema.v1 capability lane derivation (advisory; no execute IPC).
 */
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import { ensureBundledDefinitions } from '../src/core/trainer-catalog/ensure-bundled-definitions.ts';
import {
  catalogDefinitionCapabilities,
  getCatalogDefinitionCapabilities,
  loadCatalogDefinition,
} from '../src/core/definitions/load-catalog-definition.ts';
import type { SolithDefinitionV1 } from '../src/core/definitions/schema.v1.ts';

describe('schema.v1 capability lanes (Phase 1)', () => {
  before(async () => {
    await resetForTesting();
    ensureBundledDefinitions();
  });

  test('Stardew: saveEdit executable, liveMemory none, injection forbidden', () => {
    const def = loadCatalogDefinition('stardew-valley');
    assert.ok(def);
    const caps = catalogDefinitionCapabilities(def!);
    assert.equal(caps.saveEdit, 'executable');
    assert.equal(caps.saveControlCount, 4);
    assert.equal(caps.liveMemory, 'none');
    assert.equal(caps.injection, 'forbidden');
  });

  test('Palworld: liveMemory scan-required (L0 Discovery), save none', () => {
    const caps = getCatalogDefinitionCapabilities('palworld');
    assert.ok(caps);
    assert.equal(caps!.liveMemory, 'scan-required');
    assert.equal(caps!.saveEdit, 'none');
    assert.ok(caps!.memoryCheatCount > 0);
    assert.equal(caps!.injection, 'forbidden');
  });

  test('Crimson Desert: injection pilot-gated (never auto-on), live scan-required', () => {
    const caps = getCatalogDefinitionCapabilities('crimson-desert');
    assert.ok(caps);
    assert.equal(caps!.injection, 'pilot-gated');
    assert.equal(caps!.liveMemory, 'scan-required');
  });

  test('metadata-only catalog id without definition → null capabilities', () => {
    assert.equal(getCatalogDefinitionCapabilities('definitely-no-such-game-xyz'), null);
  });

  test('resolved pointer feature becomes liveMemory executable', () => {
    const definition: SolithDefinitionV1 = {
      schemaVersion: 1,
      id: 'atomfall-demo',
      title: 'Atomfall Demo',
      gameVersion: '*',
      executableHashPrefixes: [],
      author: 'test',
      safety: {
        requiresApproval: true,
        requiresOfflineConfirm: true,
        verificationStatus: 'verified',
      },
      target: { executables: ['Atomfall.exe'], arch: 'x64' },
      memoryFeatures: [
        {
          id: 'ammo',
          name: 'Ammo',
          category: 'Weapons',
          type: 'freeze',
          dataType: 'int32',
          defaultValue: 99,
          resolution: { moduleName: 'Atomfall.exe', baseOffset: '0x1234' },
        },
      ],
    };
    const caps = catalogDefinitionCapabilities(definition);
    assert.equal(caps.liveMemory, 'executable');
    assert.equal(caps.saveEdit, 'none');
    assert.equal(caps.injection, 'forbidden');
  });
});
