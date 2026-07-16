/**
 * Phase 3 — dual-read "silence" test: migrated titles must prefer schema.v1
 * and must NOT log `[Schema.v1] Fallback triggered` warnings.
 */
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import { ensureBundledDefinitions } from '../src/core/trainer-catalog/bundled-definition-seed.ts';
import { catalogDefinitionCapabilities } from '../src/core/definitions/load-catalog-definition.ts';
import { resolveSaveEditControlsDualRead } from '../src/core/definitions/dual-read-save-controls.ts';
import { listLiveControlsDualRead } from '../src/core/live-memory/dual-read-controls.ts';
import { loadCatalogDefinition } from '../src/core/definitions/load-catalog-definition.ts';

describe('Phase 3 dual-read silence (migrated titles)', () => {
  before(async () => {
    await resetForTesting();
    ensureBundledDefinitions();
  });

  test('Stardew saveEdit prefers schema.v1 with Milestone J paths and no fallback warn', () => {
    const warnings: string[] = [];
    const result = resolveSaveEditControlsDualRead(
      { catalogGameId: 'stardew-valley' },
      { warn: (m) => warnings.push(m) },
    );

    assert.equal(result.source, 'schema.v1');
    assert.equal(result.controls.length, 4);
    assert.deepEqual(
      result.controls.map((c) => c.saveField?.fieldPath).sort(),
      [
        'SaveGame.player.0.experiencePoints.0.int.0',
        'SaveGame.player.0.maxStamina.0.float.0',
        'SaveGame.player.0.money',
        'SaveGame.player.0.stamina.0.float.0',
      ],
    );
    for (const c of result.controls) {
      assert.equal(c.safetyStatus, 'requires_approval');
    }
    assert.equal(
      warnings.filter((w) => w.includes('Fallback triggered')).length,
      0,
      `unexpected fallback warnings: ${warnings.join(' | ')}`,
    );
  });

  test('Atomfall liveMemory prefers schema.v1 executable ammo feature and no fallback warn', () => {
    const warnings: string[] = [];
    const def = loadCatalogDefinition('atomfall');
    assert.ok(def);
    const caps = catalogDefinitionCapabilities(def!);
    assert.equal(caps.liveMemory, 'executable');

    const listed = listLiveControlsDualRead(
      { executableName: 'Atomfall_dx12.exe', catalogGameId: 'atomfall' },
      { warn: (m) => warnings.push(m) },
    );

    assert.equal(listed.source, 'schema.v1');
    assert.ok(
      listed.controls.some((c) => c.id === 'atomfall:atomfall-current-weapon-ammo'),
      `expected verified ammo control in ${listed.controls.map((c) => c.id).join(', ')}`,
    );
    assert.equal(
      warnings.filter((w) => w.includes('Fallback triggered')).length,
      0,
      `unexpected fallback warnings: ${warnings.join(' | ')}`,
    );
  });

  test('Palworld scan-required still prefers definition without fallback warn', () => {
    const warnings: string[] = [];
    const listed = listLiveControlsDualRead(
      { catalogGameId: 'palworld' },
      { warn: (m) => warnings.push(m) },
    );
    assert.equal(listed.source, 'schema.v1');
    assert.ok(listed.controls.length > 0);
    assert.equal(
      warnings.filter((w) => w.includes('Fallback triggered')).length,
      0,
      `unexpected fallback warnings: ${warnings.join(' | ')}`,
    );
  });
});
