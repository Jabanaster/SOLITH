import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

type SaveField = {
  fieldPath?: string;
};

type Control = {
  id: string;
  label: string;
  backend: string;
  safetyStatus: string;
  saveField?: SaveField;
  constraints?: {
    min?: number;
    max?: number;
  };
  metadata?: {
    safeTestValue?: number;
  };
};

const profilePath = join(process.cwd(), 'src/core/game-profiles/profiles/stardew-valley.json');
const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as { controls: Control[] };

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

function acceptedExecutableControls(): Control[] {
  return profile.controls.filter(
    (control) => control.backend === 'save_field' && control.safetyStatus === 'requires_approval',
  );
}

describe('Milestone J acceptance — release-candidate control workflow contract', () => {
  it('has exactly the accepted executable Stardew save-field controls', () => {
    const ids = acceptedExecutableControls().map((control) => control.id).sort();
    assert.deepStrictEqual(ids, acceptedExecutableIds);
  });

  it('all accepted executable controls are save_field and require approval', () => {
    for (const control of acceptedExecutableControls()) {
      assert.strictEqual(control.backend, 'save_field', `${control.id} backend`);
      assert.strictEqual(control.safetyStatus, 'requires_approval', `${control.id} safetyStatus`);
      assert.ok(control.saveField, `${control.id} has saveField`);
      assert.strictEqual(control.saveField?.fieldPath, expectedFieldPaths[control.id], `${control.id} fieldPath`);
    }
  });

  it('Max Stamina keeps its accepted Milestone I contract', () => {
    const maxStamina = profile.controls.find((control) => control.id === 'stardew-max-stamina');

    assert.ok(maxStamina);
    assert.strictEqual(maxStamina.label, 'Max Stamina');
    assert.strictEqual(maxStamina.backend, 'save_field');
    assert.strictEqual(maxStamina.safetyStatus, 'requires_approval');
    assert.strictEqual(maxStamina.saveField?.fieldPath, 'SaveGame.player.0.maxStamina.0.float.0');
    assert.strictEqual(maxStamina.constraints?.min, 270);
    assert.strictEqual(maxStamina.constraints?.max, 508);
    assert.strictEqual(maxStamina.metadata?.safeTestValue, 304);
  });

  it('memory_write controls are not part of the accepted executable set', () => {
    const memoryWriteControls = profile.controls.filter((control) => control.backend === 'memory_write');

    assert.ok(memoryWriteControls.length > 0, 'expected at least one memory_write future control');

    for (const control of memoryWriteControls) {
      assert.ok(!acceptedExecutableIds.includes(control.id), `${control.id} must not be accepted executable`);
      assert.notStrictEqual(control.safetyStatus, 'requires_approval', `${control.id} must not be approval executable`);
    }
  });

  it('future_feature, disabled, and unsupported controls are not accepted executable controls', () => {
    const blockedControls = profile.controls.filter((control) =>
      ['future_feature', 'disabled', 'unsupported'].includes(control.safetyStatus),
    );

    assert.ok(blockedControls.length > 0, 'expected blocked controls');

    for (const control of blockedControls) {
      assert.ok(!acceptedExecutableIds.includes(control.id), `${control.id} must not be accepted executable`);
    }
  });
});
