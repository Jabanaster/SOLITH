/**
 * Phase 2 — dual-read routing: Condition A (schema.v1 preferred) + Condition B (legacy fallback).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SolithDefinitionV1 } from '../src/core/definitions/schema.v1.ts';
import {
  resolveSaveEditControlsDualRead,
  alignStardewPanelPlaceholders,
  loadStardewProfileControls,
} from '../src/core/definitions/dual-read-save-controls.ts';
import {
  listLiveControlsDualRead,
  resolveLiveControlDualRead,
} from '../src/core/live-memory/dual-read-controls.ts';
import type { LiveTrainerControl } from '../src/core/live-memory/live-control-catalog.ts';
import { buildControls } from '../src/app/pages/trainer-control-panel-build.ts';

const ATOMFALL_LEGACY: LiveTrainerControl = {
  id: 'atomfall-current-weapon-ammo',
  executableName: 'Atomfall_dx12.exe',
  label: 'Set Current Weapon Ammo',
  description: 'legacy',
  dataType: 'int32',
  pointerPath: { moduleName: 'atomfall_dx12.exe', moduleOffset: 0x1959a28, offsets: [24] },
  discoveredAt: '2026-07-06',
  evidence: 'test',
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

describe('Phase 2 dual-read — Live Memory', () => {
  test('Condition A: definition with resolvable liveMemory preferred over legacy', () => {
    const warnings: string[] = [];
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

    const listed = listLiveControlsDualRead(
      { executableName: 'DemoLive.exe', catalogGameId: 'demo-live-exe' },
      {
        loadDefinition: (id) => (id === 'demo-live-exe' ? definition : null),
        findCatalogGameIdsByExecutable: () => ['demo-live-exe'],
        listLegacy: () => [ATOMFALL_LEGACY],
        warn: (m) => warnings.push(m),
      },
    );

    assert.equal(listed.source, 'schema.v1');
    assert.equal(listed.controls.length, 1);
    assert.equal(listed.controls[0]!.id, 'demo-live-exe:ammo');
    assert.equal(warnings.length, 0);

    const resolved = resolveLiveControlDualRead(
      'demo-live-exe:ammo',
      { executableName: 'DemoLive.exe', catalogGameId: 'demo-live-exe' },
      {
        loadDefinition: (id) => (id === 'demo-live-exe' ? definition : null),
        warn: (m) => warnings.push(m),
      },
    );
    assert.equal(resolved.source, 'schema.v1');
    assert.ok(resolved.feature);
    assert.equal(resolved.feature!.id, 'ammo');
  });

  test('Condition B: no usable definition falls back to live-control-catalog with warning', () => {
    const warnings: string[] = [];
    const listed = listLiveControlsDualRead(
      { executableName: 'Atomfall_dx12.exe' },
      {
        loadDefinition: () => null,
        findCatalogGameIdsByExecutable: () => [],
        listLegacy: (exe) =>
          exe.toLowerCase() === 'atomfall_dx12.exe' ? [ATOMFALL_LEGACY] : [],
        warn: (m) => warnings.push(m),
      },
    );

    assert.equal(listed.source, 'live-control-catalog');
    assert.equal(listed.controls.length, 1);
    assert.equal(listed.controls[0]!.id, 'atomfall-current-weapon-ammo');
    assert.ok(warnings.some((w) => w.includes('Fallback triggered for Live Memory')));

    const resolved = resolveLiveControlDualRead(
      'atomfall-current-weapon-ammo',
      { executableName: 'Atomfall_dx12.exe' },
      {
        loadDefinition: () => null,
        findCatalogGameIdsByExecutable: () => [],
        getLegacy: (id) => (id === ATOMFALL_LEGACY.id ? ATOMFALL_LEGACY : undefined),
        warn: (m) => warnings.push(m),
      },
    );
    assert.equal(resolved.source, 'live-control-catalog');
    assert.equal(resolved.control?.id, 'atomfall-current-weapon-ammo');
  });

  test('Condition B: definition with liveMemory none falls back to legacy', () => {
    const warnings: string[] = [];
    const definition = executableDef({
      id: 'stardew-like',
      target: { executables: ['StardewValley.exe'], arch: 'x64' },
      saveEditor: {
        defaultDirectory: 'x',
        extension: 'xml',
        format: 'xml',
        saveFields: [
          {
            id: 'money',
            name: 'Money',
            category: 'currency',
            dataType: 'number',
            mapping: { searchKey: 'SaveGame.player.0.money' },
          },
        ],
      },
    });

    const listed = listLiveControlsDualRead(
      { executableName: 'StardewValley.exe', catalogGameId: 'stardew-like' },
      {
        loadDefinition: () => definition,
        findCatalogGameIdsByExecutable: () => ['stardew-like'],
        listLegacy: () => [],
        warn: (m) => warnings.push(m),
      },
    );

    assert.equal(listed.source, 'live-control-catalog');
    assert.deepEqual(listed.controls, []);
    assert.ok(warnings.some((w) => w.includes('Fallback triggered for Live Memory')));
  });
});

describe('Phase 2 dual-read — Save Edit', () => {
  const MILESTONE_J_PATHS: Record<string, string> = {
    'stardew-money': 'SaveGame.player.0.money',
    'stardew-stamina': 'SaveGame.player.0.stamina.0.float.0',
    'stardew-farming-xp': 'SaveGame.player.0.experiencePoints.0.int.0',
    'stardew-max-stamina': 'SaveGame.player.0.maxStamina.0.float.0',
  };

  test('Condition A: schema.v1 saveEdit executable preferred; Milestone J paths + requires_approval', () => {
    const warnings: string[] = [];
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

    const result = resolveSaveEditControlsDualRead(
      { catalogGameId: 'stardew-valley' },
      {
        loadDefinition: () => definition,
        loadLegacyControls: () => {
          throw new Error('legacy must not be called on Condition A');
        },
        warn: (m) => warnings.push(m),
      },
    );

    assert.equal(result.source, 'schema.v1');
    assert.equal(result.controls.length, 4);
    assert.equal(warnings.length, 0);
    for (const control of result.controls) {
      assert.equal(control.backend, 'save_field');
      assert.equal(control.safetyStatus, 'requires_approval');
      assert.equal(control.saveField?.fieldPath, MILESTONE_J_PATHS[control.id]);
    }

    const aligned = alignStardewPanelPlaceholders(result.controls);
    const legacy = loadStardewProfileControls();
    for (const control of aligned) {
      const leg = legacy.find((c) => c.id === control.id);
      assert.ok(leg);
      assert.equal(control.saveField?.fieldPath, MILESTONE_J_PATHS[control.id]);
      assert.equal(control.saveField?.filePath, leg!.saveField?.filePath);
      assert.equal(control.saveField?.gameId, leg!.saveField?.gameId);
    }
  });

  test('Condition B: no definition falls back to game-profiles with warning', () => {
    const warnings: string[] = [];
    const legacy = loadStardewProfileControls();
    const result = resolveSaveEditControlsDualRead(
      { catalogGameId: 'stardew-valley' },
      {
        loadDefinition: () => null,
        loadLegacyControls: () => legacy,
        warn: (m) => warnings.push(m),
      },
    );

    assert.equal(result.source, 'game-profiles');
    assert.equal(result.controls.length, 4);
    assert.ok(warnings.some((w) => w.includes('Fallback triggered for Save Edit')));
    for (const control of result.controls) {
      assert.equal(control.saveField?.fieldPath, MILESTONE_J_PATHS[control.id]);
      assert.equal(control.safetyStatus, 'requires_approval');
    }
  });

  test('buildControls prefers schema when catalog definition is available (or profile fallback)', () => {
    const controls = buildControls();
    assert.equal(controls.length, 4);
    for (const control of controls) {
      assert.equal(control.backend, 'save_field');
      assert.equal(control.safetyStatus, 'requires_approval');
      assert.equal(control.saveField?.fieldPath, MILESTONE_J_PATHS[control.id]);
    }
  });
});
