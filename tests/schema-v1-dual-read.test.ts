/**
 * Phase 4 — schema.v1-only routing (legacy fallback removed).
 */
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import { ensureBundledDefinitions } from '../src/core/trainer-catalog/bundled-definition-seed.ts';
import {
  resolveSaveEditControlsFromSchema,
  alignStardewPanelPlaceholders,
  STARDEW_PANEL_GAME_ID,
  STARDEW_SAVE_FILE_PLACEHOLDER,
} from '../src/core/definitions/dual-read-save-controls.ts';
import {
  listLiveControlsFromSchema,
  resolveLiveControlFromSchema,
} from '../src/core/live-memory/dual-read-controls.ts';
import { buildControls } from '../src/app/pages/trainer-control-panel-build.ts';
import type { SolithDefinitionV1 } from '../src/core/definitions/schema.v1.ts';

const MILESTONE_J_PATHS: Record<string, string> = {
  'stardew-money': 'SaveGame.player.0.money',
  'stardew-stamina': 'SaveGame.player.0.stamina.0.float.0',
  'stardew-farming-xp': 'SaveGame.player.0.experiencePoints.0.int.0',
  'stardew-max-stamina': 'SaveGame.player.0.maxStamina.0.float.0',
};

function executableDef(overrides: Partial<SolithDefinitionV1> & Pick<SolithDefinitionV1, 'id'>): SolithDefinitionV1 {
  return {
    schemaVersion: 1,
    title: overrides.title ?? overrides.id,
    gameVersion: '*',
    executableHashPrefixes: [],
    author: 'test',
    safety: {
      requiresApproval: true,
      requiresOfflineConfirm: true,
      verificationStatus: 'verified',
    },
    target: { executables: ['DemoGame.exe'], arch: 'x64' },
    ...overrides,
  };
}

describe('Phase 4 schema.v1-only — Live Memory', () => {
  test('definition with resolvable liveMemory is returned from schema', () => {
    const definition = executableDef({
      id: 'demo-live-exe',
      target: { executables: ['DemoLive.exe'], arch: 'x64' },
      memoryFeatures: [
        {
          id: 'ammo',
          name: 'Ammo',
          category: 'Weapons',
          type: 'freeze',
          dataType: 'int32',
          defaultValue: 99,
          resolution: { moduleName: 'DemoLive.exe', baseOffset: '0x1000', pointerChain: [8] },
        },
      ],
    });

    const listed = listLiveControlsFromSchema(
      { executableName: 'DemoLive.exe', catalogGameId: 'demo-live-exe' },
      {
        loadDefinition: (id) => (id === 'demo-live-exe' ? definition : null),
        findCatalogGameIdsByExecutable: () => ['demo-live-exe'],
      },
    );

    assert.equal(listed.source, 'schema.v1');
    assert.equal(listed.controls.length, 1);
    assert.equal(listed.controls[0]!.id, 'demo-live-exe:ammo');

    const resolved = resolveLiveControlFromSchema(
      'demo-live-exe:ammo',
      { executableName: 'DemoLive.exe', catalogGameId: 'demo-live-exe' },
      { loadDefinition: (id) => (id === 'demo-live-exe' ? definition : null) },
    );
    assert.equal(resolved.source, 'schema.v1');
    assert.ok(resolved.feature);
  });

  test('missing definition returns empty controls (no legacy fallback)', () => {
    const listed = listLiveControlsFromSchema(
      { executableName: 'UnknownGame.exe' },
      {
        loadDefinition: () => null,
        findCatalogGameIdsByExecutable: () => [],
      },
    );
    assert.equal(listed.source, null);
    assert.deepEqual(listed.controls, []);

    const resolved = resolveLiveControlFromSchema('atomfall-current-weapon-ammo', {
      executableName: 'Atomfall_dx12.exe',
    }, {
      loadDefinition: () => null,
      findCatalogGameIdsByExecutable: () => [],
    });
    assert.equal(resolved.source, null);
    assert.equal(resolved.control, undefined);
  });
});

describe('Phase 4 schema.v1-only — Save Edit', () => {
  test('schema.v1 saveEdit executable with Milestone J paths + requires_approval', () => {
    const definition = executableDef({
      id: 'stardew-valley',
      title: 'Stardew Valley',
      target: { executables: ['Stardew Valley.exe'], arch: 'x64' },
      saveEditor: {
        defaultDirectory: '%APPDATA%/StardewValley/Saves',
        extension: 'xml',
        format: 'xml',
        saveFields: Object.entries(MILESTONE_J_PATHS).map(([id, searchKey]) => ({
          id,
          name: id,
          category: 'stats',
          dataType: 'number',
          mapping: { searchKey },
        })),
      },
    });

    const result = resolveSaveEditControlsFromSchema(
      { catalogGameId: 'stardew-valley' },
      { loadDefinition: () => definition },
    );

    assert.equal(result.source, 'schema.v1');
    assert.equal(result.controls.length, 4);
    for (const control of result.controls) {
      assert.equal(control.backend, 'save_field');
      assert.equal(control.safetyStatus, 'requires_approval');
      assert.equal(control.saveField?.fieldPath, MILESTONE_J_PATHS[control.id]);
    }

    const aligned = alignStardewPanelPlaceholders(result.controls);
    for (const control of aligned) {
      assert.equal(control.saveField?.filePath, STARDEW_SAVE_FILE_PLACEHOLDER);
      assert.equal(control.saveField?.gameId, STARDEW_PANEL_GAME_ID);
      assert.equal(control.saveField?.fieldPath, MILESTONE_J_PATHS[control.id]);
    }
  });

  test('missing definition returns empty controls (no game-profiles fallback)', () => {
    const result = resolveSaveEditControlsFromSchema(
      { catalogGameId: 'no-such-game' },
      { loadDefinition: () => null },
    );
    assert.equal(result.source, null);
    assert.deepEqual(result.controls, []);
  });

  test('buildControls loads schema.v1 Stardew with Milestone J paths', () => {
    const controls = buildControls();
    assert.equal(controls.length, 4);
    for (const control of controls) {
      assert.equal(control.backend, 'save_field');
      assert.equal(control.safetyStatus, 'requires_approval');
      assert.equal(control.saveField?.fieldPath, MILESTONE_J_PATHS[control.id]);
      assert.equal(control.saveField?.filePath, STARDEW_SAVE_FILE_PLACEHOLDER);
      assert.equal(control.saveField?.gameId, STARDEW_PANEL_GAME_ID);
    }
  });
});

describe('Phase 4 seeded titles prefer schema without legacy', () => {
  before(async () => {
    await resetForTesting();
    ensureBundledDefinitions();
  });

  test('Atomfall liveMemory comes from schema.v1 seed', () => {
    const listed = listLiveControlsFromSchema({
      executableName: 'Atomfall_dx12.exe',
      catalogGameId: 'atomfall',
    });
    assert.equal(listed.source, 'schema.v1');
    assert.ok(listed.controls.some((c) => c.id === 'atomfall:atomfall-current-weapon-ammo'));
  });

  test('Stardew saveEdit comes from schema.v1 seed', () => {
    const result = resolveSaveEditControlsFromSchema({ catalogGameId: 'stardew-valley' });
    assert.equal(result.source, 'schema.v1');
    assert.equal(result.controls.length, 4);
  });
});
