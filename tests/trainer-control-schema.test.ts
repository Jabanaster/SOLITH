/**
 * tests/trainer-control-schema.test.ts — Milestone E
 *
 * Tests for TrainerControl schema logic, execution-eligibility guards,
 * approval rules, and label helpers.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateControl,
  isControlExecutable,
  requiresApproval,
  BACKEND_LABELS,
  SAFETY_STATUS_LABELS,
  type TrainerControl,
} from '../src/core/trainer-host/trainer-control-schema.js';
import { buildControls } from '../src/app/pages/TrainerControlPanel.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MONEY_CONTROL: TrainerControl = {
  id: 'stardew-money',
  label: 'Money',
  description: 'Ceriph\'s gold.',
  category: 'CURRENCY',
  controlType: 'number_input',
  backend: 'save_field',
  safetyStatus: 'requires_approval',
  saveField: {
    filePath: 'C:\\path\\to\\save',
    fieldPath: 'SaveGame.player.0.money',
    gameId: 'demo-game-quest-id-000000000000',
  },
};

const MEMORY_CONTROL: TrainerControl = {
  id: 'stardew-health',
  label: 'Health',
  description: 'Runtime memory control.',
  category: 'HEALTH',
  controlType: 'number_input',
  backend: 'memory_write',
  safetyStatus: 'future_feature',
};

const DISABLED_CONTROL: TrainerControl = {
  id: 'stardew-resources',
  label: 'Resources',
  description: 'Disabled.',
  category: 'INVENTORY',
  controlType: 'number_input',
  backend: 'save_field',
  safetyStatus: 'disabled',
};

// ── Schema validation ─────────────────────────────────────────────────────────

describe('validateControl — required fields', () => {
  it('returns no errors for a fully valid save_field control', () => {
    const errors = validateControl(MONEY_CONTROL);
    assert.deepStrictEqual(errors, []);
  });

  it('returns error when id is missing', () => {
    const bad = { ...MONEY_CONTROL, id: '' };
    const errors = validateControl(bad);
    assert.ok(errors.some(e => e.includes('id')), `expected id error, got: ${errors.join(', ')}`);
  });

  it('returns error when label is missing', () => {
    const bad = { ...MONEY_CONTROL, label: '' };
    const errors = validateControl(bad);
    assert.ok(errors.some(e => e.includes('label')));
  });

  it('returns error for invalid controlType', () => {
    const bad = { ...MONEY_CONTROL, controlType: 'magic_wand' };
    const errors = validateControl(bad as any);
    assert.ok(errors.some(e => e.includes('controlType')));
  });

  it('returns error for invalid backend', () => {
    const bad = { ...MONEY_CONTROL, backend: 'telepathy' };
    const errors = validateControl(bad as any);
    assert.ok(errors.some(e => e.includes('backend')));
  });

  it('returns error when save_field control missing saveField', () => {
    const bad: TrainerControl = {
      ...MONEY_CONTROL,
      safetyStatus: 'requires_approval',
      saveField: undefined,
    };
    const errors = validateControl(bad);
    assert.ok(
      errors.some(e => e.includes('saveField')),
      `expected saveField error, got: ${errors.join(', ')}`
    );
  });

  it('returns no errors for memory_write control without saveField', () => {
    const errors = validateControl(MEMORY_CONTROL);
    assert.deepStrictEqual(errors, []);
  });

  it('returns no errors for disabled save_field control without saveField', () => {
    const errors = validateControl(DISABLED_CONTROL);
    assert.deepStrictEqual(errors, []);
  });
});

// ── isControlExecutable ───────────────────────────────────────────────────────

describe('isControlExecutable — execution eligibility', () => {
  it('returns true for save_field + requires_approval (Money control)', () => {
    assert.strictEqual(isControlExecutable(MONEY_CONTROL), true);
  });

  it('returns true for save_field + supported', () => {
    const supported: TrainerControl = { ...MONEY_CONTROL, safetyStatus: 'supported' };
    assert.strictEqual(isControlExecutable(supported), true);
  });

  it('returns false for memory_write backend (Health)', () => {
    assert.strictEqual(isControlExecutable(MEMORY_CONTROL), false);
  });

  it('returns false for save_field + disabled (Resources)', () => {
    assert.strictEqual(isControlExecutable(DISABLED_CONTROL), false);
  });

  it('returns false for save_field + future_feature', () => {
    const future: TrainerControl = { ...MONEY_CONTROL, safetyStatus: 'future_feature' };
    assert.strictEqual(isControlExecutable(future), false);
  });

  it('returns false for unsupported backend', () => {
    const unsupported: TrainerControl = {
      ...MONEY_CONTROL,
      backend: 'unsupported',
      safetyStatus: 'supported',
    };
    assert.strictEqual(isControlExecutable(unsupported), false);
  });

  it('returns false for memory_observation backend regardless of status', () => {
    const obs: TrainerControl = {
      ...MONEY_CONTROL,
      backend: 'memory_observation',
      safetyStatus: 'supported',
    };
    assert.strictEqual(isControlExecutable(obs), false);
  });
});

// ── requiresApproval ──────────────────────────────────────────────────────────

describe('requiresApproval', () => {
  it('returns true for Money control (requires_approval)', () => {
    assert.strictEqual(requiresApproval(MONEY_CONTROL), true);
  });

  it('returns false for a supported control (no approval gate)', () => {
    const supported: TrainerControl = { ...MONEY_CONTROL, safetyStatus: 'supported' };
    assert.strictEqual(requiresApproval(supported), false);
  });

  it('returns false for a disabled control', () => {
    assert.strictEqual(requiresApproval(DISABLED_CONTROL), false);
  });

  it('returns false for a future_feature control', () => {
    assert.strictEqual(requiresApproval(MEMORY_CONTROL), false);
  });
});

// ── Label helpers ─────────────────────────────────────────────────────────────

describe('BACKEND_LABELS', () => {
  it('has a label for every backend type', () => {
    const expectedBackends = [
      'save_field', 'runtime_file', 'memory_observation', 'memory_write', 'unsupported',
    ];
    for (const b of expectedBackends) {
      assert.ok(
        typeof BACKEND_LABELS[b as keyof typeof BACKEND_LABELS] === 'string',
        `Missing label for backend: ${b}`
      );
    }
  });

  it('renders safe_field as "Save Field"', () => {
    assert.strictEqual(BACKEND_LABELS['save_field'], 'Save Field');
  });

  it('renders memory_write as "Memory Write"', () => {
    assert.strictEqual(BACKEND_LABELS['memory_write'], 'Memory Write');
  });
});

describe('SAFETY_STATUS_LABELS', () => {
  it('has a label for every safety status', () => {
    const expectedStatuses = [
      'supported', 'disabled', 'requires_approval', 'requires_save_reload',
      'requires_game_restart', 'rollback_available', 'future_feature',
    ];
    for (const s of expectedStatuses) {
      assert.ok(
        typeof SAFETY_STATUS_LABELS[s as keyof typeof SAFETY_STATUS_LABELS] === 'string',
        `Missing label for status: ${s}`
      );
    }
  });

  it('renders requires_approval as "Requires Approval"', () => {
    assert.strictEqual(SAFETY_STATUS_LABELS['requires_approval'], 'Requires Approval');
  });

  it('renders future_feature as "Future Feature"', () => {
    assert.strictEqual(SAFETY_STATUS_LABELS['future_feature'], 'Future Feature');
  });
});

// ── Panel controls — buildControls() ─────────────────────────────────────────

describe('buildControls — TrainerControlPanel fixture set', () => {
  const controls = buildControls();

  it('includes only the 4 accepted shipped V1 controls', () => {
    assert.deepStrictEqual(
      controls.map(c => c.id).sort(),
      [
        'stardew-farming-xp',
        'stardew-max-stamina',
        'stardew-money',
        'stardew-stamina',
      ]
    );
  });

  it('Money control is executable and requires approval', () => {
    const money = controls.find(c => c.id === 'stardew-money');
    assert.ok(money, 'Money control must be present');
    assert.strictEqual(isControlExecutable(money), true);
    assert.strictEqual(requiresApproval(money), true);
  });

  it('Stamina control is executable and requires approval', () => {
    const stamina = controls.find(c => c.id === 'stardew-stamina');
    assert.ok(stamina, 'Stamina control must be present');
    assert.strictEqual(isControlExecutable(stamina), true);
    assert.strictEqual(requiresApproval(stamina), true);
    assert.strictEqual(stamina.backend, 'save_field');
    assert.ok(stamina.saveField?.fieldPath.includes('stamina'), 'Stamina field path must reference stamina');
  });

  it('Farming XP control is executable and requires approval', () => {
    const farmingXp = controls.find(c => c.id === 'stardew-farming-xp');
    assert.ok(farmingXp, 'Farming XP control must be present');
    assert.strictEqual(isControlExecutable(farmingXp), true);
    assert.strictEqual(requiresApproval(farmingXp), true);
    assert.strictEqual(farmingXp.backend, 'save_field');
    assert.ok(farmingXp.saveField?.fieldPath.includes('experiencePoints'), 'Farming XP field path must reference experiencePoints');
  });

  it('Max Stamina control is executable and requires approval', () => {
    const maxStamina = controls.find(c => c.id === 'stardew-max-stamina');
    assert.ok(maxStamina, 'Max Stamina control must be present');
    assert.strictEqual(isControlExecutable(maxStamina), true);
    assert.strictEqual(requiresApproval(maxStamina), true);
    assert.strictEqual(maxStamina.backend, 'save_field');
    assert.ok(maxStamina.saveField?.fieldPath.includes('maxStamina'), 'Max Stamina field path must reference maxStamina');
  });

  it('all non-save_field controls are not executable', () => {
    const nonSaveField = controls.filter(c => c.backend !== 'save_field');
    for (const c of nonSaveField) {
      assert.strictEqual(
        isControlExecutable(c), false,
        `Expected ${c.id} (backend=${c.backend}) to be non-executable`
      );
    }
  });

  it('ships no memory_write controls', () => {
    const memoryControls = controls.filter(c => c.backend === 'memory_write');
    assert.deepStrictEqual(memoryControls, []);
  });

  it('all controls pass schema validation', () => {
    for (const c of controls) {
      const errors = validateControl(c);
      assert.deepStrictEqual(
        errors, [],
        `Control ${c.id} has validation errors: ${errors.join(', ')}`
      );
    }
  });

  it('disabled controls are not executable', () => {
    const disabled = controls.filter(c => c.safetyStatus === 'disabled');
    for (const c of disabled) {
      assert.strictEqual(isControlExecutable(c), false);
    }
  });

  it('ships no future_feature controls', () => {
    const future = controls.filter(c => c.safetyStatus === 'future_feature');
    assert.deepStrictEqual(future, []);
  });
});
