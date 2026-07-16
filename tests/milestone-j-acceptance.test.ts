import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bundledDefinitionsForTests } from '../src/core/trainer-catalog/bundled-definition-seed.js';
import { solithDefinitionToTrainerControls } from '../src/core/definitions/definition-to-trainer-controls.js';

const acceptedExecutableIds = [
  'stardew-farming-xp',
  'stardew-max-stamina',
  'stardew-money',
  'stardew-stamina',
];

const expectedFieldPaths: Record<string, string> = {
  'stardew-money': 'SaveGame.player.0.money',
  'stardew-stamina': 'SaveGame.player.0.stamina.0.float.0',
  'stardew-farming-xp': 'SaveGame.player.0.experiencePoints.0.int.0',
  'stardew-max-stamina': 'SaveGame.player.0.maxStamina.0.float.0',
};

describe('Milestone J acceptance — release-candidate control workflow contract', () => {
  const stardew = bundledDefinitionsForTests().find((d) => d.id === 'stardew-valley');
  assert.ok(stardew, 'stardew-valley bundled definition required');
  const controls = solithDefinitionToTrainerControls(stardew!);

  it('has exactly the accepted executable Stardew save-field controls', () => {
    const ids = controls.map((control) => control.id).sort();
    assert.deepStrictEqual(ids, acceptedExecutableIds);
  });

  it('all accepted executable controls are save_field and require approval', () => {
    for (const control of controls) {
      assert.strictEqual(control.backend, 'save_field', `${control.id} backend`);
      assert.strictEqual(control.safetyStatus, 'requires_approval', `${control.id} safetyStatus`);
      assert.ok(control.saveField, `${control.id} has saveField`);
      assert.strictEqual(control.saveField?.fieldPath, expectedFieldPaths[control.id], `${control.id} fieldPath`);
    }
  });

  it('Max Stamina keeps its accepted Milestone I field path', () => {
    const maxStamina = controls.find((control) => control.id === 'stardew-max-stamina');
    assert.ok(maxStamina);
    assert.strictEqual(maxStamina.label, 'Max Stamina');
    assert.strictEqual(maxStamina.backend, 'save_field');
    assert.strictEqual(maxStamina.safetyStatus, 'requires_approval');
    assert.strictEqual(maxStamina.saveField?.fieldPath, 'SaveGame.player.0.maxStamina.0.float.0');
  });

  it('shipped controls do not include memory_write controls', () => {
    const memoryWriteControls = controls.filter((control) => control.backend === 'memory_write');
    assert.deepStrictEqual(memoryWriteControls, []);
  });

  it('shipped controls do not include future, disabled, or unsupported controls', () => {
    const blockedControls = controls.filter((control) =>
      ['future_feature', 'disabled', 'unsupported'].includes(control.safetyStatus),
    );
    assert.deepStrictEqual(blockedControls, []);
  });
});
